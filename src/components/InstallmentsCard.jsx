import { useState } from 'react';
import { CreditCard, Search } from 'lucide-react';
import { useApi } from '../hooks/useApi.js';
import { api } from '../api.js';
import { fmt } from '../utils/format.js';
import { mask } from '../hooks/useHideValues.js';

// Active installment plans derived server-side from the NN/NN suffix in card
// descriptions. Shows what's still owed per plan and the committed amount per future
// month (as % of the planned monthly income when available).
export default function InstallmentsCard({ hidden, salarioEquivalente }) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const { data } = useApi(() => api.getInstallments(todayStr), []);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');

  if (!data?.plans?.length) return null;

  const monthLabel = (ym) => {
    const [y, m] = ym.split('-');
    const name = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'short' });
    return `${name.replace('.', '')}/${y.slice(2)}`;
  };
  const filteredPlans = search.trim()
    ? data.plans.filter((p) => p.description.toLowerCase().includes(search.trim().toLowerCase()))
    : data.plans;
  const visiblePlans = showAll ? filteredPlans : filteredPlans.slice(0, 6);

  // Total and per-month breakdown reflect the active search filter — recomputed
  // from filteredPlans' own by_month rather than the server's unfiltered aggregates.
  const filteredTotal = filteredPlans.reduce((s, p) => s + p.remaining_amount, 0);
  const filteredByMonth = {};
  filteredPlans.forEach((p) => {
    Object.entries(p.by_month || {}).forEach(([mk, val]) => {
      filteredByMonth[mk] = (filteredByMonth[mk] || 0) + val;
    });
  });
  const months = Object.entries(filteredByMonth).sort(([a], [b]) => a.localeCompare(b)).slice(0, 6);

  return (
    <div className="card">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2">
          <CreditCard size={16} className="text-indigo-400" />
          <h3 className="text-sm font-medium text-gray-300">Parcelamentos Ativos</h3>
          <span className="text-xs text-gray-600">
            {filteredPlans.length === data.plans.length
              ? `${data.plans.length} planos`
              : `${filteredPlans.length} de ${data.plans.length} planos`}
          </span>
        </div>
        <p className="text-sm text-gray-400">
          <span className="text-gray-200 font-semibold">{mask(fmt.currency(filteredTotal), hidden)}</span> a pagar
        </p>
      </div>

      {/* Committed per future month */}
      <div className="flex flex-wrap gap-2 mb-4">
        {months.map(([ym, val]) => (
          <div key={ym} className="bg-gray-800/50 rounded-lg px-2.5 py-1.5 text-xs">
            <span className="text-gray-500 capitalize">{monthLabel(ym)}</span>{' '}
            <span className="text-gray-200 font-medium">{mask(fmt.currency(val), hidden)}</span>
            {salarioEquivalente > 0 && !hidden && (
              <span className="text-gray-600"> · {((val / salarioEquivalente) * 100).toFixed(0)}%</span>
            )}
          </div>
        ))}
      </div>

      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          className="input pl-8 w-full text-sm"
          placeholder="Buscar parcelamento..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filteredPlans.length === 0 && (
        <p className="text-xs text-gray-500 py-2">Nenhum parcelamento encontrado.</p>
      )}

      <div className="divide-y divide-gray-800/50">
        {visiblePlans.map((p) => {
          const pct = (p.paid_installments / p.total_installments) * 100;
          return (
            <div key={`${p.description}|${p.total_installments}|${p.installment_amount}|${p.ends}`} className="py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-y-1 mb-1.5">
                <span className="text-sm text-gray-200 flex items-center gap-1.5 min-w-0">
                  {p.category_icon && <span>{p.category_icon}</span>}
                  <span className="truncate">{p.description}</span>
                </span>
                <div className="text-xs text-gray-400">
                  <span className="text-gray-200 font-medium">{mask(fmt.currency(p.remaining_amount), hidden)}</span>
                  <span className="text-gray-600"> restantes · termina {monthLabel(p.ends)}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500/70" style={{ width: `${pct}%` }} />
                  {/* Linha clara com halo escuro (em vez de cor fixa): fica visível tanto
                      sobre fundos escuros quanto claros — nenhuma cor sólida cobriria os
                      3 temas, já que a barra vai de quase-preto (Neutral) a quase-branco
                      (Claro) dependendo do trecho pago. */}
                  {Array.from({ length: p.total_installments }).map((_, i) => {
                    const isLast = i === p.total_installments - 1;
                    return (
                      <div
                        key={i}
                        className="absolute top-0 bottom-0 w-px bg-white/90"
                        style={{
                          ...(isLast ? { right: 0 } : { left: `${((i + 1) / p.total_installments) * 100}%` }),
                          boxShadow: '0 0 0 0.5px rgba(0,0,0,0.45)',
                        }}
                      />
                    );
                  })}
                </div>
                <span className="text-xs text-gray-500 flex-shrink-0">
                  {p.paid_installments}/{p.total_installments} pagas · {mask(fmt.currency(p.installment_amount), hidden)}/mês
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {filteredPlans.length > 6 && (
        <button onClick={() => setShowAll((v) => !v)} className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors mt-2">
          {showAll ? 'Mostrar menos' : `Mostrar todos (${filteredPlans.length})`}
        </button>
      )}
    </div>
  );
}
