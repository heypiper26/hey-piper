import sql from '../../lib/db.js';
import pluggy from '../../lib/pluggy.js';
import { requireAuth } from '../../lib/auth.js';

import { mapTransaction, isBillPayment } from '../../lib/pluggyMap.js';
import { syncCardBills } from '../../lib/cardBills.js';

async function handleCandidates(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const itemId = process.env.PLUGGY_ITEM_ID;
  const since = req.query.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { results: accounts } = await pluggy.fetchAccounts(itemId);

  const candidates = [];
  let billPayments = 0;
  for (const account of accounts) {
    // Refreshes card_bills as a side effect. A failure here must not block the import: open and
    // future statements still resolve their fatura from the transaction's own metadata.
    let billById = new Map();
    if (account.type === 'CREDIT') {
      try {
        billById = await syncCardBills(account.id);
      } catch (e) {
        console.error('card bills sync failed', e);
      }
    }

    const transactions = await pluggy.fetchAllTransactions(account.id, { dateFrom: since });
    for (const tx of transactions) {
      // Credit card purchases (including every future parcela of an installment purchase) stay PENDING
      // until their own statement closes — include all of them so upcoming installments show up for
      // budget planning ahead of time. Bank transactions are only ever briefly pending (scheduled
      // transfers), so keep those POSTED-only.
      if (tx.status !== 'POSTED' && account.type !== 'CREDIT') continue;
      if (isBillPayment(tx)) { billPayments++; continue; }
      candidates.push(mapTransaction(tx, account, billById));
    }
  }

  // A parcela imported while its statement was still open carries the forecast fatura; once the
  // statement closes Pluggy may move it. Keep already-imported rows in step.
  const invoiceById = candidates
    .filter((c) => c.invoice_month)
    .map((c) => ({ pid: c.pluggy_transaction_id, im: c.invoice_month }));
  if (invoiceById.length) {
    await sql`
      UPDATE transactions t SET invoice_month = v.im
      FROM (SELECT x->>'pid' AS pid, x->>'im' AS im FROM jsonb_array_elements(${sql.json(invoiceById)}) x) v
      WHERE t.pluggy_transaction_id = v.pid AND t.invoice_month IS DISTINCT FROM v.im
    `;
  }

  const ids = candidates.map((c) => c.pluggy_transaction_id);
  const existingByPluggyId = ids.length
    ? await sql`SELECT pluggy_transaction_id FROM transactions WHERE pluggy_transaction_id = ANY(${ids})`
    : [];
  const existingIds = new Set(existingByPluggyId.map((r) => r.pluggy_transaction_id));

  // Deliberately-excluded transactions are tracked via the same rejected_imports
  // table Smart Import uses, keyed by pluggy_transaction_id instead of an import_key.
  const rejected = ids.length
    ? await sql`SELECT key FROM rejected_imports WHERE key = ANY(${ids})`
    : [];
  const rejectedIds = new Set(rejected.map((r) => r.key));

  // Transactions imported before this integration existed (e.g. via Smart Import) have no
  // pluggy_transaction_id, so also dedupe those by exact date + amount + type. Pluggy's `date`
  // is the actual transaction date/time (source of truth going forward); older imports based on
  // bank statement PDFs may use the statement's posting date instead (e.g. weekend PIX posted
  // on the next business day), which this exact match won't catch — acceptable tradeoff.
  //
  // The lookup must start at the earliest candidate date, not at `since`: installment dates are
  // rebuilt from the purchase date (see mapTransaction), so a parcela Pluggy returns inside the
  // window can map to a date before it. Pluggy also reissues a parcela under a new id once its
  // statement closes, so without this the already-imported copy is invisible and it comes back
  // as a duplicate.
  const lookupFrom = candidates.reduce((min, c) => (c.date < min ? c.date : min), since);
  const existingByDate = (await sql`
    SELECT id, date, amount, type FROM transactions WHERE date >= ${lookupFrom}
  `).map((r) => ({ ...r, used: false }));

  const newCandidates = candidates.filter((c) => {
    if (existingIds.has(c.pluggy_transaction_id)) return false;
    if (rejectedIds.has(c.pluggy_transaction_id)) return false;
    const match = existingByDate.find((r) =>
      !r.used && r.date === c.date && r.type === c.type && Math.abs(Number(r.amount) - c.amount) <= 0.01
    );
    if (match) { match.used = true; return false; }
    return true;
  });

  return res.json({ candidates: newCandidates, skipped: candidates.length - newCandidates.length, billPayments });
}

// Closed faturas as last mirrored from Pluggy (see syncCardBills) — served from the table so
// the Cartão page doesn't wait on a live Pluggy round trip. The LIMIT is a parameter so the
// query never goes out parameterless (see handleCash in the transactions handler).
async function handleBills(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  // Every card falling due in the same month is added up, as the Cartão page shows faturas
  // by month across all cards.
  return res.json(await sql`
    SELECT due_month, MAX(due_date) as due_date, MAX(closing_date) as closing_date,
           SUM(total_amount) as total_amount
    FROM card_bills GROUP BY due_month ORDER BY due_month DESC LIMIT ${36}`);
}

const NAMED_ROUTES = {
  candidates: handleCandidates,
  bills: handleBills,
};

async function handler(req, res) {
  const seg = req.query['...path'];
  const path = seg != null ? [seg] : [];

  if (path.length === 1) {
    const named = NAMED_ROUTES[path[0]];
    if (named) return named(req, res);
  }

  res.status(404).json({ error: 'Not found' });
}

export default requireAuth(handler);
