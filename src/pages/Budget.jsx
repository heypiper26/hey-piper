import { useState, useEffect, useCallback } from 'react';
import { Copy, Save, Repeat } from 'lucide-react';
import { api } from '../api.js';
import { fmt } from '../utils/format.js';
import { usePeriod } from '../hooks/usePeriod.js';
import Modal from '../components/Modal.jsx';
import { useHideValues, mask } from '../hooks/useHideValues.js';

export default function Budget() {
  const { hidden } = useHideValues();
  const { year, month } = usePeriod();
  const [expenseCategories, setExpenseCategories] = useState([]);
  const [incomeCategories, setIncomeCategories] = useState([]);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copyModal, setCopyModal] = useState(false);

  const load = useCallback(async () => {
    const [cats, budgets] = await Promise.all([
      api.getCategories(),
      api.getBudgets(year, month),
    ]);
    setExpenseCategories(cats.filter((c) => c.type === 'expense'));
    setIncomeCategories(cats.filter((c) => c.type === 'income'));
    const map = {};
    budgets.forEach(({ category_id, limit_amount }) => {
      map[category_id] = limit_amount;
    });
    setValues(map);
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      const budgets = [...expenseCategories, ...incomeCategories].map((c) => ({
        category_id: c.id,
        limit_amount: values[c.id] != null && values[c.id] !== '' ? Number(values[c.id]) : null,
      }));
      await api.saveBudgets(year, month, budgets);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }

  const total = expenseCategories.reduce((s, c) => {
    const v = Number(values[c.id]);
    return s + (isNaN(v) ? 0 : v);
  }, 0);

  const totalIncome = incomeCategories.reduce((s, c) => {
    const v = Number(values[c.id]);
    return s + (isNaN(v) ? 0 : v);
  }, 0);

  function toggleRecurring(c, setter) {
    const next = !c.is_recurring;
    setter((cats) => cats.map((x) => (x.id === c.id ? { ...x, is_recurring: next } : x)));
    api.setCategoryRecurring(c.id, next).catch(() => {
      setter((cats) => cats.map((x) => (x.id === c.id ? { ...x, is_recurring: !next } : x)));
    });
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-white tracking-tight">Orçamento</h1>
        <div className="flex items-center flex-wrap gap-2 sm:gap-3">
          <button onClick={() => setCopyModal(true)} className="btn-ghost flex items-center gap-1.5 text-sm">
            <Copy size={15} /> Copiar
          </button>
          <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-1.5 text-sm disabled:opacity-50">
            <Save size={15} /> {saved ? 'Salvo!' : saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>

      <div className="card space-y-1">
        <div className="flex items-center justify-between px-2 pb-3 border-b border-gray-800">
          <span className="text-xs text-gray-400 uppercase tracking-wide">Receita</span>
          <span className="text-xs text-gray-400 uppercase tracking-wide">Esperado (R$)</span>
        </div>
        {incomeCategories.length === 0 && (
          <p className="text-sm text-gray-500 py-4 text-center">Nenhuma categoria de receita cadastrada.</p>
        )}
        {incomeCategories.map((c) => (
          <BudgetRow key={c.id} c={c} values={values} setValues={setValues} hidden={hidden} onToggleRecurring={() => toggleRecurring(c, setIncomeCategories)} />
        ))}
        {totalIncome > 0 && (
          <div className="flex items-center justify-between px-2 pt-3 border-t border-gray-800">
            <span className="text-sm text-gray-400">Total esperado</span>
            <span className="text-sm font-semibold text-white">{mask(fmt.currency(totalIncome), hidden)}</span>
          </div>
        )}
      </div>

      <div className="card space-y-1">
        <div className="flex items-center justify-between px-2 pb-3 border-b border-gray-800">
          <span className="text-xs text-gray-400 uppercase tracking-wide">Despesa</span>
          <span className="text-xs text-gray-400 uppercase tracking-wide">Limite (R$)</span>
        </div>
        {expenseCategories.length === 0 && (
          <p className="text-sm text-gray-500 py-4 text-center">Nenhuma categoria de despesa cadastrada.</p>
        )}
        {expenseCategories.map((c) => (
          <BudgetRow key={c.id} c={c} values={values} setValues={setValues} hidden={hidden} onToggleRecurring={() => toggleRecurring(c, setExpenseCategories)} />
        ))}
        {total > 0 && (
          <div className="flex items-center justify-between px-2 pt-3 border-t border-gray-800">
            <span className="text-sm text-gray-400">Total alocado</span>
            <span className="text-sm font-semibold text-white">{mask(fmt.currency(total), hidden)}</span>
          </div>
        )}
      </div>

      {copyModal && (
        <CopyModal currentYear={year} currentMonth={month} onClose={() => setCopyModal(false)} onDone={load} />
      )}
    </div>
  );
}

function BudgetRow({ c, values, setValues, hidden, onToggleRecurring }) {
  return (
    <div className="flex items-center gap-2 sm:gap-3 py-2 px-1 sm:px-2 min-w-0">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0"
        style={{ backgroundColor: `${c.color}20` }}>
        {c.icon}
      </div>
      <span className="flex-1 text-sm text-gray-200 truncate min-w-0">{c.name}</span>
      <button
        type="button"
        onClick={onToggleRecurring}
        title={c.is_recurring ? 'Recorrente: conta no Saldo Projetado' : 'Marcar como recorrente'}
        className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-colors flex-shrink-0 ${
          c.is_recurring
            ? 'bg-indigo-500/15 text-indigo-400'
            : 'bg-gray-800 text-gray-500 hover:text-gray-300'
        }`}
      >
        <Repeat size={12} /> <span className="hidden sm:inline">Recorrente</span>
      </button>
      {hidden ? (
        <span className="input w-24 sm:w-32 text-right flex items-center justify-end text-gray-500 select-none flex-shrink-0">••••</span>
      ) : (
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="-"
          className="input w-24 sm:w-32 text-right flex-shrink-0"
          value={values[c.id] ?? ''}
          onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))}
        />
      )}
    </div>
  );
}

function CopyModal({ currentYear, currentMonth, onClose, onDone }) {
  const [months, setMonths] = useState(null); // [{year, month}] — all months with transactions, after the current one
  const [selected, setSelected] = useState(new Set());
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getActiveMonths().then((rows) => {
      const currentKey = currentYear * 100 + currentMonth;
      const future = rows
        .map((r) => ({ year: r.year, month: r.month }))
        .filter((m) => m.year * 100 + m.month > currentKey);
      setMonths(future);
    });
  }, [currentYear, currentMonth]);

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const allSelected = months?.length > 0 && selected.size === months.length;
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(months.map((m) => `${m.year}-${m.month}`)));
  }

  async function doCopy() {
    setCopying(true);
    setError(null);
    try {
      const targets = months.filter((m) => selected.has(`${m.year}-${m.month}`));
      const results = await Promise.all(
        targets.map((m) => api.copyBudgets(currentYear, currentMonth, m.year, m.month))
      );
      onDone();
      onClose();
      const totalCopied = results.reduce((s, r) => s + (r.copied || 0), 0);
      alert(`Orçamento copiado para ${targets.length} mês(es) (${totalCopied} categorias no total).`);
    } catch (e) {
      setError(e.message);
    } finally { setCopying(false); }
  }

  return (
    <Modal title="Copiar Orçamento" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-400">
          Copiar o orçamento de <span className="text-white font-medium">{fmt.monthYear(currentYear, currentMonth)}</span> para os meses selecionados:
        </p>

        {months === null && <p className="text-sm text-gray-500 text-center py-4">Carregando meses...</p>}

        {months?.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-4">Nenhum mês com transações depois de {fmt.monthYear(currentYear, currentMonth)}.</p>
        )}

        {months?.length > 0 && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
            </button>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-800 divide-y divide-gray-800">
              {months.map((m) => {
                const key = `${m.year}-${m.month}`;
                const checked = selected.has(key);
                return (
                  <label key={key} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-800/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(key)}
                      className="w-4 h-4 rounded accent-indigo-500"
                    />
                    <span className="text-sm text-gray-200 capitalize">{fmt.monthYear(m.year, m.month)}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-400 text-center">{error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="btn-ghost text-sm">Cancelar</button>
          <button
            onClick={doCopy}
            disabled={copying || selected.size === 0}
            className="btn-primary text-sm disabled:opacity-50"
          >
            {copying ? 'Copiando...' : `Copiar (${selected.size})`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
