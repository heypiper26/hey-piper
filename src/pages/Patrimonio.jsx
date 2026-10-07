import { useState, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { PiggyBank, RefreshCw, Loader2, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { useApi } from '../hooks/useApi.js';
import { api } from '../api.js';
import { fmt } from '../utils/format.js';
import { useHideValues, mask } from '../hooks/useHideValues.js';

// Rótulos amigáveis por classe de investimento (subtype tem prioridade sobre type).
const CLASS_LABELS = {
  STOCK: 'Ações / ETF', ETF: 'Ações / ETF', EQUITY: 'Ações / ETF',
  RDB: 'RDB', LCI: 'LCI', LCA: 'LCA', BOND: 'Renda Fixa',
  MUTUAL_FUND: 'Fundos', FUND: 'Fundos', FIXED_INCOME: 'Renda Fixa',
};
const CLASS_COLOR = {
  'Ações / ETF': '#22d3ee', 'CDB - Pós Fixado': '#818cf8', 'CDB - Pré Fixado': '#6366f1',
  'RDB': '#a5b4fc', 'LCI': '#f472b6', 'LCA': '#fbbf24', 'Tesouro Direto - IPCA+': '#34d399',
  'Fundos': '#a78bfa', 'Renda Fixa': '#6366f1', 'Ações Globais': '#f97316',
  'ETF - Pós Fixado': '#818cf8',
};
// Override manual de classe por nome do ativo, para quando a Pluggy classifica mal
// (ex.: um ETF de renda fixa que vem como EQUITY/STOCK, sem rate/rateType). Chave =
// `name` exatamente como vem da Pluggy; valor = um rótulo de CLASS_COLOR.
// Ex.: { 'TICKER11': 'ETF - Pós Fixado' }
const NAME_OVERRIDES = {};
// CDB é segregado por pré/pós-fixado pelo rateType: com CDI é pós-fixado. Nem todo
// emissor expõe rateType via Pluggy; sem ele, o título é tratado como pré-fixado —
// ajuste via NAME_OVERRIDES se não for o seu caso.
// Tesouro Direto é segregado pelo índice do rateType (só IPCA por enquanto).
// Itens manuais marcados "incluir nos investimentos" (ex. Ações Globais) usam a
// própria categoria como rótulo de grupo, em vez do subtype/type da Pluggy.
const classify = (it) => {
  if (NAME_OVERRIDES[it.name]) return NAME_OVERRIDES[it.name];
  if (it.manual) return it.categoria || 'Outros';
  if (it.subtype === 'CDB') {
    return String(it.rateType || '').toUpperCase().includes('CDI') ? 'CDB - Pós Fixado' : 'CDB - Pré Fixado';
  }
  if (it.subtype === 'TREASURY') {
    return `Tesouro Direto - ${it.rateType ? `${it.rateType}+` : '?'}`;
  }
  return CLASS_LABELS[it.subtype] || CLASS_LABELS[it.type] || it.subtype || it.type || 'Outros';
};
const classColor = (label) => CLASS_COLOR[label] || '#64748b';

// Indexador: agrupa os rótulos de classe pelo indexador (Pós-fixado, Pré-fixado,
// IPCA+, Ações Globais...), independente do produto (CDB, ETF, Tesouro). Usado no
// gráfico de pizza da página de Patrimônio.
const INDEXER_COLOR = {
  'Pós-fixado': '#818cf8', 'Pré-fixado': '#6366f1', 'IPCA+': '#34d399', 'Ações Globais': '#f97316',
};
function indexerOf(label) {
  if (label.includes('Pós Fixado')) return 'Pós-fixado';
  if (label.includes('Pré Fixado')) return 'Pré-fixado';
  if (label.startsWith('Tesouro Direto - ')) return label.split(' - ')[1];
  return label;
}
const indexerColor = (label) => INDEXER_COLOR[label] || '#64748b';

// dueDate vem da Pluggy em ISO (ex. "2030-01-01T00:00:00.000Z"), diferente do
// YYYY-MM-DD usado no resto do app — por isso um formatador dedicado aqui.
function formatDueDate(d) {
  if (!d) return null;
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Consolida os títulos de um mesmo emissor por data de vencimento (soma o saldo dos
// que caem no mesmo dia), ordenado por vencimento — os sem data (ações/fundos) por
// último. Guarda rate/rateType do primeiro título do dia para exibir a taxa (Tesouro).
function groupByDueDate(items) {
  const map = new Map();
  for (const it of items) {
    const key = it.dueDate || '';
    const e = map.get(key) || { dueDate: it.dueDate || null, balance: 0, count: 0, rate: it.rate ?? null, rateType: it.rateType ?? null };
    e.balance += Number(it.balance) || 0;
    e.count += 1;
    map.set(key, e);
  }
  return [...map.values()].sort((a, b) => {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
}

// "IPCA + 6%", "100% do CDI", "6,5% a.a. (pré)" — usado no drill-down do Tesouro
// Direto, onde a taxa ajuda a diferenciar títulos com o mesmo vencimento.
function rateLabel(rate, rateType) {
  if (!rate && !rateType) return null;
  const type = rateType ? String(rateType).toUpperCase() : '';
  if (type.includes('CDI')) return `${rate}% do CDI`;
  if (type.includes('IPCA')) return `IPCA + ${rate}%`;
  if (type.includes('PRE') || type.includes('FIXED')) return `${rate}% a.a. (pré)`;
  if (!rate) return rateType;
  return `${rate}% (${rateType})`;
}

// Intervalo exibido: cada preset vira uma data-corte (YYYY-MM-DD) comparada direto
// com o `date` do snapshot (também YYYY-MM-DD, ordenável como string).
const RANGES = [
  { key: 'ytd', label: 'YTD' },
  { key: '12m', label: '12 meses' },
  { key: 'all', label: 'Tudo' },
];
function cutoffFor(key) {
  const d = new Date();
  if (key === 'ytd') return `${d.getFullYear()}-01-01`;
  if (key === '12m') d.setFullYear(d.getFullYear() - 1);
  else return '0000-01-01';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}

// Granularidade: agrupa os snapshots em pontos por dia/semana/mês, usando o valor de
// FIM de período (último snapshot do bucket) — a forma padrão de ver patrimônio no tempo.
const GRANS = [
  { key: 'day', label: 'Dia' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mês' },
];
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // 0 = segunda
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
function bucketKey(dateStr, gran) {
  if (gran === 'month') return dateStr.slice(0, 7); // YYYY-MM
  if (gran === 'week') return mondayOf(dateStr);
  return dateStr;
}

function ChartTooltip({ active, payload, hidden }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-gray-400 mb-1">{fmt.date(p.date)}</p>
      <p className="text-white font-medium">{mask(fmt.currency(p.patrimonio), hidden)}</p>
      <p className="text-gray-500">Contas: {mask(fmt.currency(p.contas), hidden)}</p>
      <p className="text-gray-500">Investimentos: {mask(fmt.currency(p.investimentos), hidden)}</p>
      {Number(p.manuais) ? <p className="text-gray-500">Bens e Obrigações: {mask(fmt.currency(p.manuais), hidden)}</p> : null}
      <p className="text-gray-500">Dívidas: {mask(fmt.currency(p.dividas), hidden)}</p>
    </div>
  );
}

function IndexerTooltip({ active, payload, hidden }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm shadow-xl">
      <p className="text-gray-200 font-medium">{d.name}</p>
      <p className="text-gray-400">{mask(fmt.currency(d.value), hidden)}</p>
    </div>
  );
}

export default function Patrimonio() {
  const { hidden } = useHideValues();
  const { data, loading, reload } = useApi(() => api.getPatrimonio(), []);

  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [range, setRange] = useState('12m');
  const [gran, setGran] = useState('day');
  const [expandedIssuers, setExpandedIssuers] = useState(new Set());

  function toggleIssuer(key) {
    setExpandedIssuers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      await api.refreshPatrimonio();
      await reload();
    } catch (e) {
      setError(e.message || 'Falha ao atualizar.');
    } finally {
      setRefreshing(false);
    }
  }

  const history = data?.history || [];
  const latest = data?.latest || null;
  const det = latest?.detalhes || null;

  const chartData = useMemo(() => {
    const cutoff = cutoffFor(range);
    const inRange = history.filter((h) => h.date >= cutoff);
    // history vem em ordem crescente, então sobrescrever por bucket deixa o último
    // snapshot de cada semana/mês (valor de fim de período). O Map preserva a ordem
    // cronológica de inserção.
    const byBucket = new Map();
    for (const h of inRange) byBucket.set(bucketKey(h.date, gran), h);
    return [...byBucket.values()].map((h) => ({ ...h, ts: Date.parse(`${h.date}T00:00:00Z`) }));
  }, [history, range, gran]);

  // Alocação por classe: agrega os saldos por classe de ativo (a visão que dá pra ler
  // rápido, em vez de dezenas de linhas soltas).
  const alloc = useMemo(() => {
    const items = det?.investimentos || [];
    const byClass = {};
    for (const it of items) {
      const label = classify(it);
      byClass[label] = (byClass[label] || 0) + (Number(it.balance) || 0);
    }
    const total = Object.values(byClass).reduce((s, v) => s + v, 0);
    const rows = Object.entries(byClass)
      .map(([label, value]) => ({ label, value, pct: total ? value / total : 0 }))
      .filter((r) => r.value > 0.005)
      .sort((a, b) => b.value - a.value);
    return { total, rows };
  }, [det]);

  // Ativos agrupados por tipo: dentro de cada classe soma entradas de mesmo nome
  // (vários "CDB - BANCO X" viram uma linha, emissor), esconde os zerados e ordena por
  // valor. Cada linha de emissor guarda os títulos crus para o drill-down por
  // vencimento (groupByDueDate, calculado sob demanda ao expandir).
  const groups = useMemo(() => {
    const byClass = {};
    for (const it of det?.investimentos || []) {
      const bal = Number(it.balance) || 0;
      if (bal <= 0.005) continue;
      const label = classify(it);
      if (!byClass[label]) byClass[label] = { label, total: 0, byName: {} };
      const g = byClass[label];
      g.total += bal;
      const key = it.name || 'Sem nome';
      if (!g.byName[key]) g.byName[key] = { name: key, balance: 0, items: [] };
      g.byName[key].balance += bal;
      g.byName[key].items.push(it);
    }
    return Object.values(byClass)
      .map((g) => ({ label: g.label, total: g.total, items: Object.values(g.byName).sort((a, b) => b.balance - a.balance) }))
      .sort((a, b) => b.total - a.total);
  }, [det]);

  // Por indexador: mesma base de `groups`, mas agregada por Pós-fixado/Pré-fixado/
  // IPCA+/Ações Globais em vez de por produto — alimenta o gráfico de pizza.
  const byIndexer = useMemo(() => {
    const map = new Map();
    for (const g of groups) {
      const key = indexerOf(g.label);
      map.set(key, (map.get(key) || 0) + g.total);
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [groups]);
  const indexerTotal = useMemo(() => byIndexer.reduce((s, r) => s + r.value, 0), [byIndexer]);

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">Patrimônio</h1>
          <p className="text-sm text-gray-500">
            {latest ? `Última foto: ${fmt.date(latest.date)}` : 'Evolução do patrimônio líquido'}
          </p>
        </div>
        <button onClick={refresh} disabled={refreshing} className="btn-primary flex items-center gap-2 self-start">
          {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          {refreshing ? 'Atualizando...' : 'Atualizar agora'}
        </button>
      </div>

      {error && (
        <div className="card border border-red-500/30 bg-red-500/5 text-sm text-red-300">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Carregando...</p>
      ) : !latest ? (
        <div className="card text-center py-12">
          <PiggyBank size={32} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-300 font-medium">Nenhuma foto de patrimônio ainda</p>
          <p className="text-sm text-gray-500 mt-1 max-w-sm mx-auto">
            Clique em <span className="text-indigo-400">Atualizar agora</span> para buscar seus saldos e
            investimentos na Pluggy e gravar a primeira foto. A curva de evolução aparece conforme você
            registra fotos em dias diferentes.
          </p>
        </div>
      ) : (
        <>
          {/* Hero: patrimônio líquido + composição em uma linha compacta */}
          <div className="card">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Patrimônio líquido</p>
            <p className="text-3xl font-bold text-white tracking-tight">
              {mask(fmt.currency(latest.patrimonio), hidden)}
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-4 text-sm">
              <span className="text-gray-500">
                Contas <span className={latest.contas < 0 ? 'text-rose-400' : 'text-gray-300'}>{mask(fmt.currency(latest.contas), hidden)}</span>
              </span>
              <span className="text-gray-500">
                Investimentos <span className="text-emerald-400">{mask(fmt.currency(latest.investimentos), hidden)}</span>
              </span>
              {Number(latest.manuais) ? (
                <span className="text-gray-500">
                  Bens e Obrigações <span className="text-amber-400">{mask(fmt.currency(latest.manuais), hidden)}</span>
                </span>
              ) : null}
              <span className="text-gray-500">
                Cartão <span className="text-rose-400">−{mask(fmt.currency(latest.dividas), hidden)}</span>
              </span>
            </div>
          </div>

          {/* Curva de evolução */}
          <div className="card">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <h3 className="text-sm font-medium text-gray-300">Evolução</h3>
              <div className="flex flex-wrap gap-2">
                <div className="flex gap-1 bg-gray-800/60 rounded-lg p-0.5">
                  {GRANS.map((g) => (
                    <button
                      key={g.key}
                      onClick={() => setGran(g.key)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        gran === g.key ? 'bg-indigo-600/30 text-indigo-300' : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1 bg-gray-800/60 rounded-lg p-0.5">
                  {RANGES.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => setRange(r.key)}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        range === r.key ? 'bg-indigo-600/30 text-indigo-300' : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {chartData.length < 2 ? (
              <p className="text-sm text-gray-500 py-8 text-center">
                {history.length < 2
                  ? 'A curva aparece quando houver pelo menos duas fotos em dias diferentes. Volte e clique em Atualizar novamente em outro dia.'
                  : 'Sem dados suficientes nesse período. Tente um intervalo maior.'}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={chartData} margin={{ left: 4, right: 8, top: 4 }}>
                  <defs>
                    <linearGradient id="pat" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                  <XAxis
                    dataKey="ts"
                    type="number"
                    scale="time"
                    domain={['dataMin', 'dataMax']}
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    tickFormatter={(ts) => {
                      const d = new Date(ts).toISOString().slice(0, 10);
                      return gran === 'month' ? fmt.date(d).slice(3) : fmt.date(d).slice(0, 5);
                    }}
                    axisLine={{ stroke: '#374151' }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[(min) => min - (min * 0.02 || 100), (max) => max + (max * 0.02 || 100)]}
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <Tooltip content={<ChartTooltip hidden={hidden} />} cursor={{ stroke: '#374151' }} />
                  <Area type="monotone" dataKey="patrimonio" stroke="#818cf8" strokeWidth={2} fill="url(#pat)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Investimentos — destaque principal */}
          <div className="card">
            <div className="flex items-baseline justify-between mb-4">
              <h3 className="text-sm font-medium text-gray-300">Investimentos</h3>
              <span className="text-lg font-semibold text-emerald-400">{mask(fmt.currency(latest.investimentos), hidden)}</span>
            </div>

            {/* Alocação por classe */}
            <div className="space-y-3">
              {alloc.rows.map((r) => (
                <div key={r.label}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="flex items-center gap-2 text-gray-300">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: classColor(r.label) }} />
                      {r.label}
                      <span className="text-gray-500">{fmt.percent(r.pct)}</span>
                    </span>
                    <span className="text-gray-200">{mask(fmt.currency(r.value), hidden)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(r.pct * 100, 1)}%`, background: classColor(r.label) }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Ativos agrupados por tipo */}
            {groups.length > 0 && (
              <div className="mt-6 pt-4 border-t border-gray-800 space-y-5">
                {groups.map((g) => (
                  <div key={g.label}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                        <span className="w-2 h-2 rounded-full" style={{ background: classColor(g.label) }} />
                        {g.label}
                      </span>
                      <span className="text-xs text-gray-500">{mask(fmt.currency(g.total), hidden)}</span>
                    </div>
                    <ul>
                      {g.items.map((h) => {
                        const byDueDate = h.items.length > 1 || h.items[0]?.dueDate ? groupByDueDate(h.items) : null;
                        const expandable = !!byDueDate;
                        const key = `${g.label}::${h.name}`;
                        const isOpen = expandedIssuers.has(key);
                        return (
                          <li key={h.name}>
                            <button
                              type="button"
                              onClick={() => expandable && toggleIssuer(key)}
                              className={`w-full flex items-center justify-between gap-3 py-2 text-sm text-left ${expandable ? 'cursor-pointer hover:text-gray-100' : 'cursor-default'}`}
                            >
                              <span className="text-gray-300 truncate min-w-0">{h.name}</span>
                              <span className="text-gray-200 whitespace-nowrap">{mask(fmt.currency(h.balance), hidden)}</span>
                            </button>
                            {expandable && isOpen && (
                              <ul className="pl-3 pb-2 space-y-1">
                                {byDueDate.map((d) => {
                                  const rate = (g.label.startsWith('Tesouro Direto') || g.label === 'CDB - Pós Fixado') ? rateLabel(d.rate, d.rateType) : null;
                                  return (
                                    <li key={d.dueDate || 'sem-vencimento'} className="flex items-center justify-between gap-3 text-xs text-gray-500">
                                      <span className="truncate">
                                        {formatDueDate(d.dueDate) || 'Sem vencimento'}
                                        {rate && <span className="text-gray-600"> · {rate}</span>}
                                        {d.count > 1 && <span className="text-gray-600"> · {d.count} títulos</span>}
                                      </span>
                                      <span className="text-gray-400 whitespace-nowrap">{mask(fmt.currency(d.balance), hidden)}</span>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {/* Distribuição por indexador */}
            {byIndexer.length > 0 && (
              <div className="mt-6 pt-4 border-t border-gray-800">
                <h4 className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">Por indexador</h4>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={byIndexer}
                      nameKey="label"
                      dataKey="value"
                      cx="50%"
                      cy="50%"
                      innerRadius={56}
                      outerRadius={92}
                      strokeWidth={0}
                      paddingAngle={2}
                    >
                      {byIndexer.map((e) => <Cell key={e.label} fill={indexerColor(e.label)} />)}
                    </Pie>
                    <Tooltip content={<IndexerTooltip hidden={hidden} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2">
                  {byIndexer.map((e) => {
                    const pct = indexerTotal > 0 ? ((e.value / indexerTotal) * 100).toFixed(0) : 0;
                    return (
                      <div key={e.label} className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: indexerColor(e.label) }} />
                        <span className="text-xs text-gray-300 truncate flex-1">{e.label}</span>
                        <span className="text-xs text-gray-500 flex-shrink-0 ml-1">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Bens manuais */}
          <ManualAssets hidden={hidden} onChanged={reload} />
        </>
      )}
    </div>
  );
}

const MANUAL_CATS = ['Conta no exterior', 'Imóvel', 'Veículo', 'Previdência', 'Ações Globais', 'Outro'];
const emptyForm = { nome: '', categoria: 'Conta no exterior', valor: '', incluir_investimentos: false };

function ManualAssets({ hidden, onChanged }) {
  const { data, loading, reload } = useApi(() => api.getManualAssets(), []);
  const items = data?.items || [];
  // Itens marcados "incluir nos investimentos" contam no card de Investimentos, não
  // aqui (evita duplicar o valor no total exibido nos dois cards).
  const total = items.filter((it) => !it.incluir_investimentos).reduce((s, it) => s + Number(it.valor), 0);

  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await Promise.all([reload(), onChanged?.()]);
    } catch (e) {
      setError(e.message || 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    const payload = {
      nome: form.nome.trim(),
      categoria: form.categoria,
      valor: Number(form.valor),
      incluir_investimentos: form.incluir_investimentos,
    };
    if (!payload.nome || !Number.isFinite(payload.valor)) { setError('Preencha nome e valor.'); return; }
    run(async () => {
      if (editingId) await api.updateManualAsset(editingId, payload);
      else await api.createManualAsset(payload);
      setForm(emptyForm);
      setEditingId(null);
    });
  }

  function startEdit(it) {
    setEditingId(it.id);
    setForm({ nome: it.nome, categoria: it.categoria, valor: String(it.valor), incluir_investimentos: !!it.incluir_investimentos });
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  }

  return (
    <div className="card">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-medium text-gray-300">Bens e Obrigações</h3>
        {items.length > 0 && (
          <span className="text-sm font-semibold text-amber-400">{mask(fmt.currency(total), hidden)}</span>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Bens sem integração (conta no exterior, imóvel, veículo). Informe o valor em reais e atualize
        quando quiser: entram na soma do patrimônio. Para dívidas (ex. financiamento), use valor negativo.
      </p>

      {error && <p className="text-sm text-red-300 mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Carregando...</p>
      ) : (
        <ul className="divide-y divide-gray-800/70 mb-4">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="text-gray-200 truncate">{it.nome}</p>
                <p className="text-xs text-gray-500">
                  {it.categoria}
                  {it.incluir_investimentos && <span className="text-indigo-400"> · nos investimentos</span>}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={Number(it.valor) < 0 ? 'text-rose-400' : 'text-gray-200'}>
                  {mask(fmt.currency(it.valor), hidden)}
                </span>
                <button onClick={() => startEdit(it)} disabled={busy} className="text-gray-500 hover:text-indigo-400" title="Editar">
                  <Pencil size={14} />
                </button>
                <button onClick={() => run(() => api.deleteManualAsset(it.id))} disabled={busy} className="text-gray-500 hover:text-rose-400" title="Remover">
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
          {items.length === 0 && <li className="py-2 text-xs text-gray-600">Nenhum bem manual ainda.</li>}
        </ul>
      )}

      {/* Formulário de adicionar/editar */}
      <div className="flex flex-col gap-2 pt-3 border-t border-gray-800">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="input flex-1 min-w-0"
            placeholder="Nome (ex.: Conta Wise USD)"
            value={form.nome}
            onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
          />
          <select
            className="input sm:w-44"
            value={form.categoria}
            onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
          >
            {MANUAL_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            className="input sm:w-36"
            type="number"
            inputMode="decimal"
            placeholder="Valor (R$)"
            value={form.valor}
            onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
          <button onClick={submit} disabled={busy} className="btn-primary flex items-center justify-center gap-1.5 shrink-0">
            {busy ? <Loader2 size={15} className="animate-spin" /> : editingId ? <Check size={15} /> : <Plus size={15} />}
            {editingId ? 'Salvar' : 'Adicionar'}
          </button>
          {editingId && (
            <button onClick={cancelEdit} disabled={busy} className="btn-ghost flex items-center justify-center px-3 shrink-0" title="Cancelar">
              <X size={15} />
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={form.incluir_investimentos}
            onChange={(e) => setForm((f) => ({ ...f, incluir_investimentos: e.target.checked }))}
            className="w-3.5 h-3.5 rounded accent-indigo-500"
          />
          Incluir nos investimentos (aparece no card de Investimentos em vez de Bens e Obrigações)
        </label>
      </div>
    </div>
  );
}
