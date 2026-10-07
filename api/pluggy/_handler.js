import sql from '../../lib/db.js';
import pluggy from '../../lib/pluggy.js';
import { requireAuth } from '../../lib/auth.js';

// Pluggy timestamps are UTC. the bank's local time is America/Sao_Paulo (UTC-3), so a purchase made
// after 21:00 local time lands on the next UTC calendar day — slicing the raw UTC string would
// silently shift those purchases a day (or, combined with month math, sometimes a whole month) late.
function toLocalDate(dateStr) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(dateStr));
}

function addMonths(dateStr, months) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function mapTransaction(tx, account) {
  const isCredit = account.type === 'CREDIT';
  // Foreign-currency purchases report `amount` in the original currency (e.g. USD); the BRL value
  // billed to the account is in `amountInAccountCurrency` when present.
  const rawAmount = tx.amountInAccountCurrency ?? tx.amount;
  const amount = Math.abs(rawAmount);
  const type = isCredit
    ? (rawAmount > 0 ? 'expense' : 'income')
    : (rawAmount < 0 ? 'expense' : 'income');

  // Installment purchases report `date` as that parcela's invoice due date (always the statement's
  // fixed closing day, so every parcela lands on the same day of the month), not when the purchase happened. Rebuild
  // the real month from the original purchase date + installment offset — parcela 2/3 of a June 10
  // purchase becomes July 10, parcela 3/3 becomes August 10 — so the budget shows spending spread
  // across the months it actually happened instead of clustering on the due-date day.
  const installment = tx.creditCardMetadata;
  const date = installment && installment.totalInstallments > 1
    ? addMonths(toLocalDate(installment.purchaseDate), installment.installmentNumber - 1)
    : toLocalDate(tx.date);

  return {
    pluggy_transaction_id: tx.id,
    date,
    amount,
    type,
    description: tx.description || '',
    // Match the exact values Transactions.jsx expects (SOURCE_LABELS/SOURCE_ICONS keys) so
    // the Conta/Cartão badge renders — a free-form "Pluggy: <account>" string doesn't match.
    source: isCredit ? 'credit_card' : 'bank_account',
    account_type: account.type,
    account_name: account.name,
  };
}

async function handleCandidates(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const itemId = process.env.PLUGGY_ITEM_ID;
  const since = req.query.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { results: accounts } = await pluggy.fetchAccounts(itemId);

  const candidates = [];
  for (const account of accounts) {
    const transactions = await pluggy.fetchAllTransactions(account.id, { dateFrom: since });
    for (const tx of transactions) {
      // Credit card purchases (including every future parcela of an installment purchase) stay PENDING
      // until their own statement closes — include all of them so upcoming installments show up for
      // budget planning ahead of time. Bank transactions are only ever briefly pending (scheduled
      // transfers), so keep those POSTED-only.
      if (tx.status !== 'POSTED' && account.type !== 'CREDIT') continue;
      candidates.push(mapTransaction(tx, account));
    }
  }

  const ids = candidates.map((c) => c.pluggy_transaction_id);
  const existingByPluggyId = ids.length
    ? await sql`SELECT pluggy_transaction_id FROM transactions WHERE pluggy_transaction_id = ANY(${ids})`
    : [];
  const existingIds = new Set(existingByPluggyId.map((r) => r.pluggy_transaction_id));

  // Deliberately-excluded transactions (e.g. credit card bill payment — a transfer between the
  // user's own accounts, not real income/expense) are tracked via the same rejected_imports
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
  const existingByDate = (await sql`
    SELECT id, date, amount, type FROM transactions WHERE date >= ${since}
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

  return res.json({ candidates: newCandidates, skipped: candidates.length - newCandidates.length });
}

const NAMED_ROUTES = {
  candidates: handleCandidates,
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
