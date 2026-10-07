import { useState, useMemo } from 'react';
import { PieChart, Pie, Cell, Label, Tooltip, ResponsiveContainer } from 'recharts';
import { Search, Pencil, Trash2, EyeOff } from 'lucide-react';
import { useApi } from '../hooks/useApi.js';
import { api } from '../api.js';
import { fmt } from '../utils/format.js';
import { isCard } from '../utils/source.js';
import { usePeriod } from '../hooks/usePeriod.js';
import InstallmentsCard from '../components/InstallmentsCard.jsx';
import EditTransactionModal from '../components/EditTransactionModal.jsx';
import { useHideValues, mask } from '../hooks/useHideValues.js';

const PieTooltip = ({ active, payload, hidden }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm shadow-xl">
      <p className="text-gray-200 font-medium">{d.name}</p>
      <p className="text-gray-400">{mask(fmt.currency(d.value), hidden)}</p>
    </div>
  );
};

export default function CartaoCredito() {
  const { hidden } = useHideValues();
  const { year, month } = usePeriod();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editTx, setEditTx] = useState(null);

  const { data: transactions, loading, reload } = useApi(
    () => api.getTransactions({ year, month, include_ignored: 1, limit: 2000 }), [year, month]
  );
  const { data: categories } = useApi(() => api.getCategories(), []);

  const catById = useMemo(
    () => Object.fromEntries((categories || []).map((c) => [String(c.id), c])),
    [categories]
  );

  const cardTxns = useMemo(
    () => (transactions || []).filter(isCard),
    [transactions]
  );

  const cardExpenses = useMemo(
    () => cardTxns.filter((t) => t.type === 'expense' && !t.ignored),
    [cardTxns]
  );

  const totalFatura = useMemo(
    () => cardExpenses.reduce((s, t) => s + Number(t.amount), 0),
    [cardExpenses]
  );

  const pieData = useMemo(() => {
    const byCategory = new Map();
    cardExpenses.forEach((t) => {
      const cat = catById[String(t.category_id)];
      const key = cat?.id ?? 'none';
      const entry = byCategory.get(key) || {
        name: `${cat?.icon || '📦'} ${cat?.name || 'Sem categoria'}`,
        value: 0,
        color: cat?.color || '#6b7280',
      };
      entry.value += Number(t.amount);
      byCategory.set(key, entry);
    });
    return [...byCategory.values()].sort((a, b) => b.value - a.value);
  }, [cardExpenses, catById]);

  const filtered = useMemo(() => {
    return cardTxns.filter((t) => {
      const matchDesc = !search || t.description.toLowerCase().includes(search.toLowerCase());
      const matchCat = !categoryFilter || String(t.category_id) === categoryFilter;
      return matchDesc && matchCat;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [cardTxns, search, categoryFilter]);

  const activeFilters = [search, categoryFilter].filter(Boolean).length;

  const filteredSum = useMemo(
    () => filtered.filter((t) => !t.ignored).reduce((s, t) => s + (t.type === 'income' ? -t.amount : t.amount), 0),
    [filtered]
  );

  async function toggleIgnored(t) {
    try {
      await api.toggleIgnored(t.id, !t.ignored);
      reload();
    } catch (e) {
      alert(e.message || 'Erro ao atualizar transação.');
    }
  }

  async function remove(t) {
    if (!confirm(`Remover "${t.description}"?`)) return;
    await api.deleteTransaction(t.id);
    reload();
  }

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">Cartão de Crédito</h1>
          <p className="text-sm text-gray-500 capitalize">{fmt.monthYear(year, month)}</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card px-5 py-3">
          <p className="text-xs text-gray-500 mb-0.5">Total da Fatura</p>
          <p className="text-red-400 font-semibold text-lg tabular-nums">{mask(fmt.currency(totalFatura), hidden)}</p>
        </div>
        <div className="card px-5 py-3">
          <p className="text-xs text-gray-500 mb-0.5">Transações no cartão</p>
          <p className="text-gray-200 font-semibold text-lg tabular-nums">{cardTxns.length}</p>
        </div>
      </div>

      {/* Pie chart by category */}
      <div className="card">
        <h3 className="text-sm font-medium text-gray-300 mb-3">Despesas por Categoria</h3>
        {pieData.length === 0 ? (
          <div className="h-60 flex items-center justify-center text-gray-600 text-sm">
            Sem despesas no cartão este mês
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={72}
                  outerRadius={118}
                  dataKey="value"
                  strokeWidth={0}
                  paddingAngle={2}
                >
                  {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  <Label
                    content={({ viewBox }) => {
                      const { cx, cy } = viewBox;
                      const formatted = fmt.currency(totalFatura).split(',')[0];
                      return (
                        <g>
                          <text x={cx} y={cy + 6} textAnchor="middle" fill="#f9fafb" fontSize={15} fontWeight={700}>{hidden ? '••••' : formatted}</text>
                        </g>
                      );
                    }}
                  />
                </Pie>
                <Tooltip content={<PieTooltip hidden={hidden} />} />
              </PieChart>
            </ResponsiveContainer>

            <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2 border-t border-gray-800 pt-3">
              {pieData.map((e) => {
                const pct = totalFatura > 0 ? ((e.value / totalFatura) * 100).toFixed(0) : 0;
                return (
                  <div key={e.name} className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: e.color }} />
                    <span className="text-xs text-gray-300 truncate flex-1">{e.name}</span>
                    <span className="text-xs text-gray-500 flex-shrink-0 ml-1">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Active installment plans */}
      <InstallmentsCard hidden={hidden} />

      {/* Filters */}
      <div className="card p-4 space-y-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="input pl-8 w-full"
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <select className="input text-xs py-1.5 flex-1 min-w-[160px]"
            value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">Todas as categorias</option>
            {(categories || []).map((c) => (
              <option key={c.id} value={String(c.id)}>{c.icon} {c.name}</option>
            ))}
          </select>
          {activeFilters > 0 && (
            <button
              onClick={() => { setSearch(''); setCategoryFilter(''); }}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors whitespace-nowrap"
            >
              Limpar
            </button>
          )}
        </div>

        {activeFilters > 0 && (
          <div className="flex items-center justify-between border-t border-gray-800 pt-3 text-sm">
            <span className="text-gray-500">
              {filtered.length} transaç{filtered.length === 1 ? 'ão' : 'ões'}
            </span>
            <span className="text-gray-400">
              Total: <span className={`font-semibold ${filteredSum >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>{mask(fmt.currency(Math.abs(filteredSum)), hidden)}</span>
            </span>
          </div>
        )}
      </div>

      {/* Transaction list */}
      <div className="card p-0 overflow-hidden">
        {loading && !transactions ? (
          <p className="p-6 text-sm text-gray-500">Carregando...</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">
            {activeFilters > 0 ? 'Nenhuma transação para os filtros selecionados.' : 'Nenhuma transação no cartão este mês.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left">
                  <th className="px-4 py-3 text-xs text-gray-500 font-medium">Data</th>
                  <th className="px-4 py-3 text-xs text-gray-500 font-medium">Descrição</th>
                  <th className="px-4 py-3 text-xs text-gray-500 font-medium">Categoria</th>
                  <th className="px-4 py-3 text-xs text-gray-500 font-medium text-right">Valor</th>
                  <th className="px-4 py-3 text-xs text-gray-500 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {filtered.map((t) => (
                  <tr key={t.id} className={`hover:bg-gray-800/30 transition-colors ${t.ignored ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{fmt.date(t.date)}</td>
                    <td className="px-4 py-3">
                      <p className="text-gray-200">{t.description}</p>
                      {t.notes && <p className="text-xs text-gray-600 truncate max-w-[200px]">{t.notes}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {t.category_name ? (
                        <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full"
                          style={{ backgroundColor: `${t.category_color}20`, color: t.category_color }}>
                          {t.category_icon} {t.category_name}
                        </span>
                      ) : <span className="text-gray-600 text-xs">-</span>}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${t.ignored ? 'line-through text-gray-600' : t.type === 'income' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {t.type === 'income' ? '+' : '-'}{mask(fmt.currency(t.amount), hidden)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => toggleIgnored(t)}
                          title={t.ignored ? 'Incluir no saldo' : 'Ignorar no saldo'}
                          className={`p-1.5 rounded-lg transition-colors ${t.ignored ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10' : 'text-gray-600 hover:text-amber-400 hover:bg-gray-700'}`}
                        >
                          <EyeOff size={14} />
                        </button>
                        <button onClick={() => setEditTx(t)} className="btn-ghost p-1.5"><Pencil size={14} /></button>
                        <button onClick={() => remove(t)} className="btn-ghost p-1.5 text-red-500 hover:text-red-400"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editTx && (
        <EditTransactionModal
          transaction={editTx}
          onClose={() => setEditTx(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
