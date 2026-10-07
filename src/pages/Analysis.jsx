import { useState, useMemo, useEffect } from 'react';
import { Sparkles, Loader2, RefreshCw, Lock, ChevronDown, ChevronUp } from 'lucide-react';
import { useApi } from '../hooks/useApi.js';
import { api } from '../api.js';
import { fmt } from '../utils/format.js';
import { usePeriod } from '../hooks/usePeriod.js';
import EditTransactionModal from '../components/EditTransactionModal.jsx';
import { useHideValues, mask } from '../hooks/useHideValues.js';

export default function Analysis() {
  const { year, month } = usePeriod();
  const { hidden } = useHideValues();

  const { data: summary, reload: reloadSummary } = useApi(() => api.getSummary({ year, month }), [year, month]);
  const { data: categories, reload: reloadCats } = useApi(() => api.getCategories(), []);
  const { data: budgets } = useApi(() => api.getBudgets(year, month), [year, month]);

  const salario = useMemo(() => {
    if (!budgets || !categories) return 0;
    const incomeIds = new Set(categories.filter((c) => c.type === 'income').map((c) => c.id));
    return budgets.filter((b) => incomeIds.has(b.category_id)).reduce((s, b) => s + Number(b.limit_amount), 0);
  }, [budgets, categories]);

  const rows = useMemo(() => {
    if (!summary?.byCategory || !categories) return null;
    const recMap = Object.fromEntries(categories.map((c) => [c.id, c.is_recurring]));
    return summary.byCategory
      .filter((r) => r.type === 'expense')
      .map((r) => ({
        ...r,
        is_recurring: !!recMap[r.id],
        budget: Number(r.budget_limit) || 0,
        total: Number(r.total),
      }));
  }, [summary, categories]);

  const fixas = useMemo(() => (rows || []).filter((r) => r.is_recurring).sort((a, b) => b.budget - a.budget), [rows]);
  const variaveis = useMemo(() => (rows || []).filter((r) => !r.is_recurring).sort((a, b) => b.total - a.total), [rows]);

  async function reclassify(id, fixa) {
    await api.setCategoryRecurring(id, fixa);
    reloadCats();
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">Análise</h1>
          <p className="text-sm text-gray-500 capitalize">{fmt.monthYear(year, month)}</p>
        </div>
      </div>

      {/* Fixed vs variable breakdown */}
      <div className="card">
        <div className="flex items-center gap-2 mb-1">
          <Lock size={16} className="text-indigo-400" />
          <h3 className="text-sm font-medium text-gray-300">Despesas Fixas vs. Variáveis</h3>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Fixa = categoria recorrente, comprometida até o valor orçado; o excedente é tratado como variável.
          Reclassifique pelo seletor: vale para todos os meses. Clique na categoria para ver as despesas do mês.
        </p>

        {rows === null ? (
          <p className="text-sm text-gray-500">Carregando...</p>
        ) : (
          <div className="space-y-6">
            <ClassTable
              title="Fixas"
              rows={fixas}
              salario={salario}
              hidden={hidden}
              onReclassify={reclassify}
              accent="text-indigo-400"
              year={year}
              month={month}
              onDataChanged={reloadSummary}
            />
            <ClassTable
              title="Variáveis"
              rows={variaveis}
              salario={salario}
              hidden={hidden}
              onReclassify={reclassify}
              accent="text-amber-400"
              year={year}
              month={month}
              onDataChanged={reloadSummary}
            />
          </div>
        )}
      </div>

      <ReportCard year={year} month={month} />
    </div>
  );
}

