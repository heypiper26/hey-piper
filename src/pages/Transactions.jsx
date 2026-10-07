import { useState, useMemo, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, Pencil, Trash2, Search, Check, Loader2, ArrowRight, ArrowRightLeft, AlertCircle, CreditCard, Building2, EyeOff, History, X } from 'lucide-react';
import { useApi } from '../hooks/useApi.js';
import { api } from '../api.js';
import { fmt } from '../utils/format.js';
import Modal from '../components/Modal.jsx';
import { usePeriod } from '../hooks/usePeriod.js';
import { useHideValues, mask } from '../hooks/useHideValues.js';
import { isCard } from '../utils/source.js';

const EMPTY = { date: '', amount: '', type: 'expense', category_id: '', description: '', notes: '', source: '', offsets_category_id: '', is_extraordinary: false, is_transfer: false };

const SOURCE_LABELS = { credit_card: 'Cartão', bank_account: 'Conta', '': '' };
const SOURCE_ICONS = { credit_card: '💳', bank_account: '🏦' };

export default function Transactions() {
  const { hidden } = useHideValues();
  const { year, month, setPeriod } = usePeriod();

  // filters
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');

  // global (all-history) search mode
  const [globalMode, setGlobalMode] = useState(false);
  const [globalRows, setGlobalRows] = useState(null);
  const [globalTotal, setGlobalTotal] = useState(0);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalReloadKey, setGlobalReloadKey] = useState(0);

  // picking a month (here or in the top bar) leaves the all-history search
  useEffect(() => { setGlobalMode(false); }, [year, month]);

  // header magnifier navigates here asking for focus on the search box
  const location = useLocation();
  const searchInputRef = useRef(null);
  useEffect(() => {
    if (location.state?.focusSearch) searchInputRef.current?.focus();
  }, [location.state?.focusSearch]);

  // In global mode the server does the text matching (description + notes, whole
  // history); re-runs debounced as the term changes, and leaves the mode when the
  // term is cleared.
  useEffect(() => {
    if (!globalMode) return;
    if (!search.trim()) { setGlobalMode(false); setGlobalRows(null); return; }
    const timer = setTimeout(async () => {
      setGlobalLoading(true);
      try {
        const res = await api.searchTransactions(search.trim());
        setGlobalRows(res.transactions);
        setGlobalTotal(res.total);
      } catch { /* keep previous results; month mode still works */ }
      finally { setGlobalLoading(false); }
    }, 350);
    return () => clearTimeout(timer);
  }, [globalMode, search, globalReloadKey]);

  // reload month data + (when active) the global search results after a mutation
  function reloadAll() {
    reload();
    if (globalMode) setGlobalReloadKey((k) => k + 1);
  }

  // edit modal
  const [modal, setModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [originalCategoryId, setOriginalCategoryId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // similar-update modal
  const [similarModal, setSimilarModal] = useState(null);
  const [similarSelected, setSimilarSelected] = useState(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);

  const { data: transactions, loading, reload } = useApi(
    () => api.getTransactions({ year, month, include_ignored: 1, limit: 2000 }), [year, month]
  );
  const { data: categories } = useApi(() => api.getCategories(), []);

  const catById = useMemo(
    () => Object.fromEntries((categories || []).map((c) => [String(c.id), c])),
    [categories]
  );

  const filtered = useMemo(() => {
    const base = globalMode ? globalRows : transactions;
    if (!base) return [];
    return base.filter((t) => {
      // in global mode the text match already happened server-side (incl. notes/amount)
      const matchDesc = globalMode || !search
        || t.description.toLowerCase().includes(search.toLowerCase())
        || String(t.amount).includes(search.trim());
      const matchType = !filterType || t.type === filterType;
      const matchCat = !categoryFilter || String(t.category_id) === categoryFilter;
      const matchSource =
        !sourceFilter ||
        (sourceFilter === 'credit_card' ? isCard(t) : !isCard(t));
      return matchDesc && matchType && matchCat && matchSource;
    });
  }, [transactions, globalMode, globalRows, search, filterType, categoryFilter, sourceFilter]);

  // Per-month breakdown for global mode, from the same filtered rows the table
  // shows (so type/category/source filters and ignored-strikethrough stay coherent).
  const byMonth = useMemo(() => {
    if (!globalMode) return null;
    const map = new Map();
    filtered.forEach((t) => {
      if (t.ignored) return;
      const ym = t.date.slice(0, 7);
      const e = map.get(ym) || { ym, income: 0, expense: 0 };
      e[t.type] += Number(t.amount);
      map.set(ym, e);
    });
    return [...map.values()].sort((a, b) => b.ym.localeCompare(a.ym));
  }, [filtered, globalMode]);

  const totals = useMemo(() => ({
    income: filtered.filter((t) => t.type === 'income' && !t.ignored && !t.is_transfer).reduce((s, t) => s + t.amount, 0),
    expense: filtered.filter((t) => t.type === 'expense' && !t.ignored && !t.is_transfer).reduce((s, t) => s + t.amount, 0),
    // Dinheiro que já saiu do caixa mas não é gasto real (ex.: aporte em investimentos)
    // — some ao lado de Receitas/Despesas, não dentro delas.
    transfers: filtered.filter((t) => t.is_transfer && !t.ignored).reduce((s, t) => s + t.amount, 0),
  }), [filtered]);

  const activeFilters = [search, filterType, categoryFilter, sourceFilter].filter(Boolean).length;

  // ── Edit modal ────────────────────────────────────────────────────────────

  function openCreate() {
    setForm({ ...EMPTY, date: new Date().toISOString().split('T')[0] });
    setEditing(null);
    setOriginalCategoryId(null);
    setModal('create');
    setSaveError(null);
  }

  function openEdit(t) {
    setForm({
      date: t.date,
      amount: String(t.amount),
      type: t.type,
      category_id: String(t.category_id || ''),
      description: t.description,
      notes: t.notes || '',
      source: t.source || '',
      offsets_category_id: String(t.offsets_category_id || ''),
      is_extraordinary: !!t.is_extraordinary,
      is_transfer: !!t.is_transfer,
    });
    setEditing(t);
    setOriginalCategoryId(String(t.category_id || ''));
    setModal('edit');
    setSaveError(null);
  }

  async function save() {
    if (!form.date || !form.amount || !form.description) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        ...form,
        amount: Number(form.amount),
        category_id: form.category_id ? Number(form.category_id) : null,
        source: form.source || null,
        offsets_category_id: form.offsets_category_id ? Number(form.offsets_category_id) : null,
      };

      if (editing) {
        const result = await api.updateTransaction(editing.id, payload);
        if (result?.siblings_updated) {
          alert(`Marcado também em outras ${result.siblings_updated} parcela(s) deste plano.`);
        }

        const categoryChanged =
          form.category_id !== originalCategoryId && form.category_id !== '';

        if (categoryChanged) {
          try {
            const { exact, similar } = await api.getSimilarTransactions(
              form.description, editing.id, form.category_id
            );
            if (exact.length > 0 || similar.length > 0) {
              const newCat = catById[form.category_id];
              setSimilarModal({
                description: form.description,
                newCategoryId: Number(form.category_id),
                newCategoryName: newCat?.name || '',
                newCategoryColor: newCat?.color || '#6366f1',
                newCategoryIcon: newCat?.icon || '📦',
                exact,
                similar,
              });
              setSimilarSelected(new Set([...exact, ...similar].map((t) => t.id)));
              setModal(null);
              reloadAll();
              return;
            }
          } catch {
            // similar check failed — main save already succeeded, just close
          }
        }
      } else {
        await api.createTransaction(payload);
      }

      setModal(null);
      reloadAll();
    } catch (e) {
      setSaveError(e.message || 'Erro ao salvar. Verifique se o servidor está rodando.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(t) {
    if (!confirm(`Remover "${t.description}"?`)) return;
    await api.deleteTransaction(t.id);
    reloadAll();
  }

  async function toggleIgnored(t) {
    try {
      await api.toggleIgnored(t.id, !t.ignored);
      reloadAll();
    } catch (e) {
      alert(e.message || 'Erro ao atualizar transação.');
    }
  }

  // ── Similar modal ─────────────────────────────────────────────────────────

  async function applyBulkCategory() {
    if (!similarModal || similarSelected.size === 0) { setSimilarModal(null); return; }
    setBulkSaving(true);
    try {
      await api.bulkUpdateCategory([...similarSelected], similarModal.newCategoryId);
      setSimilarModal(null);
      reloadAll();
    } finally { setBulkSaving(false); }
  }

  function toggleSimilar(id) {
    setSimilarSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllSimilar(items) {
    const ids = items.map((t) => t.id);
    const allOn = ids.every((id) => similarSelected.has(id));
    setSimilarSelected((prev) => {
      const next = new Set(prev);
      if (allOn) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  const catOptions = categories?.filter((c) => !form.type || c.type === form.type) || [];
  const allSimilarItems = similarModal ? [...similarModal.exact, ...similarModal.similar] : [];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">Transações</h1>
          <p className="text-sm text-gray-500">
            {filtered.length} registros
            {activeFilters > 0 && <span className="text-indigo-400 ml-1">· {activeFilters} filtro{activeFilters > 1 ? 's' : ''} ativo{activeFilters > 1 ? 's' : ''}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={openCreate} className="btn-primary flex items-center gap-1.5 text-sm">
            <Plus size={16} /> Nova
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 space-y-3">
        {/* Row 1: search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            ref={searchInputRef}
            className="input pl-8 w-full"
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Search scope: month (default) ↔ whole history */}
        {search.trim() && !globalMode && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">
              {filtered.length} resultado{filtered.length !== 1 ? 's' : ''} em <span className="capitalize">{fmt.monthYear(year, month)}</span>
            </span>
            <button
              onClick={() => setGlobalMode(true)}
              className="flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
            >
              <History size={13} /> Buscar em todo o histórico →
            </button>
          </div>
        )}
        {globalMode && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-indigo-400 flex items-center gap-1.5">
              <History size={13} />
              {globalLoading
                ? 'Buscando em todo o histórico...'
                : `${filtered.length} resultado${filtered.length !== 1 ? 's' : ''} em todo o histórico${globalTotal > (globalRows?.length ?? 0) ? ` (mostrando os ${globalRows.length} mais recentes de ${globalTotal})` : ''}`}
            </span>
            <button
              onClick={() => setGlobalMode(false)}
              className="flex items-center gap-1 text-gray-500 hover:text-gray-300 transition-colors"
            >
              <X size={13} /> Voltar para <span className="capitalize">{fmt.monthYear(year, month)}</span>
            </button>
          </div>
        )}

        {/* Row 2: all filter chips on one line */}
        <div className="flex gap-2 flex-wrap items-center">
          {/* Type */}
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            {[
              { value: '', label: 'Tudo' },
              { value: 'income', label: '↑ Receitas' },
              { value: 'expense', label: '↓ Despesas' },
            ].map(({ value, label }) => (
              <button key={value} onClick={() => setFilterType(value)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  filterType === value
                    ? value === 'income' ? 'bg-emerald-600 text-white'
                      : value === 'expense' ? 'bg-red-600 text-white'
                      : 'bg-indigo-600 text-white'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}>{label}</button>
            ))}
          </div>

          {/* Source */}
          <div className="flex rounded-lg overflow-hidden border border-gray-700">
            {[
              { value: '', label: 'Todas as fontes' },
              { value: 'credit_card', label: '💳 Cartão' },
              { value: 'bank_account', label: '🏦 Conta' },
            ].map(({ value, label }) => (
              <button key={value} onClick={() => setSourceFilter(value)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  sourceFilter === value
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`}>{label}</button>
            ))}
          </div>

          {/* Category */}
          <select className="input text-xs py-1.5 flex-1 min-w-[160px]"
            value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">Todas as categorias</option>
            {(categories || []).map((c) => (
              <option key={c.id} value={String(c.id)}>{c.icon} {c.name}</option>
            ))}
          </select>

          {activeFilters > 0 && (
            <button
              onClick={() => { setSearch(''); setFilterType(''); setCategoryFilter(''); setSourceFilter(''); }}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors whitespace-nowrap"
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className={`grid gap-2 sm:gap-3 text-center ${totals.transfers > 0 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
        <div className="card px-2 sm:px-5 py-3">
          <p className="text-xs text-gray-500 mb-0.5">Receitas</p>
          <p className="text-emerald-400 font-semibold text-sm sm:text-base whitespace-nowrap tabular-nums">{mask(fmt.currency(totals.income), hidden)}</p>
        </div>
        <div className="card px-2 sm:px-5 py-3">
          <p className="text-xs text-gray-500 mb-0.5">Despesas</p>
          <p className="text-red-400 font-semibold text-sm sm:text-base whitespace-nowrap tabular-nums">{mask(fmt.currency(totals.expense), hidden)}</p>
        </div>
        {totals.transfers > 0 && (
          <div className="card px-2 sm:px-5 py-3">
            <p className="text-xs text-gray-500 mb-0.5">Transferências</p>
            <p className="text-sky-400 font-semibold text-sm sm:text-base whitespace-nowrap tabular-nums">{mask(fmt.currency(totals.transfers), hidden)}</p>
          </div>
        )}
        <div className="card px-2 sm:px-5 py-3">
          <p className="text-xs text-gray-500 mb-0.5">Saldo</p>
          <p className={`font-semibold text-sm sm:text-base whitespace-nowrap tabular-nums ${totals.income - totals.expense - totals.transfers >= 0 ? 'text-indigo-400' : 'text-red-400'}`}>
            {mask(fmt.currency(totals.income - totals.expense - totals.transfers), hidden)}
          </p>
        </div>
      </div>

      {/* Global mode: per-month breakdown, clickable */}
      {globalMode && byMonth && byMonth.length > 0 && (
        <GlobalMonthBreakdown
          byMonth={byMonth}
          term={search.trim()}
          hidden={hidden}
          onPick={(ym) => {
            const [y, m] = ym.split('-').map(Number);
            setPeriod(y, m);
            setGlobalMode(false);
          }}
        />
      )}

      {/* Table — keep old data visible while reloading (scroll fix) */}
      <div className="card p-0 overflow-hidden">
        {(loading && !transactions) || (globalMode && !globalRows) ? (
          <p className="p-6 text-sm text-gray-500">{globalMode ? 'Buscando em todo o histórico...' : 'Carregando...'}</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">
            {globalMode ? 'Nenhuma transação encontrada no histórico.' : activeFilters > 0 ? 'Nenhuma transação para os filtros selecionados.' : 'Nenhuma transação encontrada.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left">
                  <th className="px-4 py-3 text-xs text-gray-500 font-medium">Data</th>
                  <th className="px-4 py-3 text-xs text-gray-500 font-medium">Descrição</th>
                  <th className="px-4 py-3 text-xs text-gray-500 font-medium">Categoria</th>
                  <th className="px-4 py-3 text-xs text-gray-500 font-medium">Fonte</th>
                  <th className="px-4 py-3 text-xs text-gray-500 font-medium text-right">Valor</th>
                  <th className="px-4 py-3 text-xs text-gray-500 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {filtered.map((t) => (
                  <tr key={t.id} className={`hover:bg-gray-800/30 transition-colors ${t.ignored ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{fmt.date(t.date)}</td>
                    <td className="px-4 py-3">
                      <p className="text-gray-200 flex items-center gap-1.5">
                        {t.description}
                        {t.is_transfer && (
                          <span
                            title="Transferência: não conta como despesa/receita"
                            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20 flex-shrink-0"
                          >
                            <ArrowRightLeft size={11} strokeWidth={2.5} />
                          </span>
                        )}
                      </p>
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
                    <td className="px-4 py-3">
                      {t.source ? (
                        <span className={`text-xs px-2 py-1 rounded-full ${t.source === 'credit_card' ? 'bg-violet-500/10 text-violet-400' : 'bg-sky-500/10 text-sky-400'}`}>
                          {SOURCE_ICONS[t.source]} {SOURCE_LABELS[t.source]}
                        </span>
                      ) : <span className="text-gray-700 text-xs">-</span>}
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
                        <button onClick={() => openEdit(t)} className="btn-ghost p-1.5"><Pencil size={14} /></button>
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

      {/* Edit modal */}
      {modal && (
        <Modal title={modal === 'edit' ? 'Editar Transação' : 'Nova Transação'} onClose={() => setModal(null)}>
          <TransactionForm
            form={form}
            onChange={setForm}
            categories={catOptions}
            catById={catById}
            onSave={save}
            onCancel={() => setModal(null)}
            saving={saving}
            error={saveError}
          />
        </Modal>
      )}

      {/* Similar-update modal */}
      {similarModal && (
        <Modal title="Atualizar transações similares?" onClose={() => setSimilarModal(null)} size="lg">
          <SimilarUpdateModal
            data={similarModal}
            selected={similarSelected}
            onToggle={toggleSimilar}
            onToggleAll={toggleAllSimilar}
            allItems={allSimilarItems}
            onConfirm={applyBulkCategory}
            onSkip={() => setSimilarModal(null)}
            saving={bulkSaving}
            catById={catById}
          />
        </Modal>
      )}
    </div>
  );
}

// ── GlobalMonthBreakdown ──────────────────────────────────────────────────────

// Per-month spend for the current global search — answers "how much does this
// usually cost per month?" at a glance. Clicking a month jumps to the month view
// with the same search term applied.
function GlobalMonthBreakdown({ byMonth, term, hidden, onPick }) {
  const totalExpense = byMonth.reduce((s, r) => s + r.expense, 0);
  const totalIncome = byMonth.reduce((s, r) => s + r.income, 0);
  const monthsWithExpense = byMonth.filter((r) => r.expense > 0).length;
  const avgExpense = monthsWithExpense > 0 ? totalExpense / monthsWithExpense : 0;
  const maxExpense = Math.max(...byMonth.map((r) => r.expense), 0);

  const monthLabel = (ym) => {
    const [y, m] = ym.split('-');
    const name = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'short' });
    return `${name.replace('.', '')}/${y.slice(2)}`;
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-medium text-gray-300">
          "{term}" por mês
        </h3>
        <p className="text-xs text-gray-500">
          {totalExpense > 0 && (
            <>Total: <span className="text-gray-300 font-medium">{mask(fmt.currency(totalExpense), hidden)}</span>
            {monthsWithExpense > 1 && <> · média <span className="text-gray-300 font-medium">{mask(fmt.currency(avgExpense), hidden)}</span>/mês em {monthsWithExpense} meses</>}</>
          )}
          {totalExpense === 0 && totalIncome > 0 && (
            <>Total recebido: <span className="text-emerald-400 font-medium">{mask(fmt.currency(totalIncome), hidden)}</span></>
          )}
        </p>
      </div>
      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {byMonth.map((r) => {
          const barW = maxExpense > 0 ? (r.expense / maxExpense) * 100 : 0;
          return (
            <button
              key={r.ym}
              onClick={() => onPick(r.ym)}
              title={`Ver ${monthLabel(r.ym)} com este filtro`}
              className="w-full flex items-center gap-3 group text-left hover:bg-gray-800/40 rounded-lg px-2 py-1 transition-colors"
            >
              <span className="text-xs text-gray-400 w-14 flex-shrink-0 capitalize tabular-nums group-hover:text-indigo-300 transition-colors">
                {monthLabel(r.ym)}
              </span>
              <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                {r.expense > 0 && <div className="h-full bg-indigo-500/70 rounded-full" style={{ width: `${barW}%` }} />}
              </div>
              <span className="text-xs text-gray-300 w-24 text-right flex-shrink-0 tabular-nums">
                {r.expense > 0 ? mask(fmt.currency(r.expense), hidden) : ''}
                {r.income > 0 && <span className="text-emerald-400">{r.expense > 0 ? ' ' : ''}+{mask(fmt.currency(r.income), hidden)}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── TransactionForm ───────────────────────────────────────────────────────────

function TransactionForm({ form, onChange, categories, catById, onSave, onCancel, saving, error }) {
  const set = (k, v) => onChange((f) => ({ ...f, [k]: v }));
  const allCategories = catById ? Object.values(catById) : categories || [];
  const expenseCategories = allCategories.filter((c) => c.type === 'expense');
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Tipo</label>
          <select className="input" value={form.type} onChange={(e) => set('type', e.target.value)}>
            <option value="expense">Despesa</option>
            <option value="income">Receita</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Data</label>
          <input type="date" className="input" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-400 mb-1 block">Descrição</label>
        <input className="input" placeholder="Descrição da transação" value={form.description}
          onChange={(e) => set('description', e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Valor (R$)</label>
          <input type="number" step="0.01" min="0" className="input" placeholder="0,00"
            value={form.amount} onChange={(e) => set('amount', e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Categoria</label>
          <select className="input" value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
            <option value="">Sem categoria</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-400 mb-1 block">Fonte</label>
        <select className="input" value={form.source} onChange={(e) => set('source', e.target.value)}>
          <option value="">Não especificada</option>
          <option value="credit_card">💳 Cartão de Crédito</option>
          <option value="bank_account">🏦 Conta Bancária</option>
        </select>
      </div>
      {form.type === 'income' && (
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Desconta da categoria (opcional)</label>
          <select className="input" value={form.offsets_category_id} onChange={(e) => set('offsets_category_id', e.target.value)}>
            <option value="">Não descontar</option>
            {expenseCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="text-xs text-gray-400 mb-1 block">Notas (opcional)</label>
        <textarea className="input resize-none" rows={2} placeholder="Informações adicionais..."
          value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
      {form.type === 'expense' && (
        <label className="flex items-center gap-2.5 rounded-xl border border-gray-700 bg-gray-800/50 px-3 py-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_extraordinary}
            onChange={(e) => set('is_extraordinary', e.target.checked)}
            className="w-4 h-4 rounded accent-indigo-500 flex-shrink-0"
          />
          <div>
            <span className="text-sm text-gray-200">Despesa extraordinária</span>
            <p className="text-xs text-gray-500">Gasto pontual, fora do padrão: não entra no ritmo médio do mês.</p>
          </div>
        </label>
      )}
      <label className="flex items-center gap-2.5 rounded-xl border border-gray-700 bg-gray-800/50 px-3 py-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={form.is_transfer}
          onChange={(e) => set('is_transfer', e.target.checked)}
          className="w-4 h-4 rounded accent-indigo-500 flex-shrink-0"
        />
        <div>
          <span className="text-sm text-gray-200">Transferência</span>
          <p className="text-xs text-gray-500">Sai do saldo, mas não conta como despesa ou receita real (Ex: Aporte em Investimentos).</p>
        </div>
      </label>
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
          <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}
      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onCancel} className="btn-ghost text-sm">Cancelar</button>
        <button onClick={onSave} disabled={saving || !form.date || !form.amount || !form.description}
          className="btn-primary text-sm disabled:opacity-50 flex items-center gap-2">
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}

// ── SimilarUpdateModal ────────────────────────────────────────────────────────

function SimilarUpdateModal({ data, selected, onToggle, onToggleAll, allItems, onConfirm, onSkip, saving, catById }) {
  const { description, newCategoryName, newCategoryColor, newCategoryIcon, exact, similar } = data;
  return (
    <div className="space-y-4">
      <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-sm text-gray-300 space-y-2">
        <p>
          Você alterou a categoria de <span className="font-medium text-white">"{description}"</span> para{' '}
          <span className="font-medium px-1.5 py-0.5 rounded-md text-xs"
            style={{ backgroundColor: `${newCategoryColor}20`, color: newCategoryColor }}>
            {newCategoryIcon} {newCategoryName}
          </span>
        </p>
        <p className="text-gray-400">Selecione as transações similares que devem receber a mesma categoria:</p>
      </div>

      {exact.length > 0 && (
        <SimilarGroup title="Descrição idêntica" badgeColor="indigo" items={exact}
          selected={selected} onToggle={onToggle} onToggleAll={() => onToggleAll(exact)}
          catById={catById} newCategoryColor={newCategoryColor}
          newCategoryIcon={newCategoryIcon} newCategoryName={newCategoryName} />
      )}
      {similar.length > 0 && (
        <SimilarGroup title="Descrição parecida" badgeColor="amber" items={similar}
          selected={selected} onToggle={onToggle} onToggleAll={() => onToggleAll(similar)}
          catById={catById} newCategoryColor={newCategoryColor}
          newCategoryIcon={newCategoryIcon} newCategoryName={newCategoryName} />
      )}

      <div className="flex items-center justify-between pt-1 border-t border-gray-800">
        <span className="text-xs text-gray-500">
          {selected.size} de {allItems.length} selecionada{selected.size !== 1 ? 's' : ''}
        </span>
        <div className="flex gap-2">
          <button onClick={onSkip} className="btn-ghost text-sm">Pular</button>
          <button onClick={onConfirm} disabled={saving}
            className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {saving ? 'Atualizando...' : selected.size > 0 ? `Atualizar ${selected.size}` : 'Confirmar sem atualizar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SimilarGroup({ title, badgeColor, items, selected, onToggle, onToggleAll, catById, newCategoryColor, newCategoryIcon, newCategoryName }) {
  const allChecked = items.every((t) => selected.has(t.id));
  const colors = { indigo: 'bg-indigo-500/20 text-indigo-400', amber: 'bg-amber-500/20 text-amber-400' };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-400">{title}</span>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${colors[badgeColor]}`}>{items.length}</span>
        </div>
        <button onClick={onToggleAll} className="text-xs btn-ghost py-0.5 px-2">
          {allChecked ? 'Desmarcar' : 'Marcar todos'}
        </button>
      </div>
      {items.map((t) => {
        const currentCat = catById[String(t.category_id)];
        const isChecked = selected.has(t.id);
        return (
          <button key={t.id} onClick={() => onToggle(t.id)}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
              isChecked ? 'border-indigo-600/40 bg-indigo-500/5' : 'border-gray-800 bg-gray-800/30 hover:bg-gray-800/60'
            }`}>
            <div className={`w-5 h-5 rounded-md border flex-shrink-0 flex items-center justify-center ${
              isChecked ? 'bg-indigo-600 border-indigo-600' : 'border-gray-600'
            }`}>
              {isChecked && <Check size={12} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-200 truncate">{t.description}</p>
              <p className="text-xs text-gray-500">{fmt.date(t.date)} · {fmt.currency(t.amount)}</p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0 text-xs">
              {currentCat ? (
                <span className="px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: `${currentCat.color}20`, color: currentCat.color }}>
                  {currentCat.icon} {currentCat.name}
                </span>
              ) : <span className="text-gray-600">-</span>}
              {isChecked && (
                <>
                  <ArrowRight size={12} className="text-gray-600" />
                  <span className="px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: `${newCategoryColor}20`, color: newCategoryColor }}>
                    {newCategoryIcon} {newCategoryName}
                  </span>
                </>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
