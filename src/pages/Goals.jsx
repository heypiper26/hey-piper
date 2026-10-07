import { useState } from 'react';
import { Plus, Pencil, Trash2, Target } from 'lucide-react';
import { useApi } from '../hooks/useApi.js';
import { api } from '../api.js';
import { fmt } from '../utils/format.js';
import Modal from '../components/Modal.jsx';
import { useHideValues, mask } from '../hooks/useHideValues.js';

const COLORS = ['#10b981','#6366f1','#f97316','#ec4899','#06b6d4','#eab308','#8b5cf6'];
const ICONS = ['🎯','🏠','✈️','🚗','💍','🎓','📱','💻','🏋️','🌎','💰','🏖️'];
const EMPTY = { name: '', target_amount: '', current_amount: '', deadline: '', color: '#10b981', icon: '🎯' };

export default function Goals() {
  const { data: goals, loading, reload } = useApi(() => api.getGoals(), []);
  const { hidden } = useHideValues();
  const [modal, setModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  function openCreate() { setForm(EMPTY); setEditing(null); setModal(true); }
  function openEdit(g) {
    setForm({ name: g.name, target_amount: String(g.target_amount), current_amount: String(g.current_amount), deadline: g.deadline || '', color: g.color, icon: g.icon });
    setEditing(g);
    setModal(true);
  }

  async function save() {
    if (!form.name || !form.target_amount) return;
    setSaving(true);
    try {
      const payload = { ...form, target_amount: Number(form.target_amount), current_amount: Number(form.current_amount || 0) };
      if (editing) await api.updateGoal(editing.id, payload);
      else await api.createGoal(payload);
      setModal(null);
      reload();
    } finally { setSaving(false); }
  }

  async function remove(g) {
    if (!confirm(`Remover meta "${g.name}"?`)) return;
    await api.deleteGoal(g.id);
    reload();
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white tracking-tight">Metas de Economia</h1>
        <button onClick={openCreate} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus size={16} /> Nova Meta
        </button>
      </div>

      {loading ? <p className="text-sm text-gray-500">Carregando...</p> : goals?.length === 0 ? (
        <div className="card text-center py-12">
          <Target size={40} className="mx-auto text-gray-700 mb-3" />
          <p className="text-gray-500 text-sm">Nenhuma meta criada ainda.</p>
          <button onClick={openCreate} className="btn-primary mt-4 text-sm">Criar primeira meta</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {goals?.map((g) => <GoalCard key={g.id} goal={g} onEdit={openEdit} onDelete={remove} hidden={hidden} />)}
        </div>
      )}

      {modal && (
        <Modal title={editing ? 'Editar Meta' : 'Nova Meta'} onClose={() => setModal(null)}>
          <GoalForm form={form} onChange={setForm} onSave={save} onCancel={() => setModal(null)} saving={saving} />
        </Modal>
      )}
    </div>
  );
}

function GoalCard({ goal, onEdit, onDelete, hidden }) {
  const pct = Math.min(goal.current_amount / goal.target_amount, 1);
  const remaining = goal.target_amount - goal.current_amount;
  const done = goal.current_amount >= goal.target_amount;

  const daysLeft = goal.deadline ? Math.ceil((new Date(goal.deadline + 'T12:00:00') - new Date()) / 86400000) : null;

  return (
    <div className="card relative overflow-hidden">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0" style={{ backgroundColor: `${goal.color}20` }}>
            {goal.icon}
          </div>
          <div>
            <h3 className="font-medium text-white">{goal.name}</h3>
            {goal.deadline && (
              <p className={`text-xs ${daysLeft !== null && daysLeft < 30 ? 'text-amber-400' : 'text-gray-500'}`}>
                {daysLeft !== null && daysLeft > 0 ? `${daysLeft} dias restantes` : daysLeft === 0 ? 'Hoje!' : done ? '✓ Concluída' : 'Prazo encerrado'}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={() => onEdit(goal)} className="btn-ghost p-1.5"><Pencil size={13} /></button>
          <button onClick={() => onDelete(goal)} className="btn-ghost p-1.5 text-red-500 hover:text-red-400"><Trash2 size={13} /></button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">{mask(fmt.currency(goal.current_amount), hidden)}</span>
          <span className="text-gray-500">{mask(fmt.currency(goal.target_amount), hidden)}</span>
        </div>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct * 100}%`, backgroundColor: done ? '#10b981' : goal.color }} />
        </div>
        <div className="flex justify-between text-xs">
          <span className="font-semibold" style={{ color: goal.color }}>{(pct * 100).toFixed(1)}%</span>
          {!done && <span className="text-gray-500">Faltam {mask(fmt.currency(remaining), hidden)}</span>}
          {done && <span className="text-emerald-400 font-medium">✓ Concluída!</span>}
        </div>
      </div>
    </div>
  );
}

function GoalForm({ form, onChange, onSave, onCancel, saving }) {
  const set = (k, v) => onChange((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-gray-400 mb-1 block">Nome da Meta</label>
        <input className="input" placeholder="Ex: Viagem para Europa" value={form.name} onChange={(e) => set('name', e.target.value)} />
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Valor Alvo (R$)</label>
          <input type="number" step="0.01" min="0" className="input" placeholder="Ex: 10000" value={form.target_amount} onChange={(e) => set('target_amount', e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Valor Atual (R$)</label>
          <input type="number" step="0.01" min="0" className="input" placeholder="0" value={form.current_amount} onChange={(e) => set('current_amount', e.target.value)} />
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-400 mb-1 block">Prazo (opcional)</label>
        <input type="date" className="input" value={form.deadline} onChange={(e) => set('deadline', e.target.value)} />
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onCancel} className="btn-ghost text-sm">Cancelar</button>
        <button onClick={onSave} disabled={saving || !form.name || !form.target_amount} className="btn-primary text-sm disabled:opacity-50">
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}
