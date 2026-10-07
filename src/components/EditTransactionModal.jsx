import { useState, useEffect } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import Modal from './Modal.jsx';
import { api } from '../api.js';

export default function EditTransactionModal({ transaction, onClose, onSaved }) {
  const [form, setForm] = useState({
    date: transaction.date,
    amount: String(transaction.amount),
    type: transaction.type,
    category_id: String(transaction.category_id || ''),
    description: transaction.description,
    notes: transaction.notes || '',
    source: transaction.source || '',
    offsets_category_id: String(transaction.offsets_category_id || ''),
    is_extraordinary: !!transaction.is_extraordinary,
    is_transfer: !!transaction.is_transfer,
  });
  const [categories, setCategories] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api.getCategories().then((cats) => setCategories(Array.isArray(cats) ? cats : [])).catch(() => {});
  }, []);

  async function save() {
    if (!form.date || !form.amount || !form.description) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.updateTransaction(transaction.id, {
        ...form,
        amount: Number(form.amount),
        category_id: form.category_id ? Number(form.category_id) : null,
        source: form.source || null,
        offsets_category_id: form.offsets_category_id ? Number(form.offsets_category_id) : null,
      });
      onSaved();
      onClose();
      if (result?.siblings_updated) {
        alert(`Marcado também em outras ${result.siblings_updated} parcela(s) deste plano.`);
      }
    } catch (e) {
      setError(e.message || 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  }

  const catOptions = categories.filter((c) => c.type === form.type);
  const expenseCategories = categories.filter((c) => c.type === 'expense');

  return (
    <Modal title="Editar Transação" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Tipo</label>
            <select className="input" value={form.type} onChange={(e) => { set('type', e.target.value); set('category_id', ''); }}>
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
          <input className="input" value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Valor (R$)</label>
            <input type="number" step="0.01" min="0" className="input" value={form.amount}
              onChange={(e) => set('amount', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Categoria</label>
            <select className="input" value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
              <option value="">Sem categoria</option>
              {catOptions.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
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
          <label className="text-xs text-gray-400 mb-1 block">Notas</label>
          <input className="input" placeholder="Observações..." value={form.notes}
            onChange={(e) => set('notes', e.target.value)} />
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
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertCircle size={14} className="flex-shrink-0" />{error}
          </div>
        )}
        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="btn-ghost text-sm">Cancelar</button>
          <button onClick={save} disabled={saving || !form.date || !form.amount || !form.description}
            className="btn-primary text-sm disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