function ClassTable({ title, rows, salario, hidden, onReclassify, accent, year, month, onDataChanged }) {
  const totalOrcado = rows.reduce((s, r) => s + r.budget, 0);
  const totalGasto = rows.reduce((s, r) => s + r.total, 0);
  const pctSalario = salario > 0 ? (totalOrcado / salario) * 100 : null;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <h4 className={`text-xs font-semibold uppercase tracking-widest ${accent}`}>{title}</h4>
        <p className="text-xs text-gray-500">
          orçado <span className="text-gray-300 font-medium">{mask(fmt.currency(totalOrcado), hidden)}</span>
          {' · '}gasto <span className="text-gray-300 font-medium">{mask(fmt.currency(totalGasto), hidden)}</span>
          {pctSalario !== null && (
            <span> · <span className={accent}>{mask(`${pctSalario.toFixed(0)}%`, hidden)}</span> da renda mensal planejada</span>
          )}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-600 py-2">Nenhuma categoria.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-800">
                <th className="text-left font-normal py-1.5 pr-2">Categoria</th>
                <th className="text-left font-normal py-1.5 px-2">Classe</th>
                <th className="text-right font-normal py-1.5 px-2">Orçado</th>
                <th className="text-right font-normal py-1.5 px-2">Gasto</th>
                <th className="text-right font-normal py-1.5 pl-2">% salário</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {rows.map((r) => (
                <CategoryRow
                  key={r.id ?? r.name}
                  r={r}
                  salario={salario}
                  hidden={hidden}
                  onReclassify={onReclassify}
                  year={year}
                  month={month}
                  onDataChanged={onDataChanged}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// One expandable table row: clicking it drops down the month's transactions of that
// category, largest first — the "what do I attack to lower this" view. Clicking a
// transaction opens the edit modal.
function CategoryRow({ r, salario, hidden, onReclassify, year, month, onDataChanged }) {
  const [expanded, setExpanded] = useState(false);
  const [txns, setTxns] = useState(null);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [editTx, setEditTx] = useState(null);

  useEffect(() => { setTxns(null); setExpanded(false); }, [year, month, r.id]);

  const over = r.budget > 0 && r.total > r.budget;
  const pct = salario > 0 && r.budget > 0 ? (r.budget / salario) * 100 : null;
  const expandable = r.id != null;

  async function loadTxns() {
    setLoadingTxns(true);
    try {
      const rows = await api.getTransactions({ year, month, category_id: r.id, limit: 500 });
      const list = Array.isArray(rows) ? rows : (rows.transactions ?? []);
      setTxns([...list].sort((a, b) => Number(b.amount) - Number(a.amount)));
    } finally {
      setLoadingTxns(false);
    }
  }

  async function toggle() {
    if (!expandable) return;
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (txns === null) loadTxns();
  }

  return (
    <>
      <tr
        onClick={toggle}
        className={expandable ? 'cursor-pointer hover:bg-gray-800/40 transition-colors group' : ''}
      >
        <td className="py-2 pr-2">
          <span className="flex items-center gap-1.5 text-gray-200">
            <span>{r.icon}</span>
            <span className="truncate">{r.name || 'Sem categoria'}</span>
            {expandable && (
              <span className="text-gray-700 group-hover:text-gray-400 transition-colors">
                {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </span>
            )}
          </span>
        </td>
        <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
          {r.id != null ? (
            <select
              value={r.is_recurring ? 'fixa' : 'variavel'}
              onChange={(e) => onReclassify(r.id, e.target.value === 'fixa')}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="fixa">Fixa</option>
              <option value="variavel">Variável</option>
            </select>
          ) : (
            <span className="text-xs text-gray-600">-</span>
          )}
        </td>
        <td className="py-2 px-2 text-right text-gray-400">
          {r.budget > 0 ? mask(fmt.currency(r.budget), hidden) : <span className="text-gray-700">-</span>}
        </td>
        <td className={`py-2 px-2 text-right ${over ? 'text-red-400 font-medium' : 'text-gray-300'}`}>
          {mask(fmt.currency(r.total), hidden)}
        </td>
        <td className="py-2 pl-2 text-right text-gray-500">
          {pct !== null ? mask(`${pct.toFixed(0)}%`, hidden) : <span className="text-gray-700">-</span>}
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={5} className="p-0">
            <div className="mx-1 mb-2 mt-0.5 rounded-lg bg-gray-800/40 border border-gray-700/40 overflow-hidden">
              {loadingTxns ? (
                <p className="text-xs text-gray-500 p-3">Carregando...</p>
              ) : txns?.length === 0 ? (
                <p className="text-xs text-gray-500 p-3">Sem transações neste mês.</p>
              ) : (
                <div className="divide-y divide-gray-700/30 max-h-64 overflow-y-auto">
                  {txns?.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setEditTx(t)}
                      className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-indigo-500/10 transition-colors text-left group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-gray-500 flex-shrink-0 tabular-nums">{fmt.date(t.date)}</span>
                        <span className="text-gray-300 truncate group-hover:text-white transition-colors">{t.description || '-'}</span>
                      </div>
                      <span className={`flex-shrink-0 ml-2 font-medium ${t.type === 'income' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {mask(fmt.currency(t.amount), hidden)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {editTx && (
                <EditTransactionModal
                  transaction={editTx}
                  onClose={() => setEditTx(null)}
                  onSaved={() => { loadTxns(); onDataChanged?.(); }}
                />
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// The report is persisted server-side (monthly_reports table, one per year/month,
// upserted on regenerate) so it's available from any device, not just the browser
// that generated it.
function ReportCard({ year, month }) {
  const { hidden } = useHideValues();
  const [report, setReport] = useState(null);
  const [createdAt, setCreatedAt] = useState(null);
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getSavedMonthlyReport(year, month)
      .then(({ report, created_at, model }) => {
        if (cancelled) return;
        setReport(report);
        setCreatedAt(created_at || null);
        setModel(model || null);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, month]);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const { report: text, created_at, model } = await api.generateMonthlyReport(year, month);
      setReport(text);
      setCreatedAt(created_at || null);
      setModel(model || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-indigo-400" />
          <h3 className="text-sm font-medium text-gray-300">Relatório do Mês (IA)</h3>
        </div>
        <button
          onClick={generate}
          disabled={generating || loading}
          className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50"
        >
          {generating ? <Loader2 size={14} className="animate-spin" /> : report ? <RefreshCw size={14} /> : <Sparkles size={14} />}
          {generating ? 'Analisando...' : report ? 'Gerar novamente' : 'Gerar relatório'}
        </button>
      </div>

      {loading && <p className="text-sm text-gray-500">Carregando...</p>}
      {error && <p className="text-sm text-red-400 mb-2">{error}</p>}

      {!loading && !report && !generating && !error && (
        <p className="text-sm text-gray-500">
          Gera uma análise narrativa do fechamento do mês: desvios de orçamento, comparação com o mês anterior,
          resgates vs. planejado e recomendações. Fica salvo no servidor, disponível em qualquer dispositivo.
        </p>
      )}

      {report && (
        <>
          <div className={hidden ? 'blur-sm select-none pointer-events-none' : ''}>
            <Markdown text={report} />
          </div>
          {createdAt && (
            <p className="text-xs text-gray-600 mt-3 pt-3 border-t border-gray-800">
              Gerado em {createdAt.slice(0, 10)} às {createdAt.slice(11, 16)}
              {model && <> · {model}</>}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// Minimal markdown renderer for the report: ## headings, - bullets, **bold**.
function Bold({ text }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={i} className="text-gray-100 font-semibold">{p}</strong> : p));
}

function Markdown({ text }) {
  const blocks = [];
  let list = null;
  text.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!list) { list = []; blocks.push({ type: 'ul', items: list, key: i }); }
      list.push(trimmed.slice(2));
      return;
    }
    list = null;
    if (trimmed.startsWith('#')) {
      blocks.push({ type: 'h', text: trimmed.replace(/^#+\s*/, ''), key: i });
    } else if (trimmed) {
      blocks.push({ type: 'p', text: trimmed, key: i });
    }
  });

  return (
    <div className="space-y-2.5 text-sm leading-relaxed">
      {blocks.map((b) => {
        if (b.type === 'h') return <h4 key={b.key} className="text-gray-200 font-semibold pt-2">{b.text}</h4>;
        if (b.type === 'ul') return (
          <ul key={b.key} className="space-y-1 pl-1">
            {b.items.map((item, j) => (
              <li key={j} className="text-gray-400 flex gap-2">
                <span className="text-indigo-400 flex-shrink-0">•</span>
                <span><Bold text={item} /></span>
              </li>
            ))}
          </ul>
        );
        return <p key={b.key} className="text-gray-400"><Bold text={b.text} /></p>;
      })}
    </div>
  );
}
