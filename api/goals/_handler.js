import sql from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';

async function handler(req, res) {
  const seg = req.query['...path']; const path = seg != null ? [seg] : [];

  // /api/goals
  if (path.length === 0) {
    if (req.method === 'GET') {
      const rows = await sql`SELECT * FROM savings_goals ORDER BY created_at DESC`;
      return res.json(rows);
    }

    if (req.method === 'POST') {
      const { name, target_amount, current_amount, deadline, color, icon } = req.body;
      if (!name || !target_amount) return res.status(400).json({ error: 'name e target_amount são obrigatórios' });
      const [row] = await sql`
        INSERT INTO savings_goals (name, target_amount, current_amount, deadline, color, icon)
        VALUES (${name}, ${Number(target_amount)}, ${Number(current_amount || 0)}, ${deadline || null}, ${color || '#10b981'}, ${icon || '🎯'})
        RETURNING *
      `;
      return res.status(201).json(row);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }

  // /api/goals/:id
  if (path.length === 1) {
    const [id] = path;

    if (req.method === 'PUT') {
      const { name, target_amount, current_amount, deadline, color, icon } = req.body;
      const [row] = await sql`
        UPDATE savings_goals SET name=${name}, target_amount=${Number(target_amount)},
          current_amount=${Number(current_amount || 0)}, deadline=${deadline || null},
          color=${color}, icon=${icon}
        WHERE id=${id} RETURNING *
      `;
      return res.json(row);
    }

    if (req.method === 'DELETE') {
      await sql`DELETE FROM savings_goals WHERE id=${id}`;
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.status(404).json({ error: 'Not found' });
}

export default requireAuth(handler);
