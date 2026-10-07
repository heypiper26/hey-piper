import sql from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';

async function handler(req, res) {
  const seg = req.query['...path']; const path = seg != null ? [seg] : [];

  // /api/budgets
  if (path.length === 0) {
    if (req.method === 'GET') {
      const { year, month } = req.query;
      if (!year || !month) return res.status(400).json({ error: 'year e month são obrigatórios' });
      const rows = await sql`
        SELECT category_id, limit_amount FROM monthly_budgets WHERE year=${Number(year)} AND month=${Number(month)}
      `;
      return res.json(rows);
    }

    if (req.method === 'PUT') {
      const { year, month, budgets } = req.body;
      if (!year || !month || !Array.isArray(budgets)) return res.status(400).json({ error: 'year, month e budgets são obrigatórios' });
      for (const { category_id, limit_amount } of budgets) {
        if (limit_amount == null || limit_amount === '') {
          await sql`DELETE FROM monthly_budgets WHERE category_id=${category_id} AND year=${Number(year)} AND month=${Number(month)}`;
        } else {
          await sql`
            INSERT INTO monthly_budgets (category_id, year, month, limit_amount) VALUES (${category_id}, ${Number(year)}, ${Number(month)}, ${Number(limit_amount)})
            ON CONFLICT (category_id, year, month) DO UPDATE SET limit_amount = EXCLUDED.limit_amount
          `;
        }
      }
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }

  // /api/budgets/copy
  if (path.length === 1 && path[0] === 'copy') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { from_year, from_month, to_year, to_month } = req.body;
    if (!from_year || !from_month || !to_year || !to_month) return res.status(400).json({ error: 'Parâmetros obrigatórios faltando' });

    const source = await sql`SELECT category_id, limit_amount FROM monthly_budgets WHERE year=${Number(from_year)} AND month=${Number(from_month)}`;
    if (!source.length) return res.status(404).json({ error: 'Nenhum orçamento encontrado no mês de origem' });

    for (const { category_id, limit_amount } of source) {
      await sql`
        INSERT INTO monthly_budgets (category_id, year, month, limit_amount) VALUES (${category_id}, ${Number(to_year)}, ${Number(to_month)}, ${limit_amount})
        ON CONFLICT (category_id, year, month) DO UPDATE SET limit_amount = EXCLUDED.limit_amount
      `;
    }
    return res.json({ ok: true, copied: source.length });
  }

  res.status(404).json({ error: 'Not found' });
}

export default requireAuth(handler);
