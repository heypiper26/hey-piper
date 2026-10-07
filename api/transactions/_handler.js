import sql from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';
import { complete, MODELS } from '../../lib/ai.js';


const TRANSACTION_SELECT = sql`
  SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon
  FROM transactions t LEFT JOIN categories c ON t.category_id = c.id
`;

// Dates are TEXT `YYYY-MM-DD`, so a month/year is a lexicographic range — sargable,
// unlike to_char(date::date, ...) which defeats idx_transactions_date.
function monthRange(year, month) {
  const y = Number(year), m = Number(month);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return {
    start: `${y}-${String(m).padStart(2, '0')}-01`,
    end: `${ny}-${String(nm).padStart(2, '0')}-01`,
  };
}

function yearRange(year) {
  const y = Number(year);
  return { start: `${y}-01-01`, end: `${y + 1}-01-01` };
}

// Shared with handleInstallments and the extraordinary-flag propagation in handleById:
// parses the installment marker Pluggy/the bank leaves in card descriptions into a
// plan identity (normalized base description + total installment count). Two formats
// are seen in practice: the compact `NN/NN` suffix, and the spelled-out
// "(Parcela K de N)" — same plan concept, different import batch.
const INSTALLMENT_SUFFIX_RX = /^(.*?)[\s.]*([0-9]{1,2})\/([0-9]{1,2})$/;
const INSTALLMENT_WORDY_RX = /^(.*?)\s*\(?parcela\s+([0-9]{1,2})\s+de\s+([0-9]{1,2})\)?\s*$/i;
// Matches either pattern anywhere they could occur — used to pre-filter SQL rows
// before the precise per-row parse below.
const INSTALLMENT_SQL_PATTERN = '[0-9]{1,2}/[0-9]{1,2}$|parcela [0-9]{1,2} de [0-9]{1,2}';

function parseInstallment(description) {
  const m = description.match(INSTALLMENT_SUFFIX_RX) || description.match(INSTALLMENT_WORDY_RX);
  if (!m) return null;
  const k = Number(m[2]), n = Number(m[3]);
  if (n < 2 || k > n) return null;
  const base = m[1].trim().replace(/\s+/g, ' ');
  if (!base) return null;
  return { base, k, n };
}

