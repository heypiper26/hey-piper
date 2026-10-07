import sql from '../../lib/db.js';
import { requireAuth } from '../../lib/auth.js';
import { snapshotNow, fetchHistory } from '../../lib/patrimonio.js';

// GET /patrimonio/data — rápido, só banco: curva histórica + última foto gravada.
// (Serviço sob subpath, não na raiz, para o recurso caber num único [...path].js —
// o catch-all de segmento único não atende a raiz /patrimonio, e evitamos um index.js
// extra por causa do limite de 12 Serverless Functions do plano Hobby.)
async function handleData(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const history = await fetchHistory();
  const [latest] = await sql`
    SELECT date, contas, investimentos, manuais, dividas, patrimonio, detalhes
    FROM patrimonio_snapshots
    ORDER BY date DESC
    LIMIT 1
  `;

  return res.json({ history, latest: latest || null });
}

// GET/POST/PUT/DELETE /patrimonio/manual — bens/dívidas sem API (conta no exterior,
// imóvel, veículo). Uma rota de segmento único, despachada por método (o roteador do
// projeto só trata um segmento). Após cada mutação regrava a foto de hoje (best-effort,
// via snapshotNow) para o patrimônio refletir o item na hora; se a Pluggy falhar, os
// dados manuais persistem e o próximo refresh/cron reconcilia.
const CATEGORIAS = ['Conta no exterior', 'Imóvel', 'Veículo', 'Previdência', 'Ações Globais', 'Outro'];

function parseItem(body) {
  const nome = (body?.nome || '').trim();
  const categoria = CATEGORIAS.includes(body?.categoria) ? body.categoria : 'Outro';
  const valor = Number(body?.valor);
  const incluirInvestimentos = !!body?.incluir_investimentos;
  if (!nome) return { error: 'Nome obrigatório' };
  if (!Number.isFinite(valor)) return { error: 'Valor inválido' };
  return { nome, categoria, valor: Math.round(valor * 100) / 100, incluirInvestimentos };
}

async function handleManual(req, res) {
  if (req.method === 'GET') {
    const items = await sql`SELECT id, nome, categoria, valor, incluir_investimentos, updated_at FROM patrimonio_manual ORDER BY valor DESC`;
    return res.json({ items });
  }

  if (req.method === 'POST') {
    const p = parseItem(req.body);
    if (p.error) return res.status(400).json({ error: p.error });
    await sql`INSERT INTO patrimonio_manual (nome, categoria, valor, incluir_investimentos) VALUES (${p.nome}, ${p.categoria}, ${p.valor}, ${p.incluirInvestimentos})`;
  } else if (req.method === 'PUT') {
    const id = Number(req.body?.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id obrigatório' });
    const p = parseItem(req.body);
    if (p.error) return res.status(400).json({ error: p.error });
    await sql`
      UPDATE patrimonio_manual
      SET nome = ${p.nome}, categoria = ${p.categoria}, valor = ${p.valor},
          incluir_investimentos = ${p.incluirInvestimentos},
          updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
      WHERE id = ${id}
    `;
  } else if (req.method === 'DELETE') {
    const id = Number(req.body?.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id obrigatório' });
    await sql`DELETE FROM patrimonio_manual WHERE id = ${id}`;
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Reflete a mudança no patrimônio já: regrava a foto de hoje. Best-effort — não
  // derruba a mutação (já commitada) se a Pluggy estiver indisponível.
  await snapshotNow().catch((e) => console.warn('snapshot após edição manual:', e.message));

  const items = await sql`SELECT id, nome, categoria, valor, incluir_investimentos, updated_at FROM patrimonio_manual ORDER BY valor DESC`;
  return res.json({ items });
}

// POST /patrimonio/refresh — busca ao vivo na Pluggy, grava a foto de hoje e devolve
// foto atual + curva atualizada. É assim que a série cresce quando disparada manualmente.
async function handleRefresh(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const current = await snapshotNow();
  const history = await fetchHistory();
  return res.json({ current, history });
}

// GET /patrimonio/cron — disparado pelo Vercel Cron (ver `crons` em vercel.json).
// Chamado por GET, sem sessão do usuário, então protegido por segredo em vez de senha:
// com CRON_SECRET definido, a Vercel envia `Authorization: Bearer <CRON_SECRET>`. Fica
// FORA do requireAuth (por isso o dispatcher trata cron antes de aplicar a autenticação).
async function handleCron(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const current = await snapshotNow();
    return res.json({ ok: true, date: current.date, patrimonio: current.patrimonio });
  } catch (e) {
    console.error('patrimonio cron:', e);
    return res.status(500).json({ error: e.message || 'Erro ao gravar snapshot' });
  }
}

const NAMED_ROUTES = {
  data: handleData,
  refresh: handleRefresh,
  manual: handleManual,
};

// req.query['...path'] vem como string (1 segmento) ou array; normaliza pra array.
// Todas as rotas de patrimônio usam no máximo 1 segmento.
function segments(req) {
  const seg = req.query['...path'];
  if (seg == null) return [];
  return Array.isArray(seg) ? seg : [seg];
}

async function coreHandler(req, res) {
  const path = segments(req);
  if (path.length === 1) {
    const named = NAMED_ROUTES[path[0]];
    if (named) return named(req, res);
  }
  res.status(404).json({ error: 'Not found' });
}

const authedHandler = requireAuth(coreHandler);

// Único ponto de entrada (rota catch-all opcional [[...path]].js, que atende tanto
// /patrimonio quanto /patrimonio/*). Consolida index + subrotas + cron num só arquivo
// para caber no limite de 12 Serverless Functions do plano Hobby da Vercel.
export default function handler(req, res) {
  const path = segments(req);
  if (path[0] === 'cron') return handleCron(req, res);
  return authedHandler(req, res);
}
