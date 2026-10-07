import { useState, useMemo } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useApi } from '../hooks/useApi.js';
import { api } from '../api.js';
import { fmt } from '../utils/format.js';
import Modal from '../components/Modal.jsx';

const COLORS = ['#6366f1','#10b981','#ef4444','#f97316','#eab308','#ec4899','#06b6d4','#8b5cf6','#14b8a6','#f43f5e','#a855f7','#64748b'];
const ICONS = ['💰','💼','💻','🏠','🍽️','🚗','🏥','📚','🎮','👕','📱','📦','✈️','🎯','🛒','💊','🏋️','🎵','🍺','☕'];
const EMPTY = { name: '', type: 'expense', color: '#6366f1', icon: '📦', offsets_category_id: '', offset_description_filter: '' };

export default function Categories() {
  const { data: categories, loading, reload } = useApi(() => api.getCategories(), []);
  const [modal, setModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const catById = useMemo(
    () => Object.fromEntries((categories || []).map((c) => [c.id, c])),
    [categories]
  );
  const expenseCategories = useMemo(
    () => (categories || []).filter((c) => c.type === 'expense'),
    [categories]
  );

  function openCreate() {
    setForm(EMPTY);
    setEditing(null);
    setModal(true);
  }

  function openEdit(c) {
    setForm({
      name: c.name,
      type: c.type,
      color: c.color,
      icon: c.icon,
      offsets_category_id: c.offsets_category_id ?? '',
      offset_description_filter: c.offset_description_filter ?? '',
    });
    setEditing(c);
    setModal(true);
  }

  async function save() {
    if (!form.name) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        budget_limit: null,
        offsets_category_id: form.offsets_category_id ? Number(form.offsets_category_id) : null,
        offset_description_filter: form.offset_description_filter?.trim() || null,
      };
      if (editing) await api.updateCategory(editing.id, payload);
      else await api.createCategory(payload);
      setModal(null);
      reload();
    } finally { setSaving(false); }
  }

  async function remove(c) {
    if (!confirm(`Remover categoria "${c.name}"?\nAs transações associadas ficarão sem categoria.`)) return;
    await api.deleteCategory(c.id);
    reload();
  }

  const income = categories?.filter((c) => c.type === 'income') || [];
  const expense = categories?.filter((c) => c.type === 'expense') || [];

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white tracking-tight">Categorias</h1>
        <button onClick={openCreate} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus size={16} /> Nova Categoria
        </button>
      </div>

      {loading ? <p className="text-gray-500 text-sm">Carregando...</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <CategoryGroup title="Receitas" items={income} catById={catById} onEdit={openEdit} onDelete={remove} />
          <CategoryGroup title="Despesas" items={expense} catById={catById} onEdit={openEdit} onDelete={remove} />
        </div>
      )}

      {modal && (
        <Modal title={editing ? 'Editar Categoria' : 'Nova Categoria'} onClose={() => setModal(null)}>
          <CategoryForm
            form={form}
            onChange={setForm}
            expenseCategories={expenseCategories}
            onSave={save}
            onCancel={() => setModal(null)}
            saving={saving}
          />
        </Modal>
      )}
    </div>
  );
}

function CategoryGroup({ title, items, catById, onEdit, onDelete }) {
  return (
    <div className="card space-y-1">
      <h3 className="text-sm font-medium text-gray-400 mb-3">{title} ({items.length})</h3>
      {items.length === 0 && <p className="text-sm text-gray-600">Nenhuma categoria.</p>}
      {items.map((c) => (
        <div key={c.id} className="flex items-center gap-3 py-2 px-2 rounded-xl hover:bg-gray-800/50 group">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base flex-shrink-0" style={{ backgroundColor: `${c.color}20` }}>
            {c.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-200">{c.name}</p>
            {c.offsets_category_id && catById[c.offsets_category_id] && (
              <p className="text-xs text-teal-500/80">
                ↩ desconta: {catById[c.offsets_category_id].icon} {catById[c.offsets_category_id].name}
              </p>
            )}
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onEdit(c)} className="btn-ghost p-1.5"><Pencil size={13} /></button>
            <button onClick={() => onDelete(c)} className="btn-ghost p-1.5 text-red-500 hover:text-red-400"><Trash2 size={13} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

function CategoryForm({ form, onChange, expenseCategories, onSave, onCancel, saving }) {
  const set = (k, v) => onChange((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Nome</label>
          <input className="input" placeholder="Ex: Alimentação" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Tipo</label>
          <select className="input" value={form.type} onChange={(e) => set('type', e.target.value)}>
            <option value="expense">Despesa</option>
            <option value="income">Receita</option>
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-400 mb-1 block">Ícone</label>
        <div className="flex flex-wrap gap-2">
          {ICONS.map((ic) => (
            <button key={ic} onClick={() => set('icon', ic)}
              className={`text-xl p-1.5 rounded-lg transition-colors ${form.icon === ic ? 'bg-indigo-600/30 ring-1 ring-indigo-500' : 'hover:bg-gray-800'}`}>
              {ic}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-400 mb-1 block">Cor</label>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button key={c} onClick={() => set('color', c)}
              style={{ backgroundColor: c }}
              className={`w-7 h-7 rounded-full transition-transform ${form.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-900 scale-110' : ''}`}
            />
          ))}
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onCancel} className="btn-ghost text-sm">Cancelar</button>
        <button onClick={onSave} disabled={saving || !form.name} className="btn-primary text-sm disabled:opacity-50">
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}