async function handleRoot(req, res) {
  if (req.method === 'GET') {
    const { year, month, category_id, type, limit = 200, offset = 0, include_ignored } = req.query;

    const conditions = [];
    if (!include_ignored) conditions.push(sql`(t.ignored IS NULL OR t.ignored = 0)`);
    if (year && month) {
      const { start, end } = monthRange(year, month);
      conditions.push(sql`t.date >= ${start} AND t.date < ${end}`);
    } else if (year) {
      const { start, end } = yearRange(year);
      conditions.push(sql`t.date >= ${start} AND t.date < ${end}`);
    }
    if (category_id) conditions.push(sql`t.category_id=${Number(category_id)}`);
    if (type) conditions.push(sql`t.type=${type}`);

    const where = conditions.length ? sql`WHERE ${conditions.reduce((a, b) => sql`${a} AND ${b}`)}` : sql``;

    const rows = await sql`
      ${TRANSACTION_SELECT}
      ${where}
      ORDER BY t.date DESC, t.created_at DESC
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}
    `;
    return res.json(rows);
  }

  if (req.method === 'POST') {
    const { date, amount, type, category_id, description, notes, source, is_transfer } = req.body;
    if (!date || !amount || !type) return res.status(400).json({ error: 'date, amount e type são obrigatórios' });
    const [row] = await sql`
      INSERT INTO transactions (date, amount, type, category_id, description, notes, source, is_transfer)
      VALUES (${date}, ${Math.abs(Number(amount))}, ${type}, ${category_id || null}, ${description || ''}, ${notes || ''}, ${source || null}, ${!!is_transfer})
      RETURNING *
    `;
    const [full] = await sql`${TRANSACTION_SELECT} WHERE t.id=${row.id}`;
    return res.status(201).json(full);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleById(req, res, id) {
  if (req.method === 'PUT') {
    const { date, amount, type, category_id, description, notes, source, offsets_category_id, is_extraordinary, is_transfer } = req.body;
    const [before] = await sql`SELECT is_extraordinary FROM transactions WHERE id=${id}`;
    await sql`
      UPDATE transactions SET date=${date}, amount=${Math.abs(Number(amount))}, type=${type},
        category_id=${category_id || null}, description=${description || ''},
        notes=${notes || ''}, source=${source || null}, offsets_category_id=${offsets_category_id || null},
        is_extraordinary=${!!is_extraordinary}, is_transfer=${!!is_transfer}
      WHERE id=${id}
    `;

    // Propagate the extraordinary flag to every other installment of the same plan
    // (same normalized base description + total count) — an event that's extraordinary
    // is extraordinary for all its parcels, not just the one being edited. Only runs
    // when the flag actually changed; candidates are narrowed by the base description
    // (LIKE-escaped) instead of scanning every installment-looking row in the table.
    let siblingsUpdated = 0;
    const flagChanged = !before || !!before.is_extraordinary !== !!is_extraordinary;
    const parsed = flagChanged ? parseInstallment(description || '') : null;
    if (parsed) {
      // parsed.base collapses whitespace runs, but raw descriptions may keep them
      // ("LOJA EXEMPLO  07/10") — join tokens with % so spacing differences match.
      const basePattern = parsed.base
        .split(' ')
        .map((tok) => tok.replace(/[\\%_]/g, '\\$&'))
        .join('%') + '%';
      const candidates = await sql`
        SELECT id, description FROM transactions
        WHERE type='expense' AND id != ${id} AND description ILIKE ${basePattern}
          AND description ~* ${INSTALLMENT_SQL_PATTERN}
      `;
      const siblingIds = candidates
        .filter((c) => {
          const p = parseInstallment(c.description);
          return p && p.n === parsed.n && p.base.toLowerCase() === parsed.base.toLowerCase();
        })
        .map((c) => c.id);
      if (siblingIds.length) {
        await sql`UPDATE transactions SET is_extraordinary=${!!is_extraordinary} WHERE id = ANY(${siblingIds})`;
        siblingsUpdated = siblingIds.length;
      }
    }

    const [row] = await sql`${TRANSACTION_SELECT} WHERE t.id=${id}`;
    return res.json({ ...row, siblings_updated: siblingsUpdated });
  }

  if (req.method === 'DELETE') {
    await sql`DELETE FROM transactions WHERE id=${id}`;
    return res.json({ ok: true });
  }

  if (req.method === 'PATCH') {
    const { ignored } = req.body;
    await sql`UPDATE transactions SET ignored=${ignored ? 1 : 0} WHERE id=${id}`;
    const [row] = await sql`${TRANSACTION_SELECT} WHERE t.id=${id}`;
    return res.json(row);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleBulk(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { transactions } = req.body;
  if (!Array.isArray(transactions)) return res.status(400).json({ error: 'transactions deve ser um array' });

  if (!transactions.length) return res.status(201).json({ inserted: 0, ids: [] });

  const values = transactions.map((t) => ({
    date: t.date,
    amount: Math.abs(Number(t.amount)),
    type: t.type,
    category_id: t.category_id || null,
    description: t.description || '',
    notes: t.notes || '',
    source: t.source || null,
    import_key: t.import_key || null,
    pluggy_transaction_id: t.pluggy_transaction_id || null,
    is_transfer: !!t.is_transfer,
    is_extraordinary: !!t.is_extraordinary,
    offsets_category_id: t.offsets_category_id || null,
  }));

  const rows = await sql`
    INSERT INTO transactions ${sql(values)}
    ON CONFLICT (pluggy_transaction_id) WHERE pluggy_transaction_id IS NOT NULL DO NOTHING
    RETURNING id
  `;
  return res.status(201).json({ inserted: rows.length, ids: rows.map((r) => r.id) });
}

async function handleBulkCategory(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { ids, category_id } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids obrigatório' });
  await sql`UPDATE transactions SET category_id=${category_id ?? null} WHERE id = ANY(${ids})`;
  return res.json({ updated: ids.length });
}

async function handleSummary(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { year, month, until } = req.query;
  // Optional extra cuts computed in the same request (used by the Dashboard's pace
  // math): `pace_until` = realized-so-far cut (usually today), `window_until` = start
  // of the trailing pace window. Replaces what used to be 3 separate summary calls.
  const paceUntil = req.query.pace_until ? String(req.query.pace_until) : null;
  const windowUntil = req.query.window_until ? String(req.query.window_until) : null;

  const range = year && month ? monthRange(year, month) : year ? yearRange(year) : null;
  let baseWhere = range
    ? sql`(ignored IS NULL OR ignored = 0) AND date >= ${range.start} AND date < ${range.end}`
    : sql`(ignored IS NULL OR ignored = 0)`;
  // `until` (YYYY-MM-DD) caps the window — used to separate realized spend from
  // future-dated installments already booked within the month (dates are TEXT ISO).
  if (until) baseWhere = sql`${baseWhere} AND date <= ${String(until)}`;

  // Transferências (ex.: aporte em investimentos) saem do caixa mas não são gasto real
  // — ficam fora de income/expense e viram um terceiro bucket somado à parte.
  const totalsQ = sql`
    SELECT type,
           SUM(amount) FILTER (WHERE NOT COALESCE(is_transfer, false)) as total,
           SUM(amount) FILTER (WHERE COALESCE(is_transfer, false)) as transfer_total
    FROM transactions WHERE ${baseWhere} GROUP BY type
  `;

  // Extra FILTER columns for the pace cuts — same rows, no extra query. When
  // window_until is absent the '' comparison is simply always false (dates are ISO text).
  const paceCols = paceUntil
    ? sql`,
           COALESCE(SUM(t.amount) FILTER (WHERE t.date <= ${paceUntil}), 0) as pace_total,
           COALESCE(SUM(t.amount) FILTER (WHERE t.date <= ${paceUntil} AND NOT COALESCE(t.is_extraordinary, false)), 0) as pace_total_excl,
           COALESCE(SUM(t.amount) FILTER (WHERE t.date <= ${windowUntil ?? ''} AND NOT COALESCE(t.is_extraordinary, false)), 0) as window_total_excl`
    : sql``;

  const byCategoryQ = sql`
    SELECT c.id, c.name, c.color, c.icon,
           COALESCE(mb.limit_amount, c.budget_limit) as budget_limit,
           c.offsets_category_id, c.type,
           COALESCE(SUM(t.amount), 0) as total, COUNT(t.id) as count,
           COALESCE(SUM(t.amount) FILTER (WHERE NOT COALESCE(t.is_extraordinary, false)), 0) as total_excl_extraordinary
           ${paceCols}
    FROM categories c
    LEFT JOIN monthly_budgets mb ON mb.category_id = c.id AND mb.year=${Number(year) || 0} AND mb.month=${Number(month) || 0}
    LEFT JOIN transactions t ON t.category_id = c.id AND ${baseWhere} AND NOT COALESCE(t.is_transfer, false)
    GROUP BY c.id, c.name, c.color, c.icon, mb.limit_amount, c.budget_limit, c.offsets_category_id, c.type
    HAVING COUNT(t.id) > 0 OR COALESCE(mb.limit_amount, c.budget_limit) IS NOT NULL
    ORDER BY total DESC
  `;

  let reimbWhere = range
    ? sql`offsets_category_id IS NOT NULL AND (ignored IS NULL OR ignored = 0) AND date >= ${range.start} AND date < ${range.end}`
    : sql`offsets_category_id IS NOT NULL AND (ignored IS NULL OR ignored = 0)`;
  if (until) reimbWhere = sql`${reimbWhere} AND date <= ${String(until)}`;

  const reimbPaceCols = paceUntil
    ? sql`, SUM(amount) FILTER (WHERE date <= ${paceUntil}) as pace_total,
           SUM(amount) FILTER (WHERE date <= ${windowUntil ?? ''}) as window_total`
    : sql``;
  const reimbQ = sql`SELECT offsets_category_id, SUM(amount) as total ${reimbPaceCols} FROM transactions WHERE ${reimbWhere} GROUP BY offsets_category_id`;

  // The three queries are independent — pipeline them on the single pooled connection.
  const [totals, byCategory, reimbRows] = await Promise.all([totalsQ, byCategoryQ, reimbQ]);
  const reimbMap = {};
  const reimbPaceMap = {};
  const reimbWindowMap = {};
  reimbRows.forEach((r) => {
    reimbMap[r.offsets_category_id] = Number(r.total);
    reimbPaceMap[r.offsets_category_id] = Number(r.pace_total || 0);
    reimbWindowMap[r.offsets_category_id] = Number(r.window_total || 0);
  });

  // Per-cut reimbursement adjustment, mirroring the full-month rule: a category's
  // reimbursed amount within a cut is capped at what was actually spent in that cut.
  const adjust = (total, reimb) => total - Math.min(reimb || 0, total);

  const adjustedByCategory = byCategory.map((r) => {
    const tot = Number(r.total);
    const totExcl = Number(r.total_excl_extraordinary);
    if (r.type === 'expense' && reimbMap[r.id]) {
      const reimbursed = Math.min(reimbMap[r.id], tot);
      return { ...r, total: tot - reimbursed, total_excl_extraordinary: adjust(totExcl, reimbMap[r.id]), reimbursed };
    }
    return { ...r, total: tot, total_excl_extraordinary: totExcl };
  });

  const income = Number(totals.find((r) => r.type === 'income')?.total || 0);
  const expense = Number(totals.find((r) => r.type === 'expense')?.total || 0);
  const transfers = totals.reduce((s, r) => s + Number(r.transfer_total || 0), 0);

  const out = { income, expense, transfers, balance: income - expense - transfers, byCategory: adjustedByCategory };

  if (paceUntil) {
    out.paceByCategory = byCategory.map((r) => {
      const isExp = r.type === 'expense';
      return {
        id: r.id, type: r.type,
        total: isExp ? adjust(Number(r.pace_total), reimbPaceMap[r.id]) : Number(r.pace_total),
        total_excl_extraordinary: isExp ? adjust(Number(r.pace_total_excl), reimbPaceMap[r.id]) : Number(r.pace_total_excl),
      };
    });
    if (windowUntil) {
      out.windowByCategory = byCategory.map((r) => ({
        id: r.id, type: r.type,
        total_excl_extraordinary: r.type === 'expense'
          ? adjust(Number(r.window_total_excl), reimbWindowMap[r.id])
          : Number(r.window_total_excl),
      }));
    }
  }

  return res.json(out);
}

async function handleMonthlyTrend(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { months = 6 } = req.query;
  const rows = await sql`
    SELECT to_char(date::date, 'YYYY-MM') as month, type, SUM(amount) as total
    FROM transactions
    WHERE date >= to_char(CURRENT_DATE - (${Number(months)} || ' months')::interval, 'YYYY-MM-DD')
      AND (ignored IS NULL OR ignored = 0) AND NOT COALESCE(is_transfer, false)
    GROUP BY to_char(date::date, 'YYYY-MM'), type
    ORDER BY month ASC
  `;
  return res.json(rows);
}

async function handleCategoryComparison(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { year, month } = req.query;
  if (!year || !month) return res.status(400).json({ error: 'year e month obrigatórios' });

  const y = Number(year), m = Number(month);
  const prevYear = m === 1 ? y - 1 : y;
  const prevMonth = m === 1 ? 12 : m - 1;

  const fetchByCategory = (yr, mo) => {
    const { start, end } = monthRange(yr, mo);
    return sql`
      SELECT c.id, c.name, c.icon, c.color, SUM(t.amount) as total
      FROM transactions t JOIN categories c ON t.category_id = c.id
      WHERE t.date >= ${start} AND t.date < ${end}
        AND t.type='expense' AND (t.ignored IS NULL OR t.ignored = 0) AND NOT COALESCE(t.is_transfer, false)
      GROUP BY c.id, c.name, c.icon, c.color
    `;
  };

  const [current, previous] = await Promise.all([fetchByCategory(y, m), fetchByCategory(prevYear, prevMonth)]);

  const prevMap = {};
  previous.forEach((r) => { prevMap[r.id] = Number(r.total); });

  const comparison = current
    .filter((r) => prevMap[r.id] != null && prevMap[r.id] > 0)
    .map((r) => {
      const cur = Number(r.total), prev = prevMap[r.id];
      return { id: r.id, name: r.name, icon: r.icon, color: r.color, current: cur, previous: prev, diff: cur - prev, pct: ((cur - prev) / prev) * 100 };
    })
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

  return res.json(comparison);
}

async function handleSimilar(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { description, exclude_id, new_category_id } = req.query;
  if (!description?.trim()) return res.json({ exact: [], similar: [] });

  const normalized = description.toLowerCase().trim();
  const excludeId = Number(exclude_id) || 0;
  const newCatId = Number(new_category_id) || null;

  const sel = sql`SELECT t.id, t.date, t.amount, t.type, t.description, t.category_id, t.notes,
    c.name as category_name, c.color as category_color, c.icon as category_icon
    FROM transactions t LEFT JOIN categories c ON t.category_id = c.id`;

  let exactCond = sql`LOWER(t.description) = ${normalized} AND t.id != ${excludeId}`;
  if (newCatId) exactCond = sql`${exactCond} AND (t.category_id IS NULL OR t.category_id != ${newCatId})`;

  const exact = await sql`${sel} WHERE ${exactCond} ORDER BY t.date DESC LIMIT 100`;

  const words = normalized.split(/[\s\-\/,\.()]+/).filter((w) => w.length > 3).slice(0, 6);
  let similar = [];

  if (words.length > 0) {
    const excludeIds = [excludeId, ...exact.map((e) => e.id)];
    let simCond = words.reduce(
      (acc, w) => sql`${acc} AND LOWER(t.description) LIKE ${'%' + w + '%'}`,
      sql`t.id != ALL(${excludeIds})`
    );
    if (newCatId) simCond = sql`${simCond} AND (t.category_id IS NULL OR t.category_id != ${newCatId})`;
    similar = await sql`${sel} WHERE ${simCond} ORDER BY t.date DESC LIMIT 50`;
  }

  return res.json({ exact, similar });
}

async function handleImportKeys(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { months } = req.body;
  if (!Array.isArray(months) || !months.length) return res.json({ keys: [] });
  const rows = await sql`
    SELECT import_key FROM transactions
    WHERE import_key IS NOT NULL AND substr(date,1,7) = ANY(${months})
  `;
  return res.json({ keys: rows.map((r) => r.import_key) });
}

async function handleRejectImports(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { keys } = req.body;
  if (!Array.isArray(keys) || !keys.length) return res.json({ stored: 0 });
  await sql`INSERT INTO rejected_imports ${sql(keys.map((key) => ({ key })))} ON CONFLICT DO NOTHING`;
  return res.json({ stored: keys.length });
}

async function handleRejectedImports(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const rows = await sql`SELECT key FROM rejected_imports`;
  return res.json({ keys: rows.map((r) => r.key) });
}

async function handleCategorySuggestions(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { descriptions } = req.body;
  if (!Array.isArray(descriptions) || !descriptions.length) return res.json([]);

  // All exact matches resolved in one query (instead of one round trip per
  // description); only the misses fall back to the per-description LIKE search.
  const normalizedAll = descriptions.map((d) => String(d).toLowerCase().trim());
  const exactRows = await sql`
    SELECT LOWER(description) as norm, category_id, COUNT(*) as cnt
    FROM transactions
    WHERE LOWER(description) = ANY(${normalizedAll}) AND category_id IS NOT NULL
    GROUP BY 1, 2
  `;
  const exactByDesc = new Map();
  exactRows.forEach((r) => {
    const cur = exactByDesc.get(r.norm);
    if (!cur || Number(r.cnt) > cur.cnt) exactByDesc.set(r.norm, { category_id: r.category_id, cnt: Number(r.cnt) });
  });

  const results = await Promise.all(descriptions.map(async (desc) => {
    const normalized = String(desc).toLowerCase().trim();

    const exact = exactByDesc.get(normalized);
    if (exact) return { description: desc, category_id: exact.category_id, confidence: 'exact', count: exact.cnt };

    const words = normalized.split(/[\s\-\/,\.()]+/).filter((w) => w.length > 3).slice(0, 5);
    if (!words.length) return { description: desc, category_id: null, confidence: null, count: 0 };

    const likeCond = words.reduce(
      (acc, w) => sql`${acc} AND LOWER(description) LIKE ${'%' + w + '%'}`,
      sql`category_id IS NOT NULL`
    );
    const [similar] = await sql`
      SELECT category_id, COUNT(*) as cnt FROM transactions WHERE ${likeCond}
      GROUP BY category_id ORDER BY cnt DESC LIMIT 1
    `;
    return { description: desc, category_id: similar?.category_id ?? null, confidence: similar ? 'similar' : null, count: Number(similar?.cnt ?? 0) };
  }));

  return res.json(results);
}

async function handleCategorizeAI(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { stable, variable, prompt } = req.body;
  // `stable` is identical across every batch of the same import run (categories,
  // rules, user history), so it's marked cacheable — only `variable` (the batch's
  // transaction list) changes per request.
  const stableText = stable ?? prompt;
  if (!stableText?.trim()) return res.status(400).json({ error: 'prompt é obrigatório' });

  try {
    const { text, usage } = await complete({
      model: MODELS.smartImport,
      system: 'Você é um assistente especializado em categorização de transações financeiras.',
      stable: stableText,
      variable,
      maxTokens: 4096,
      effort: 'low',
      jsonSchema: {
        type: 'object',
        properties: {
          categories: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'integer' },
                category_id: { type: 'integer' },
              },
              required: ['index', 'category_id'],
              additionalProperties: false,
            },
          },
        },
        required: ['categories'],
        additionalProperties: false,
      },
    });
    return res.json({ content: text, usage });
  } catch (err) {
    console.error('Categorize AI error:', err);
    return res.status(500).json({ error: 'Falha ao categorizar via IA.' });
  }
}

