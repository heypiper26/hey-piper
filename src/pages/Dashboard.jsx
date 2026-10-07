import { useState, useMemo, useEffect } from 'react';
import {
  LineChart, Line, ComposedChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid, Label, Legend,
} from 'recharts';
import { TrendingUp, TrendingDown, Wallet, Target, ChevronDown, ChevronUp, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Gauge, Lock } from 'lucide-react';
import { useApi } from '../hooks/useApi.js';
import { api } from '../api.js';
import { fmt } from '../utils/format.js';
import { usePeriod } from '../hooks/usePeriod.js';
import EditTransactionModal from '../components/EditTransactionModal.jsx';
import InstallmentsCard from '../components/InstallmentsCard.jsx';
import { useHideValues, mask } from '../hooks/useHideValues.js';

const TooltipBR = ({ active, payload, label, hidden }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (row && 'orcamento' in row) {
    const saldo = row.receita - row.despesas - (row.transfers || 0);
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-3 text-sm shadow-xl">
        <p className="text-gray-400 mb-1">{label}</p>
        <p style={{ color: '#34d399' }}>Receita: {mask(fmt.currency(row.receita), hidden)}</p>
        <p style={{ color: '#3987e5' }}>Despesas: {mask(fmt.currency(row.despesas), hidden)}</p>
        <p style={{ color: '#f59e0b' }}>Orçamento: {mask(fmt.currency(row.orcamento), hidden)}</p>
        {row.transfers > 0 && (
          <p style={{ color: '#38bdf8' }}>Transferências: {mask(fmt.currency(row.transfers), hidden)}</p>
        )}
        <p className={`pt-1 mt-1 border-t border-gray-700 ${saldo >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          Saldo: {mask(fmt.currency(saldo), hidden)}
        </p>
        <p style={{ color: '#22d3ee' }}>Saldo Projetado: {mask(fmt.currency(row.saldoProjetado), hidden)}</p>
      </div>
    );
  }
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-3 text-sm shadow-xl">
      <p className="text-gray-400 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: {mask(fmt.currency(p.value), hidden)}</p>
      ))}
    </div>
  );
};

const FORECAST_WINDOW = 8;
const FORECAST_BAR = 24;

// Projected month-end total for one bucket (income or expense).
//   - recurring category → assume it reaches its expected amount (budget) if it hasn't yet:
//     max(realizado, orçamento). Already-realized recurring spend is inside `realizado`, so
//     there's no double counting.
//   - non-recurring category → count only what actually happened.
//   - category with actuals but no budget row → count the actuals as-is.
// Expense actuals are taken GROSS (reimbursements added back) so the projected balance stays
// consistent with the real Saldo (receita − despesa), which already counts reimbursements as
// income; otherwise a refund would improve the projection twice.
function projectBucket(categoryBudgets, categoryActuals, recurringIds) {
  if (!categoryBudgets) return null;
  const grossById = new Map(
    categoryActuals.map((r) => [r.id, Number(r.total) + Number(r.reimbursed || 0)])
  );
  let projected = 0;
  const budgetedIds = new Set();
  categoryBudgets.forEach((b) => {
    budgetedIds.add(b.category_id);
    const actual = grossById.get(b.category_id) ?? 0;
    projected += recurringIds.has(b.category_id) ? Math.max(actual, Number(b.limit_amount)) : actual;
  });
  categoryActuals.forEach((r) => {
    if (!budgetedIds.has(r.id)) projected += grossById.get(r.id);
  });
  return projected;
}

const TargetMark = ({ x, y, width }) => (
  <rect x={x - 5} y={y - 1.5} width={width + 10} height={3} rx={1.5} fill="#f59e0b" />
);

const ForecastSkeleton = () => (
  <div className="card">
    <div className="h-4 w-64 bg-gray-800 rounded mb-4 animate-pulse" />
    <div className="flex items-end gap-4 h-[260px] px-2 pb-6">
      {Array.from({ length: FORECAST_WINDOW }).map((_, i) => (
        <div key={i} className="flex-1 bg-gray-800/70 rounded-t-md animate-pulse" style={{ height: `${30 + (i % 4) * 15}%` }} />
      ))}
    </div>
  </div>
);

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

export default function Dashboard() {
  const now = new Date();
  const { year, month } = usePeriod();
  const { hidden } = useHideValues();

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // For the current month the same request also brings the pace cuts: realized-so-far
  // (pace_until = today, excludes future-dated installments booked on the fatura) and
  // the snapshot at the start of the trailing ~7-day window (window_until) used for
  // the variable-spend rate — one serverless invocation instead of three.
  const paceWindowStartDay = Math.max(1, now.getDate() - 7);
  const paceWindowDays = now.getDate() - paceWindowStartDay;
  const { data: summary, loading: ls, error: summaryError, reload: reloadSummary } = useApi(
    () => api.getSummary({
      year, month,
      ...(isCurrentMonth ? { pace_until: todayStr } : {}),
      ...(isCurrentMonth && paceWindowDays > 0
        ? { window_until: `${todayStr.slice(0, 8)}${String(paceWindowStartDay).padStart(2, '0')}` }
        : {}),
    }),
    [year, month, isCurrentMonth]
  );
  const { data: budgets } = useApi(() => api.getBudgets(year, month), [year, month]);
  const { data: categories } = useApi(() => api.getCategories(), []);
  const { data: trend } = useApi(() => api.getMonthlyTrend(6), []);
  const { data: comparison } = useApi(() => api.getCategoryComparison(year, month), [year, month]);

  // Forecast: despesas vs orçamento for the selected month and every month ahead,
  // computed server-side in one request; trimmed after the last month with expenses
  // (i.e. past the last imported/known transaction).
  const { data: forecast, loading: forecastLoading, error: forecastError, reload: reloadForecast } = useApi(async () => {
    const rows = await api.getForecast(year, month, 12);
    let lastWithExpense = -1;
    rows.forEach((r, i) => { if (r.expense > 0) lastWithExpense = i; });
    return rows.slice(0, lastWithExpense + 1);
  }, [year, month]);

  const forecastData = useMemo(() => (forecast || []).map((r) => {
    const monthName = new Date(r.year, r.month - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
    return {
      year: r.year,
      month: r.month,
      label: `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)}/${r.year}`,
      despesas: r.expense,
      receita: r.income,
      orcamento: r.budget,
      base: Math.min(r.expense, r.budget),
      excess: Math.max(r.expense - r.budget, 0),
      transfers: r.transfers || 0,
      // Transferências (ex.: aporte em investimentos) já saíram do caixa mas não são
      // gasto — descontadas do saldo projetado à parte, não contam como "despesa".
      saldoProjetado: r.projectedIncome - r.projectedExpense - (r.transfers || 0),
      investment: r.investment,
    };
  }), [forecast]);

  const [forecastOffset, setForecastOffset] = useState(0);
  useEffect(() => { setForecastOffset(0); }, [year, month]);
  const forecastCanPrev = forecastOffset > 0;
  const forecastCanNext = forecastOffset + FORECAST_WINDOW < forecastData.length;
  const forecastVisible = forecastData.slice(forecastOffset, forecastOffset + FORECAST_WINDOW);

  // Resgate de Investimentos por Mês: sempre janeiro–dezembro do ano corrente,
  // independente do mês selecionado no Dashboard — senão a janela desliza junto com
  // o seletor de mês e o card vira uma faixa de 8 meses que nunca mostra o ano inteiro.
  const { data: yearForecast } = useApi(() => api.getForecast(now.getFullYear(), 1, 12), [now.getFullYear()]);
  const investData = useMemo(() => (yearForecast || []).map((r) => {
    // Abreviado (ex. "Nov/26") — o nome longo faz o Recharts pular rótulos por falta
    // de espaço quando os 12 meses do ano cabem no eixo.
    const monthName = new Date(r.year, r.month - 1, 1).toLocaleDateString('pt-BR', { month: 'short' });
    const abbrev = monthName.replace('.', '');
    return {
      year: r.year,
      month: r.month,
      label: `${abbrev.charAt(0).toUpperCase()}${abbrev.slice(1)}/${String(r.year).slice(2)}`,
      investment: r.investment,
    };
  }), [yearForecast]);

  const trendData = useMemo(() => {
    if (!trend) return [];
    const map = {};
    trend.forEach(({ month: m, type, total }) => {
      if (!map[m]) map[m] = { month: m.slice(5), income: 0, expense: 0 };
      map[m][type] = total;
    });
    return Object.values(map);
  }, [trend]);

  const incomeCategories = useMemo(() => {
    if (!summary?.byCategory) return [];
    return summary.byCategory.filter((r) => r.type === 'income');
  }, [summary]);

  const expenseCategories = useMemo(() => {
    if (!summary?.byCategory) return [];
    return summary.byCategory.filter((r) => r.type === 'expense');
  }, [summary]);

  const pieData = useMemo(
    () => expenseCategories.map((r) => ({
      name: `${r.icon || ''} ${r.name || 'Sem categoria'}`,
      value: r.total,
      color: r.color,
    })),
    [expenseCategories]
  );

  // monthly_budgets rows can now belong to income categories too (expected income), so budgets
  // used for expense totals must be filtered down to expense categories only.
  const expenseBudgets = useMemo(() => {
    if (!budgets || !categories) return null;
    const expenseCategoryIds = new Set(categories.filter((c) => c.type === 'expense').map((c) => c.id));
    return budgets.filter((r) => expenseCategoryIds.has(r.category_id));
  }, [budgets, categories]);

  const totalBudget = useMemo(
    () => (expenseBudgets || []).reduce((s, r) => s + r.limit_amount, 0),
    [expenseBudgets]
  );

  // Net expense = sum of adjusted category totals (reimbursements already subtracted per category)
  const netExpense = useMemo(
    () => expenseCategories.reduce((s, r) => s + r.total, 0),
    [expenseCategories]
  );

  const incomeBudgets = useMemo(() => {
    if (!budgets || !categories) return null;
    const incomeCategoryIds = new Set(categories.filter((c) => c.type === 'income').map((c) => c.id));
    return budgets.filter((r) => incomeCategoryIds.has(r.category_id));
  }, [budgets, categories]);

  const recurringIds = useMemo(
    () => new Set((categories || []).filter((c) => c.is_recurring).map((c) => c.id)),
    [categories]
  );

  const projectedExpense = useMemo(
    () => (categories ? projectBucket(expenseBudgets, expenseCategories, recurringIds) : null),
    [expenseBudgets, categories, expenseCategories, recurringIds]
  );

  const projectedIncome = useMemo(
    () => (categories ? projectBucket(incomeBudgets, incomeCategories, recurringIds) : null),
    [incomeBudgets, categories, incomeCategories, recurringIds]
  );

  // Transferências já realizadas no mês (ex. aporte em investimentos) são caixa que
  // já saiu de fato — descontam do saldo projetado mesmo não sendo "despesa".
  const projectedBalance = (projectedExpense !== null && projectedIncome !== null)
    ? projectedIncome - projectedExpense - (summary?.transfers ?? 0)
    : null;

  // Investment-withdrawal tracker: the income category used to top up the month from savings.
  const investmentCategory = useMemo(
    () => (categories || []).find((c) => c.type === 'income' && /invest/i.test(c.name)),
    [categories]
  );
  const investmentExpected = useMemo(() => {
    if (!investmentCategory || !incomeBudgets) return null;
    const b = incomeBudgets.find((r) => r.category_id === investmentCategory.id);
    return b ? Number(b.limit_amount) : null;
  }, [investmentCategory, incomeBudgets]);

  // Realized (until today) expense totals, keyed by category — for pace math. Two
  // variants: the full total (drives realizedNet, used only for the "already booked
  // with future date" footer, unrelated to the extraordinary flag) and the
  // excluding-extraordinary total (feeds variablePace only — transactions tagged
  // extraordinary are one-off events that shouldn't shape a repeatable daily rate,
  // but they still count everywhere else: totals, budgets, Saldo Projetado, etc).
  const realizedById = useMemo(() => {
    if (!summary?.paceByCategory) return null;
    const map = {};
    summary.paceByCategory.forEach((r) => { if (r.type === 'expense') map[r.id] = Number(r.total); });
    return map;
  }, [summary]);

  const realizedExclById = useMemo(() => {
    if (!summary?.paceByCategory) return null;
    const map = {};
    summary.paceByCategory.forEach((r) => { if (r.type === 'expense') map[r.id] = Number(r.total_excl_extraordinary); });
    return map;
  }, [summary]);

  const realizedNet = useMemo(
    () => (realizedById ? Object.values(realizedById).reduce((s, v) => s + v, 0) : null),
    [realizedById]
  );

  // Variable-spend pace: R$/day over the trailing window. Non-recurring categories
  // count in full. Recurring categories are hybrid: the budgeted amount is the fixed
  // part (e.g. a fixed monthly health plan) — only the excess above budget behaves as
  // variable spend and feeds the pace. Fixed spend itself is never extrapolated; it
  // lands at its budget via projectBucket. Returns { total, byId } or null while loading.
  const variablePace = useMemo(() => {
    if (!realizedExclById || !summary?.windowByCategory || !categories || paceWindowDays <= 0) return null;
    const prevById = {};
    summary.windowByCategory.forEach((r) => { if (r.type === 'expense') prevById[r.id] = Number(r.total_excl_extraordinary); });
    const budgetById = {};
    expenseCategories.forEach((r) => { budgetById[r.id] = Number(r.budget_limit) || 0; });
    const byId = {};
    let total = 0;
    Object.entries(realizedExclById).forEach(([id, val]) => {
      const nid = Number(id);
      const prev = prevById[id] ?? 0;
      let delta;
      if (recurringIds.has(nid)) {
        const b = budgetById[nid] ?? 0;
        delta = Math.max(0, val - b) - Math.max(0, prev - b);
      } else {
        delta = val - prev;
      }
      const pace = Math.max(0, delta) / paceWindowDays;
      byId[nid] = pace;
      total += pace;
    });
    return { total, byId };
  }, [realizedExclById, summary, categories, expenseCategories, recurringIds, paceWindowDays]);

  if (!summary && ls) return <div className="p-6 text-gray-500 text-sm">Carregando...</div>;
  if (!summary && summaryError) return (
    <div className="p-6 max-w-md mx-auto text-center space-y-3">
      <p className="text-sm text-gray-500">Não foi possível carregar o dashboard. {summaryError}</p>
      <button onClick={reloadSummary} className="btn-ghost text-sm">Tentar novamente</button>
    </div>
  );

  return (
    <div className={`p-6 space-y-5 max-w-7xl mx-auto transition-opacity duration-150 ${ls ? 'opacity-60' : 'opacity-100'}`}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-semibold text-white tracking-tight">Dashboard</h1>
            <p className="text-sm text-gray-500 capitalize">{fmt.monthYear(year, month)}</p>
          </div>
        </div>
      </div>

      {/* KPIs — 4 cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard label="Receitas" value={mask(fmt.currency(summary?.income), hidden)} icon={<TrendingUp size={20} />} color="text-emerald-400" bg="bg-emerald-500/10" />
        <KpiCard label="Despesas" value={mask(fmt.currency(summary?.expense), hidden)} icon={<TrendingDown size={20} />} color="text-red-400" bg="bg-red-500/10" />
        <KpiCard
          label="Saldo Mensal"
          value={mask(fmt.currency((summary?.income ?? 0) - (summary?.expense ?? 0) - (summary?.transfers ?? 0)), hidden)}
          icon={<Wallet size={20} />}
          color={((summary?.income ?? 0) - (summary?.expense ?? 0) - (summary?.transfers ?? 0)) >= 0 ? 'text-emerald-400' : 'text-red-400'}
          bg="bg-emerald-500/10"
        />
        <KpiCard label="Orçamento" value={mask(fmt.currency(totalBudget), hidden)} icon={<Target size={20} />} color="text-amber-400" bg="bg-amber-500/10" />
        <KpiCard
          label="Saldo Projetado"
          value={projectedBalance !== null ? mask(fmt.currency(projectedBalance), hidden) : '-'}
          icon={<Wallet size={20} />}
          color={projectedBalance !== null && projectedBalance < 0 ? 'text-red-400' : 'text-indigo-400'}
          bg="bg-indigo-500/10"
        />
      </div>

      {/* Spending pace — current month only */}
      {isCurrentMonth && totalBudget > 0 && realizedNet !== null && (
        <PaceCard
          realizedNet={realizedNet}
          netExpense={netExpense}
          totalBudget={totalBudget}
          projectedExpense={projectedExpense}
          variablePace={variablePace}
          windowDays={paceWindowDays}
          expenseCategories={expenseCategories}
          recurringIds={recurringIds}
          hidden={hidden}
        />
      )}

      {/* Fixed-commitment ratio — how much of the expected income is claimed by fixed budgets */}
      <CommitmentCard
        incomeBudgets={incomeBudgets}
        expenseBudgets={expenseBudgets}
        recurringIds={recurringIds}
        hidden={hidden}
      />

      {/* Category bars (left) + Pie (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Income + Expense category bars */}
        <div className="space-y-4">
          <div className="card">
            <h3 className="text-sm font-medium text-gray-300 mb-3">Receitas por Categoria</h3>
            {incomeCategories.length === 0 ? (
              <p className="text-gray-600 text-sm">Sem receitas registradas neste mês.</p>
            ) : (
              <div className="divide-y divide-gray-800/50">
                {incomeCategories.map((r) => (
                  <IncomeCategoryBar key={r.id ?? r.name} row={r} year={year} month={month} hidden={hidden} maxTotal={incomeCategories[0]?.total ?? 0} />
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="text-sm font-medium text-gray-300 mb-3">Despesas por Categoria</h3>
            {expenseCategories.length === 0 ? (
              <p className="text-gray-600 text-sm">Sem despesas registradas neste mês.</p>
            ) : (
              <div className="divide-y divide-gray-800/50">
                {expenseCategories.map((r) => (
                  <CategoryBar key={r.id ?? r.name} row={r} year={year} month={month} hidden={hidden} isCurrentMonth={isCurrentMonth} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Pie chart — donut, legend below */}
        <div className="card">
          <h3 className="text-sm font-medium text-gray-300 mb-3">Despesas por Categoria</h3>
          {pieData.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-gray-600 text-sm">
              Sem despesas este mês
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
                        const formatted = fmt.currency(netExpense).split(',')[0];
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

              {/* Legend below — 2 column grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2 border-t border-gray-800 pt-3">
                {pieData.map((e) => {
                  const pct = netExpense > 0 ? ((e.value / netExpense) * 100).toFixed(0) : 0;
                  return (
                    <div key={e.name} className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: e.color }} />
                      <span className="text-xs text-gray-300 truncate flex-1">{e.name}</span>
                      <span className="text-xs text-gray-500 flex-shrink-0 ml-1">{pct}%</span>
                    </div>
                  );
                })}
              </div>

              {/* Month-over-month comparison */}
              {comparison && comparison.length > 0 && (
                <CategoryComparison comparison={comparison} hidden={hidden} />
              )}
            </>
          )}
        </div>
      </div>

      {/* Forecast: despesas vs orçamento, mês atual e meses à frente */}
      {forecastLoading && <ForecastSkeleton />}
      {!forecastLoading && forecastError && (
        <div className="card flex flex-col items-center justify-center gap-2 py-10 text-center">
          <p className="text-sm text-gray-500">Não foi possível carregar a projeção. {forecastError}</p>
          <button onClick={reloadForecast} className="btn-ghost text-sm">Tentar novamente</button>
        </div>
      )}
      {!forecastLoading && !forecastError && forecastData.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-300">Saldo Projetado, Despesas vs. Orçamento</h3>
            {forecastData.length > FORECAST_WINDOW && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setForecastOffset((o) => Math.max(0, o - FORECAST_WINDOW))}
                  disabled={!forecastCanPrev}
                  className="btn-ghost p-1 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setForecastOffset((o) => Math.min(forecastData.length - FORECAST_WINDOW, o + FORECAST_WINDOW))}
                  disabled={!forecastCanNext}
                  className="btn-ghost p-1 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={forecastVisible} barGap={-FORECAST_BAR}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 12 }} axisLine={{ stroke: '#374151' }} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
              <Tooltip content={<TooltipBR hidden={hidden} />} formatter={(v) => v} cursor={false} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
              <Bar dataKey="base" name="Despesas" stackId="despesa" fill="#3987e5" radius={[0, 0, 0, 0]} barSize={FORECAST_BAR} activeBar={{ fill: '#5c9fea' }} />
              <Bar dataKey="excess" stackId="despesa" fill="#1c5cab" radius={[4, 4, 0, 0]} barSize={FORECAST_BAR} activeBar={{ fill: '#164a8c' }} legendType="none" />
              <Bar dataKey="orcamento" name="Orçamento" fill="#f59e0b" barSize={FORECAST_BAR} shape={<TargetMark />} legendType="rect" />
              <Line
                dataKey="saldoProjetado"
                name="Saldo Projetado"
                stroke="#22d3ee"
                strokeWidth={0}
                isAnimationActive={false}
                legendType="circle"
                dot={(props) => {
                  const { cx, cy, value, key } = props;
                  const color = value >= 0 ? '#34d399' : '#f87171';
                  return <circle key={key} cx={cx} cy={cy} r={4} fill={color} stroke="#111827" strokeWidth={2} />;
                }}
                activeDot={(props) => {
                  const { cx, cy, value, key } = props;
                  const color = value >= 0 ? '#34d399' : '#f87171';
                  return <circle key={key} cx={cx} cy={cy} r={5} fill={color} stroke="#111827" strokeWidth={2} />;
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Active installment plans */}
      <InstallmentsCard hidden={hidden} salarioEquivalente={(incomeBudgets || []).reduce((s, r) => s + Number(r.limit_amount), 0)} />

      {/* Investment-withdrawal tracker */}
      {investmentCategory && investData.some((r) => r.investment != null) && (
        <InvestmentHistoryCard
          category={investmentCategory}
          expected={investmentExpected}
          hidden={hidden}
          data={investData}
        />
      )}

      {/* Trend */}
      <div className="card">
        <h3 className="text-sm font-medium text-gray-300 mb-4">Evolução nos Últimos 6 Meses</h3>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={trendData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 12 }} />
            <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
            <Tooltip content={<TooltipBR hidden={hidden} />} />
            <Line type="linear" dataKey="income" name="Receitas" stroke="#10b981" strokeWidth={2} dot={false} />
            <Line type="linear" dataKey="expense" name="Despesas" stroke="#ef4444" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function InvestmentHistoryCard({ category, expected, hidden, data }) {
  const now = new Date();
  const currentKey = now.getFullYear() * 100 + (now.getMonth() + 1);
  const observed = data.filter((r) => r.investment != null && r.year * 100 + r.month <= currentKey);
  const avg = observed.length ? observed.reduce((s, r) => s + r.investment, 0) / observed.length : null;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-300">{category.icon} Resgate de Investimentos por Mês</h3>
        {avg !== null && <span className="text-xs text-gray-500">média {mask(fmt.currency(avg), hidden)}</span>}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
          <XAxis dataKey="label" interval={0} tick={{ fill: '#6b7280', fontSize: 12 }} axisLine={{ stroke: '#374151' }} tickLine={false} />
          <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} axisLine={false} tickLine={false} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="bg-gray-800 border border-gray-700 rounded-xl p-3 text-sm shadow-xl">
                  <p className="text-gray-400 mb-1">{label}</p>
                  <p style={{ color: '#3987e5' }}>Resgate: {mask(fmt.currency(payload[0].value), hidden)}</p>
                </div>
              );
            }}
            cursor={false}
          />
          <Bar dataKey="investment" name="Resgate" fill="#3987e5" radius={[4, 4, 0, 0]} barSize={FORECAST_BAR} activeBar={{ fill: '#5c9fea' }} />
        </ComposedChart>
      </ResponsiveContainer>
      {expected != null && (
        <p className="text-xs text-gray-500 mt-1 pt-3 border-t border-gray-800">
          Planejado: {mask(fmt.currency(expected), hidden)}/mês
        </p>
      )}
    </div>
  );
}

// Intra-month spending pace. The projection is NOT a linear extrapolation of the
// month's average — that falls apart with fixed categories (booked in one shot) and
// one-off spikes. Instead: fixed/recurring spend lands at its budget (projectedExpense,
// same rule as Saldo Projetado), and only the variable spend gets a rate — measured
// over the trailing ~7-day window, so a spike ages out of the rate within a week
// while still counting as fact in what's already booked.
function PaceCard({ realizedNet, netExpense, totalBudget, projectedExpense, variablePace, windowDays, expenseCategories, recurringIds, hidden }) {
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = now.getDate();
  const daysLeft = daysInMonth - day + 1; // includes today
  const daysAhead = daysInMonth - day; // days the variable pace still applies to
  const remaining = totalBudget - netExpense;
  const hasPace = variablePace !== null && windowDays >= 3 && projectedExpense !== null;
  const projected = hasPace ? projectedExpense + variablePace.total * daysAhead : null;
  const safePerDay = remaining > 0 ? remaining / daysLeft : 0;
  const projectedOver = projected !== null && projected > totalBudget;

  const withLimit = expenseCategories.filter((r) => r.budget_limit != null && Number(r.budget_limit) > 0);
  const blown = withLimit.filter((r) => r.total > Number(r.budget_limit));
  // At-risk = non-recurring categories whose booked total + variable pace × remaining
  // days crosses the limit. Recurring ones are assumed to land at budget by design.
  const atRisk = hasPace
    ? withLimit.filter((r) => {
        if (r.total > Number(r.budget_limit) || recurringIds.has(r.id)) return false;
        const pace = variablePace.byId[r.id] ?? 0;
        return r.total + pace * daysAhead > Number(r.budget_limit);
      })
    : [];

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <Gauge size={16} className="text-indigo-400" />
        <h3 className="text-sm font-medium text-gray-300">Ritmo do Mês</h3>
        <span className="text-xs text-gray-600">dia {day} de {daysInMonth}</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Ritmo variável · últimos {windowDays} dias</p>
          <p className="text-base font-semibold text-gray-200">
            {hasPace ? <>{mask(fmt.currency(variablePace.total), hidden)}<span className="text-xs font-normal text-gray-600 ml-1">/dia</span></> : '-'}
          </p>
          <p className="text-xs text-gray-600">variáveis + excedente das fixas</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Projeção do mês</p>
          <p className={`text-base font-semibold ${projectedOver ? 'text-red-400' : 'text-emerald-400'}`}>
            {projected !== null ? mask(fmt.currency(projected), hidden) : '-'}
            {projected !== null && (
              <span className="text-xs font-normal text-gray-600 ml-1">/ {mask(fmt.currency(totalBudget), hidden)}</span>
            )}
          </p>
          <p className="text-xs text-gray-600">fixas no orçamento + variáveis no ritmo</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Pode gastar por dia</p>
          {remaining > 0 ? (
            <p className="text-base font-semibold text-indigo-400">
              {mask(fmt.currency(safePerDay), hidden)}
              <span className="text-xs font-normal text-gray-600 ml-1">por {daysLeft} dias</span>
            </p>
          ) : (
            <p className="text-base font-semibold text-red-400">orçamento esgotado</p>
          )}
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Categorias</p>
          <p className="text-sm text-gray-300 leading-snug">
            {blown.length > 0 && <span className="text-red-400">{blown.length} estourada{blown.length > 1 ? 's' : ''}</span>}
            {blown.length > 0 && atRisk.length > 0 && <span className="text-gray-600"> · </span>}
            {atRisk.length > 0 && <span className="text-amber-400">{atRisk.length} em risco</span>}
            {blown.length === 0 && atRisk.length === 0 && <span className="text-emerald-400">todas no ritmo ✓</span>}
          </p>
          {atRisk.length > 0 && (
            <p className="text-xs text-gray-600 truncate" title={atRisk.map((r) => r.name).join(', ')}>
              {atRisk.map((r) => r.icon).join(' ')} {atRisk.map((r) => r.name).join(', ')}
            </p>
          )}
        </div>
      </div>
      {netExpense - realizedNet > 0 && (
        <p className="text-xs text-gray-600 mt-3 pt-3 border-t border-gray-800">
          {mask(fmt.currency(netExpense - realizedNet), hidden)} já lançados com data futura neste mês (parcelas/fatura), considerados na projeção e no saldo disponível.
        </p>
      )}
    </div>
  );
}

// Fixed-commitment ratio: fixed = budgets of recurring categories (the hybrid rule —
// a recurring category is "fixed" only up to its budgeted amount). The income here is
// the planned monthly income — the sum of the income categories' budgets, which may
// include planned investment withdrawals for people who live off their savings.
function CommitmentCard({ incomeBudgets, expenseBudgets, recurringIds, hidden }) {
  if (!incomeBudgets || !expenseBudgets) return null;
  const income = incomeBudgets.reduce((s, r) => s + Number(r.limit_amount), 0);
  if (income <= 0) return null;

  const fixed = expenseBudgets.filter((r) => recurringIds.has(r.category_id)).reduce((s, r) => s + Number(r.limit_amount), 0);
  const variable = expenseBudgets.filter((r) => !recurringIds.has(r.category_id)).reduce((s, r) => s + Number(r.limit_amount), 0);
  const free = income - fixed - variable;

  const pct = (fixed / income) * 100;
  const color = pct <= 50 ? 'text-emerald-400' : pct <= 60 ? 'text-amber-400' : 'text-red-400';

  const fixedW = Math.min((fixed / income) * 100, 100);
  const varW = Math.min((variable / income) * 100, 100 - fixedW);
  const freeW = Math.max(0, 100 - fixedW - varW);

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <Lock size={16} className="text-indigo-400" />
        <h3 className="text-sm font-medium text-gray-300">Comprometimento da Renda</h3>
      </div>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3 mb-3">
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Fixas / renda planejada</p>
          <p className={`text-2xl font-bold ${color}`}>{mask(`${pct.toFixed(0)}%`, hidden)}</p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div>
            <p className="text-xs text-gray-500">Fixas</p>
            <p className="text-gray-200 font-medium">{mask(fmt.currency(fixed), hidden)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Variáveis (orçado)</p>
            <p className="text-gray-200 font-medium">{mask(fmt.currency(variable), hidden)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{free >= 0 ? 'Livre' : 'Excesso'}</p>
            <p className={`font-medium ${free >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{mask(fmt.currency(Math.abs(free)), hidden)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Renda mensal planejada</p>
            <p className="text-gray-200 font-medium">{mask(fmt.currency(income), hidden)}</p>
          </div>
        </div>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden flex bg-gray-800">
        <div className="h-full bg-indigo-500" style={{ width: `${fixedW}%` }} title="Fixas" />
        <div className="h-full bg-amber-500/70" style={{ width: `${varW}%` }} title="Variáveis" />
        <div className="h-full bg-emerald-500/50" style={{ width: `${freeW}%` }} title="Livre" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-y-1.5 mt-2">
        <div className="flex gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-indigo-500" /> Fixas</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500/70" /> Variáveis</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500/50" /> Livre</span>
        </div>
        <p className="text-xs text-gray-600">até 50% confortável · 50–60% atenção · +60% crítico</p>
      </div>
      {free < 0 && (
        <p className="text-xs text-red-400 mt-2 pt-2 border-t border-gray-800">
          O orçamento total excede a renda mensal planejada em {mask(fmt.currency(-free), hidden)}: o mês já começa deficitário.
        </p>
      )}
      <p className="text-xs text-gray-600 mt-2 pt-2 border-t border-gray-800">
        Renda mensal planejada = soma dos orçamentos das categorias de receita do mês.
      </p>
    </div>
  );
}

function KpiCard({ label, value, sub, icon, color, bg }) {
  return (
    <div className="card flex flex-col items-start gap-2 lg:flex-row lg:items-center lg:gap-3">
      <div className={`w-9 h-9 ${bg} ${color} rounded-xl flex items-center justify-center flex-shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
        <p className={`text-lg font-semibold ${color}`}>{value}</p>
        {sub && <p className="text-xs text-gray-600">{sub}</p>}
      </div>
    </div>
  );
}

function IncomeCategoryBar({ row, year, month, hidden, maxTotal }) {
  const [expanded, setExpanded] = useState(false);
  const [txns, setTxns] = useState(null);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [editTx, setEditTx] = useState(null);

  useEffect(() => {
    setTxns(null);
  }, [year, month, row.id]);

  function reloadTxns() {
    api.getTransactions({ year, month, category_id: row.id, limit: 200 })
      .then((res) => setTxns(Array.isArray(res) ? res : (res.transactions ?? [])));
  }

  async function toggle() {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (txns === null) {
      setLoadingTxns(true);
      try {
        const rows = await api.getTransactions({ year, month, category_id: row.id, limit: 100 });
        setTxns(rows);
      } finally {
        setLoadingTxns(false);
      }
    }
  }

  const hasExpected = row.budget_limit != null && row.budget_limit > 0;
  const barMax = hasExpected ? Math.max(row.total, row.budget_limit) : maxTotal;
  const barPct = barMax > 0 ? (row.total / barMax) * 100 : 100;
  const expectedPct = hasExpected && barMax > 0 ? (row.budget_limit / barMax) * 100 : null;

  return (
    <div>
      <button
        onClick={toggle}
        className="w-full text-left py-2.5 px-2 hover:bg-gray-800/40 transition-colors group rounded-lg"
      >
        <div className="flex flex-wrap items-center justify-between gap-y-1 mb-1.5">
          <span className="text-sm text-gray-200 flex items-center gap-1.5 min-w-0">
            <span>{row.icon}</span>
            {row.name || 'Sem categoria'}
          </span>
          <div className="flex items-center gap-2">
            <div className="flex flex-wrap items-center justify-end gap-x-1 gap-y-0.5 text-xs">
              <span className="text-emerald-400 font-medium">{mask(fmt.currency(row.total), hidden)}</span>
              {hasExpected && <span className="text-gray-600">/ {mask(fmt.currency(row.budget_limit), hidden)} esperado</span>}
            </div>
            <span className="text-gray-700 group-hover:text-gray-400 transition-colors">
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </span>
          </div>
        </div>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden relative">
          <div className="h-full bg-emerald-500/60 transition-all" style={{ width: `${barPct}%` }} />
          {expectedPct !== null && (
            <div className="absolute top-0 bottom-0 w-0.5 bg-gray-500" style={{ left: `${expectedPct}%` }} />
          )}
        </div>
      </button>

      <div className="overflow-hidden transition-all duration-200" style={{ maxHeight: expanded ? '400px' : '0px' }}>
        <div className="mx-2 mb-1 rounded-lg bg-gray-800/40 border border-gray-700/40 overflow-hidden">
          {loadingTxns ? (
            <p className="text-xs text-gray-500 p-3">Carregando...</p>
          ) : txns?.length === 0 ? (
            <p className="text-xs text-gray-500 p-3">Sem transações neste mês.</p>
          ) : (
            <div className="divide-y divide-gray-700/30 max-h-56 overflow-y-auto">
              {txns?.map((t) => (
                <button key={t.id} onClick={() => setEditTx(t)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-indigo-500/10 transition-colors text-left group">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-gray-500 flex-shrink-0 tabular-nums">{fmt.date(t.date)}</span>
                    <span className="text-gray-300 truncate group-hover:text-white transition-colors">{t.description || '-'}</span>
                  </div>
                  <span className="flex-shrink-0 ml-2 font-medium text-emerald-400">
                    {mask(fmt.currency(t.amount), hidden)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {editTx && (
        <EditTransactionModal
          transaction={editTx}
          onClose={() => setEditTx(null)}
          onSaved={reloadTxns}
        />
      )}
    </div>
  );
}

function CategoryComparison({ comparison, hidden }) {
  const increases = comparison.filter((r) => r.pct > 0).slice(0, 3);
  const decreases = comparison.filter((r) => r.pct < 0).slice(0, 3);

  if (increases.length === 0 && decreases.length === 0) return null;

  const maxAbsPct = Math.max(...comparison.slice(0, 6).map((r) => Math.abs(r.pct)));

  const Row = ({ r, up }) => {
    const barW = maxAbsPct > 0 ? (Math.abs(r.pct) / maxAbsPct) * 100 : 0;
    return (
      <div className="flex items-center gap-3 group">
        <div className="flex items-center gap-1.5 w-32 flex-shrink-0">
          <span className="text-base leading-none">{r.icon}</span>
          <span className="text-xs text-gray-300 truncate">{r.name}</span>
        </div>
        <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${up ? 'bg-red-500/70' : 'bg-emerald-500/70'}`}
            style={{ width: `${barW}%` }}
          />
        </div>
        <div className={`flex flex-col items-end flex-shrink-0 ${up ? 'text-red-400' : 'text-emerald-400'}`}>
          <span className="flex items-center gap-0.5 text-xs font-semibold">
            {up ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
            {Math.abs(r.pct).toFixed(0)}%
          </span>
          <span className="text-xs text-gray-500">{mask(fmt.currency(Math.abs(r.diff)), hidden)}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="mt-5 border-t border-gray-800 pt-4">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Comparação vs. Mês Anterior</p>
      <div className="space-y-2.5">
        {increases.map((r) => <Row key={r.id} r={r} up={true} />)}
        {increases.length > 0 && decreases.length > 0 && (
          <div className="border-t border-gray-800/60 my-1" />
        )}
        {decreases.map((r) => <Row key={r.id} r={r} up={false} />)}
      </div>
    </div>
  );
}

function CategoryBar({ row, year, month, hidden, isCurrentMonth }) {
  const [expanded, setExpanded] = useState(false);
  const [txns, setTxns] = useState(null);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [editTx, setEditTx] = useState(null);

  useEffect(() => {
    setTxns(null);
  }, [year, month, row.id]);

  function reloadTxns() {
    api.getTransactions({ year, month, category_id: row.id, limit: 200 })
      .then((res) => setTxns(Array.isArray(res) ? res : (res.transactions ?? [])));
  }

  const hasLimit = row.budget_limit != null && row.budget_limit > 0;
  const over = hasLimit && row.total > row.budget_limit;
  // bar scale = max(spent, budget) so all three zones fit within 100%
  const barMax = hasLimit ? Math.max(row.total, row.budget_limit) : row.total;
  const greenPct = hasLimit ? (Math.min(row.total, row.budget_limit) / barMax) * 100 : 100;
  const grayPct  = hasLimit && !over ? ((row.budget_limit - row.total) / barMax) * 100 : 0;
  const redPct   = over ? ((row.total - row.budget_limit) / barMax) * 100 : 0;

  // "Disponível/dia" uses row.total, which also counts future-dated installments
  // already booked — committed money isn't spendable. Current month only.
  const today = new Date().getDate();
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysLeft = daysInMonth - today + 1;
  const safePerDay = isCurrentMonth && hasLimit && !over && daysLeft > 0
    ? (Number(row.budget_limit) - row.total) / daysLeft
    : null;

  async function toggle() {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (txns === null) {
      setLoadingTxns(true);
      try {
        const rows = await api.getTransactions({ year, month, category_id: row.id, limit: 100 });
        setTxns(rows);
      } finally {
        setLoadingTxns(false);
      }
    }
  }

  return (
    <div>
      <button
        onClick={toggle}
        className="w-full text-left py-2.5 px-2 hover:bg-gray-800/40 transition-colors group rounded-lg"
      >
        <div className="flex flex-wrap items-center justify-between gap-y-1 mb-1.5">
          <span className="text-sm text-gray-200 flex items-center gap-1.5 min-w-0">
            <span>{row.icon}</span>
            {row.name || 'Sem categoria'}
          </span>
          <div className="flex items-center gap-2">
            <div className="flex flex-wrap items-center justify-end gap-x-1 gap-y-0.5 text-xs">
              <span className={over ? 'text-red-400 font-medium' : 'text-gray-400'}>
                {mask(fmt.currency(row.total), hidden)}
              </span>
              {hasLimit && <span className="text-gray-600">/ {mask(fmt.currency(row.budget_limit), hidden)}</span>}
              {over && !hidden && (
                <span className="text-red-400 font-semibold bg-red-500/15 px-1.5 py-0.5 rounded ml-1">
                  +{fmt.currency(row.total - row.budget_limit)}
                </span>
              )}
            </div>
            <span className="text-gray-700 group-hover:text-gray-400 transition-colors">
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </span>
          </div>
        </div>

        <div className="h-2 bg-gray-800 rounded-full overflow-hidden flex">
          {hasLimit ? (
            <>
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${greenPct}%` }} />
              {grayPct > 0 && <div className="h-full bg-gray-600 transition-all" style={{ width: `${grayPct}%` }} />}
              {redPct  > 0 && <div className="h-full bg-red-500 transition-all"   style={{ width: `${redPct}%` }} />}
            </>
          ) : (
            <div className="h-full bg-indigo-500/50 w-full" />
          )}
        </div>

        <div className="flex justify-between items-center mt-0.5">
          {row.reimbursed > 0 ? (
            <p className="text-xs text-gray-500">{mask(fmt.currency(row.total + row.reimbursed), hidden)} gasto &nbsp;·&nbsp; <span className="text-teal-400/70">↩ {mask(fmt.currency(row.reimbursed), hidden)} reembolsado</span></p>
          ) : <span />}
          {hasLimit && !over && (
            <p className="text-xs text-gray-600">
              {mask(fmt.currency(row.budget_limit - row.total), hidden)} disponível
              {safePerDay !== null && safePerDay > 0 && (
                <span> · {mask(fmt.currency(safePerDay), hidden)}/dia</span>
              )}
            </p>
          )}
        </div>
      </button>

      <div className="overflow-hidden transition-all duration-200" style={{ maxHeight: expanded ? '400px' : '0px' }}>
        <div className="mx-2 mb-1 rounded-lg bg-gray-800/40 border border-gray-700/40 overflow-hidden">
          {loadingTxns ? (
            <p className="text-xs text-gray-500 p-3">Carregando...</p>
          ) : txns?.length === 0 ? (
            <p className="text-xs text-gray-500 p-3">Sem transações neste mês.</p>
          ) : (
            <div className="divide-y divide-gray-700/30 max-h-56 overflow-y-auto">
              {txns?.map((t) => (
                <button key={t.id} onClick={() => setEditTx(t)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-indigo-500/10 transition-colors text-left group">
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
        </div>
      </div>

      {editTx && (
        <EditTransactionModal
          transaction={editTx}
          onClose={() => setEditTx(null)}
          onSaved={reloadTxns}
        />
      )}
    </div>
  );
}
