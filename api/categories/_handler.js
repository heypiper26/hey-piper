import sql from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';

async function handler(req, res) {
  const seg = req.query['...path']; const path = seg != null ? [seg] : [];

  // /api/categories
  if (path.length === 0) {
    if (req.method === 'GET') {
      const rows = await sql`SELECT * FROM categories ORDER BY type, name`;
      return res.json(rows);
    }

    if (req.method === 'POST') {
      const { name, type, color, icon, budget_limit, offsets_category_id, offset_description_filter } = req.body;
      if (!name || !type) return res.status(400).json({ error: 'name e type são obrigatórios' });
      try {
        const [row] = await sql`
          INSERT INTO categories (name, type, color, icon, budget_limit, offsets_category_id, offset_description_filter)
          VALUES (${name}, ${type}, ${color || '#6366f1'}, ${icon || '💰'}, ${budget_limit ?? null}, ${offsets_category_id ?? null}, ${offset_description_filter ?? null})
          RETURNING *
        `;
        return res.status(201).json(row);
      } catch (e) {
        if (e.code === '23505') return res.status(409).json({ error: `Já existe uma categoria com o nome "${name}"` });
        throw e;
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }

  // /api/categories/:id
  if (path.length === 1) {
    const [id] = path;

    if (req.method === 'PUT') {
      const { name, type, color, icon, budget_limit, offsets_category_id, offset_description_filter } = req.body;
      const [row] = await sql`
        UPDATE categories SET name=${name}, type=${type}, color=${color}, icon=${icon},
          budget_limit=${budget_limit ?? null}, offsets_category_id=${offsets_category_id ?? null},
          offset_description_filter=${offset_description_filter ?? null}
        WHERE id=${id} RETURNING *
      `;
      return res.json(row);
    }

    if (req.method === 'PATCH') {
      const { is_recurring } = req.body;
      const [row] = await sql`
        UPDATE categories SET is_recurring=${!!is_recurring} WHERE id=${id} RETURNING *
      `;
      return res.json(row);
    }

    if (req.method === 'DELETE') {
      await sql`DELETE FROM categories WHERE id=${id}`;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.status(404).json({ error: 'Not found' });
}

export default requireAuth(handler);