// One-shot forecast: everything the Dashboard's forecast chart needs for N months in
// 3 queries, replacing the old client-side loop of 2 requests × 12 months (each a
// fresh serverless invocation + DB connection). Projection rule mirrors the client's
// projectBucket: recurring categories land at max(actual, budget), others at actuals;
// actuals here are gross (reimbursements not subtracted), consistent with Saldo.
async function handleForecast(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { year, month, months = 12 } = req.query;
  if (!year || !month) return res.status(400).json({ error: 'year e month obrigatórios' });

  const n = Math.min(Number(months) || 12, 24);
  const y0 = Number(year), m0 = Number(month);
  const list = [];
  for (let i = 0; i < n; i++) {
    const m = ((m0 - 1 + i) % 12) + 1;
    const y = y0 + Math.floor((m0 - 1 + i) / 12);
    list.push({ y, m, ym: `${y}-${String(m).padStart(2, '0')}` });
  }
  const start = `${list[0].ym}-01`;
  const lastM = list[list.length - 1];
  const { end } = monthRange(lastM.y, lastM.m);

  const [cats, txByCat, transfersByMonth, budgets] = await Promise.all([
    sql`SELECT id, name, type, is_recurring FROM categories`,
    sql`SELECT substr(date,1,7) as ym, category_id, type, SUM(amount) as total
        FROM transactions
        WHERE (ignored IS NULL OR ignored = 0) AND NOT COALESCE(is_transfer, false)
          AND date >= ${start} AND date < ${end}
        GROUP BY 1, 2, 3`,
    sql`SELECT substr(date,1,7) as ym, SUM(amount) as total
        FROM transactions
        WHERE (ignored IS NULL OR ignored = 0) AND COALESCE(is_transfer, false)
          AND date >= ${start} AND date < ${end}
        GROUP BY 1`,
    sql`SELECT category_id, year, month, limit_amount FROM monthly_budgets
        WHERE (year * 100 + month) BETWEEN ${y0 * 100 + m0} AND ${lastM.y * 100 + lastM.m}`,
  ]);

  const catById = new Map(cats.map((c) => [c.id, c]));
  const recurring = new Set(cats.filter((c) => c.is_recurring).map((c) => c.id));
  const invCat = cats.find((c) => c.type === 'income' && /invest/i.test(c.name));

  const rows = list.map(({ y, m, ym }) => {
    const tx = txByCat.filter((r) => r.ym === ym);
    const bud = budgets.filter((b) => b.year === y && b.month === m);
    const transfers = Number(transfersByMonth.find((r) => r.ym === ym)?.total || 0);

    const actuals = { expense: new Map(), income: new Map() };
    const uncategorized = { expense: 0, income: 0 };
    let expense = 0, income = 0;
    tx.forEach((r) => {
      const t = Number(r.total);
      if (r.type === 'expense') expense += t; else income += t;
      if (r.category_id != null) {
        const map = actuals[r.type];
        map.set(r.category_id, (map.get(r.category_id) || 0) + t);
      } else {
        uncategorized[r.type] += t;
      }
    });

    const project = (type) => {
      let p = uncategorized[type];
      const budgeted = new Set();
      bud.forEach((b) => {
        const c = catById.get(b.category_id);
        if (!c || c.type !== type) return;
        budgeted.add(b.category_id);
        const a = actuals[type].get(b.category_id) || 0;
        p += recurring.has(b.category_id) ? Math.max(a, Number(b.limit_amount)) : a;
      });
      actuals[type].forEach((a, id) => { if (!budgeted.has(id)) p += a; });
      return p;
    };

    const budget = bud
      .filter((b) => catById.get(b.category_id)?.type === 'expense')
      .reduce((s, b) => s + Number(b.limit_amount), 0);

    return {
      year: y, month: m, expense, income, budget, transfers,
      projectedExpense: project('expense'),
      projectedIncome: project('income'),
      investment: invCat ? (actuals.income.get(invCat.id) || 0) : null,
    };
  });

  return res.json(rows);
}

// Active installment plans, derived from the `NN/NN` suffix Pluggy leaves in card
// descriptions (e.g. "LOJA EXEMPLO  07/10"). No dedicated table: future
// installments are already booked as future-dated transactions on the fatura; this
// just groups them into plans. A plan key is (normalized base description, total n) —
// the same merchant can have overlapping plans with different lengths. Requiring ≥2
// rows per plan filters out date-like false positives ("PGTO 15/07").
async function handleInstallments(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const today = String(req.query.today || new Date().toISOString().slice(0, 10));

  const rows = await sql`
    SELECT t.id, t.date, t.amount, t.description, t.category_id,
           c.name as category_name, c.icon as category_icon
    FROM transactions t LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.type='expense' AND (t.ignored IS NULL OR t.ignored=0) AND NOT COALESCE(t.is_transfer, false)
      AND t.description ~* ${INSTALLMENT_SQL_PATTERN}
  `;

  // Chave do plano: descrição + N não bastam — um mesmo comerciante recorrente (ex.
  // cobrança mensal que sempre vira 3x) gera várias compras distintas com a mesma
  // descrição normalizada e o mesmo N, cada uma com seu próprio ciclo de parcelas.
  // O valor da parcela é estável dentro de uma mesma compra parcelada (mesmo valor
  // todo mês), então entra na chave para não misturar compras diferentes num só plano.
  const plans = new Map();
  for (const r of rows) {
    const parsed = parseInstallment(r.description);
    if (!parsed) continue;
    const key = `${parsed.base.toLowerCase()}|${parsed.n}|${Number(r.amount).toFixed(2)}`;
    if (!plans.has(key)) plans.set(key, { description: parsed.base, total: parsed.n, rows: [] });
    plans.get(key).rows.push({ ...r, k: parsed.k });
  }

  const out = [];
  const byMonth = {};
  for (const p of plans.values()) {
    if (p.rows.length < 2) continue;
    const futureRows = p.rows.filter((r) => r.date > today);
    if (!futureRows.length) continue; // plan already finished
    const paidRows = p.rows.filter((r) => r.date <= today);
    const last = p.rows.reduce((a, b) => (a.date > b.date ? a : b));
    const remaining = futureRows.reduce((s, r) => s + Number(r.amount), 0);
    // Paid count: installments before the import-history window may be absent, so
    // "min future k − 1" is often more truthful than counting past-dated rows.
    const paidCount = Math.max(
      Math.max(0, ...paidRows.map((r) => r.k)),
      Math.min(...futureRows.map((r) => r.k)) - 1
    );
    const planByMonth = {};
    futureRows.forEach((r) => {
      const mk = r.date.slice(0, 7);
      byMonth[mk] = (byMonth[mk] || 0) + Number(r.amount);
      planByMonth[mk] = (planByMonth[mk] || 0) + Number(r.amount);
    });
    out.push({
      description: p.description,
      total_installments: p.total,
      paid_installments: paidCount,
      installment_amount: Number(last.amount),
      remaining_amount: remaining,
      remaining_count: futureRows.length,
      ends: last.date.slice(0, 7),
      category_name: last.category_name,
      category_icon: last.category_icon,
      by_month: planByMonth,
    });
  }
  out.sort((a, b) => b.remaining_amount - a.remaining_amount);
  const totalRemaining = out.reduce((s, p) => s + p.remaining_amount, 0);
  return res.json({ plans: out, totalRemaining, byMonth });
}

// AI month-close report: gathers the month's data server-side and asks Claude for a
// narrative analysis. The system prompt explains how planned income (including planned
// investment withdrawals) should be read, so withdrawals within plan aren't mistaken
// for burning savings. Reports are persisted in `monthly_reports` (one
// per year/month, upserted on regenerate) so they're available from any device
// instead of living only in the browser's localStorage.
async function handleMonthlyReport(req, res) {
  if (req.method === 'GET') {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ error: 'year e month obrigatórios' });
    const [row] = await sql`SELECT content, created_at, model FROM monthly_reports WHERE year=${Number(year)} AND month=${Number(month)}`;
    return res.json(row ? { report: row.content, created_at: row.created_at, model: row.model } : { report: null });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { year, month } = req.body;
  if (!year || !month) return res.status(400).json({ error: 'year e month obrigatórios' });

  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const pym = `${prev.y}-${String(prev.m).padStart(2, '0')}`;
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const nextStart = `${next.y}-${String(next.m).padStart(2, '0')}-01`;

  const cats = await sql`
    SELECT c.id, c.name, c.type, c.is_recurring,
           COALESCE(mb.limit_amount, c.budget_limit) as budget,
           COALESCE(cur.total, 0) as current_total,
           COALESCE(prv.total, 0) as previous_total,
           COALESCE(rb.total, 0) as reimbursed
    FROM categories c
    LEFT JOIN monthly_budgets mb ON mb.category_id=c.id AND mb.year=${Number(year)} AND mb.month=${Number(month)}
    LEFT JOIN (SELECT category_id, SUM(amount) as total FROM transactions WHERE date >= ${ym + '-01'} AND date < ${nextStart} AND (ignored IS NULL OR ignored=0) AND NOT COALESCE(is_transfer, false) GROUP BY category_id) cur ON cur.category_id=c.id
    LEFT JOIN (SELECT category_id, SUM(amount) as total FROM transactions WHERE date >= ${pym + '-01'} AND date < ${ym + '-01'} AND (ignored IS NULL OR ignored=0) AND NOT COALESCE(is_transfer, false) GROUP BY category_id) prv ON prv.category_id=c.id
    LEFT JOIN (SELECT offsets_category_id as cid, SUM(amount) as total FROM transactions WHERE date >= ${ym + '-01'} AND date < ${nextStart} AND offsets_category_id IS NOT NULL AND (ignored IS NULL OR ignored=0) GROUP BY offsets_category_id) rb ON rb.cid=c.id
    WHERE COALESCE(cur.total,0) > 0 OR COALESCE(prv.total,0) > 0 OR COALESCE(mb.limit_amount, c.budget_limit) IS NOT NULL
  `;

  const futureCommitted = await sql`
    SELECT substr(date,1,7) as mes, SUM(amount) as total
    FROM transactions
    WHERE type='expense' AND (ignored IS NULL OR ignored=0) AND NOT COALESCE(is_transfer, false) AND date >= ${nextStart}
    GROUP BY substr(date,1,7) ORDER BY mes LIMIT 6
  `;

  const receitas = cats.filter((c) => c.type === 'income').map((c) => ({
    nome: c.name, planejado: Number(c.budget) || 0, realizado: Number(c.current_total), mes_anterior: Number(c.previous_total),
  }));
  const despesas = cats.filter((c) => c.type === 'expense').map((c) => ({
    nome: c.name, fixa: !!c.is_recurring, orcado: Number(c.budget) || 0,
    gasto: Number(c.current_total) - Number(c.reimbursed),
    reembolsado: Number(c.reimbursed) || undefined,
    mes_anterior: Number(c.previous_total),
  }));

  const data = {
    mes: ym,
    renda_mensal_planejada: receitas.reduce((s, r) => s + r.planejado, 0),
    receitas,
    despesas,
    parcelas_ja_lancadas_meses_futuros: Object.fromEntries(futureCommitted.map((r) => [r.mes, Number(r.total)])),
  };

  const system = `Você é um analista financeiro sênior especializado em orçamento familiar. Escreva em português do Brasil, tom direto e prático, sem jargão.

Contexto: \`renda_mensal_planejada\` é a soma dos valores planejados das categorias de receita. Se houver uma categoria de resgate de investimentos com valor planejado, resgates ATÉ esse valor fazem parte do planejamento (não são queima de patrimônio); apenas resgates ACIMA do planejado indicam consumo de patrimônio além do previsto. Categorias marcadas como fixas são fixas até o valor orçado; o excedente é variável.

Estruture o relatório em markdown simples (títulos ##, bullets -, negrito **), sem tabelas. Seções: 1) Resumo do mês (3-4 bullets com os números-chave); 2) Desvios relevantes (vs. orçamento e vs. mês anterior — só o que importa, com valores); 3) Receitas e resgates vs. planejado (leitura correta pelo contexto acima); 4) Comprometimento futuro (parcelas já lançadas); 5) Recomendações (máx. 3, específicas e acionáveis). Máximo ~450 palavras. Valores em R$ com separador de milhar.`;

  try {
    const result = await complete({
      model: MODELS.monthlyReport,
      // Newer models think before answering, and thinking counts against max_tokens:
      // at 1500 the whole budget went to thinking and the reply came back empty.
      maxTokens: 8000,
      system,
      stable: `Gere o relatório de fechamento do mês ${ym} com base nestes dados:\n\n${JSON.stringify(data, null, 1)}`,
    });
    const text = result.text.trim();
    // Never persist an empty report — it would overwrite a good one and the UI
    // would show nothing.
    if (!text) {
      console.error('Monthly report empty:', result.stopReason, result.usage);
      return res.status(502).json({ error: 'A IA não retornou texto. Tente novamente.' });
    }
    const [saved] = await sql`
      INSERT INTO monthly_reports (year, month, content, model)
      VALUES (${Number(year)}, ${Number(month)}, ${text}, ${MODELS.monthlyReport})
      ON CONFLICT (year, month) DO UPDATE SET content=${text}, model=${MODELS.monthlyReport}, created_at=to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
      RETURNING created_at
    `;
    return res.json({ report: text, usage: result.usage, created_at: saved.created_at, model: MODELS.monthlyReport });
  } catch (err) {
    console.error('Monthly report error:', err);
    return res.status(500).json({ error: 'Falha ao gerar relatório.' });
  }
}

// Global search across the whole history (the month view filters client-side; this
// is the "Buscar em todo o histórico" mode). LOWER(description) LIKE hits the trigram
// index idx_transactions_desc_trgm; notes has no index but the OR branch is cheap at
// this table size. Aggregates (totals, per-month breakdown) are computed client-side
// from the returned rows so they always match the visible/filtered table.
async function handleSearch(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ transactions: [], total: 0 });

  const pattern = '%' + q.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%';
  const cond = sql`(LOWER(t.description) LIKE ${pattern} OR LOWER(t.notes) LIKE ${pattern} OR t.amount::text LIKE ${pattern})`;

  const [rows, countRows] = await Promise.all([
    sql`${TRANSACTION_SELECT} WHERE ${cond} ORDER BY t.date DESC, t.created_at DESC LIMIT 2000`,
    sql`SELECT COUNT(*) as count FROM transactions t WHERE ${cond}`,
  ]);
  return res.json({ transactions: rows, total: Number(countRows[0].count) });
}

async function handleLastUpdated(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const [row] = await sql`SELECT MAX(created_at) as ts FROM transactions`;
  return res.json({ ts: row?.ts || null });
}

async function handleActiveMonths(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const rows = await sql`
    SELECT DISTINCT to_char(date::date, 'YYYY')::int as year, to_char(date::date, 'MM')::int as month
    FROM transactions
    ORDER BY year, month
  `;
  return res.json(rows);
}

async function handleCategoryMonthly(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { category_id, months = 6 } = req.query;
  if (!category_id) return res.status(400).json({ error: 'category_id obrigatório' });
  const rows = await sql`
    SELECT to_char(date::date, 'YYYY-MM') as month, SUM(amount) as total
    FROM transactions
    WHERE category_id = ${Number(category_id)}
      AND date >= to_char(CURRENT_DATE - (${Number(months)} || ' months')::interval, 'YYYY-MM-DD')
      AND (ignored IS NULL OR ignored = 0) AND NOT COALESCE(is_transfer, false)
    GROUP BY to_char(date::date, 'YYYY-MM')
    ORDER BY month ASC
  `;
  return res.json(rows);
}

const NAMED_ROUTES = {
  bulk: handleBulk,
  'bulk-category': handleBulkCategory,
  summary: handleSummary,
  'monthly-trend': handleMonthlyTrend,
  'category-comparison': handleCategoryComparison,
  similar: handleSimilar,
  'import-keys': handleImportKeys,
  'reject-imports': handleRejectImports,
  'rejected-imports': handleRejectedImports,
  'category-suggestions': handleCategorySuggestions,
  'categorize-ai': handleCategorizeAI,
  forecast: handleForecast,
  installments: handleInstallments,
  'monthly-report': handleMonthlyReport,
  search: handleSearch,
  'last-updated': handleLastUpdated,
  'active-months': handleActiveMonths,
  'category-monthly': handleCategoryMonthly,
};

async function handler(req, res) {
  const seg = req.query['...path']; const path = seg != null ? [seg] : [];

  if (path.length === 0) return handleRoot(req, res);

  if (path.length === 1) {
    const named = NAMED_ROUTES[path[0]];
    if (named) return named(req, res);
    return handleById(req, res, path[0]);
  }

  res.status(404).json({ error: 'Not found' });
}

export default requireAuth(handler);
