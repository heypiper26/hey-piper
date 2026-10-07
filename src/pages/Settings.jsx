import { useState } from 'react';
import { useSettings } from '../hooks/useSettings.js';
import { api } from '../api.js';
import Switch from '../components/Switch.jsx';

export default function Settings() {
  const { settings, setSettings } = useSettings();
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwStatus, setPwStatus] = useState(null); // { type: 'error' | 'success', message }
  const [saving, setSaving] = useState(false);

  async function changePassword(e) {
    e.preventDefault();
    setPwStatus(null);
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwStatus({ type: 'error', message: 'A confirmação não bate com a nova senha' });
      return;
    }
    setSaving(true);
    try {
      await api.changePassword(pwForm.currentPassword, pwForm.newPassword);
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPwStatus({ type: 'success', message: 'Senha alterada com sucesso' });
    } catch (err) {
      setPwStatus({ type: 'error', message: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-white tracking-tight">Configurações</h1>

      <div className="card divide-y divide-gray-800">
        <div className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
          <div>
            <p className="text-sm text-gray-200">Deslogar por inatividade após 15 minutos</p>
            <p className="text-xs text-gray-500 mt-0.5">Encerra a sessão automaticamente se o app ficar parado.</p>
          </div>
          <Switch
            checked={settings.idleLogout}
            onChange={(v) => setSettings({ idleLogout: v })}
          />
        </div>

        <div className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
          <div>
            <p className="text-sm text-gray-200">Ocultar valores por padrão ao abrir</p>
            <p className="text-xs text-gray-500 mt-0.5">Ao entrar no app, os valores já começam ocultados.</p>
          </div>
          <Switch
            checked={settings.hideValuesOnOpen}
            onChange={(v) => setSettings({ hideValuesOnOpen: v })}
          />
        </div>
      </div>

      <div className="card space-y-3">
        <div>
          <p className="text-sm text-gray-200">Tema</p>
          <p className="text-xs text-gray-500 mt-0.5">Escolha o esquema de cores da interface.</p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setSettings({ theme: 'default' })}
            className="flex-1 rounded-xl border p-3 text-left transition-colors"
            style={
              settings.theme === 'default' || !settings.theme
                ? { borderColor: 'rgb(99 102 241)', boxShadow: '0 0 0 1px rgb(99 102 241)' }
                : { borderColor: 'rgb(55 65 81)' }
            }
          >
            <div className="flex gap-1 mb-2">
              <span className="w-4 h-4 rounded-full" style={{ backgroundColor: 'rgb(3 7 18)', border: '1px solid rgb(31 41 55)' }} />
              <span className="w-4 h-4 rounded-full" style={{ backgroundColor: 'rgb(17 24 39)', border: '1px solid rgb(31 41 55)' }} />
              <span className="w-4 h-4 rounded-full" style={{ backgroundColor: 'rgb(79 70 229)' }} />
            </div>
            <p className="text-sm" style={{ color: 'rgb(229 231 235)' }}>Padrão</p>
          </button>
          <button
            type="button"
            onClick={() => setSettings({ theme: 'minimal' })}
            className={`flex-1 rounded-xl border p-3 text-left transition-colors ${
              settings.theme === 'minimal'
                ? 'border-indigo-500 ring-1 ring-indigo-500'
                : 'border-gray-700 hover:border-gray-600'
            }`}
          >
            <div className="flex gap-1 mb-2">
              <span className="w-4 h-4 rounded-full" style={{ backgroundColor: 'rgb(13 13 13)', border: '1px solid rgb(48 48 48)' }} />
              <span className="w-4 h-4 rounded-full" style={{ backgroundColor: 'rgb(22 22 22)', border: '1px solid rgb(48 48 48)' }} />
              <span className="w-4 h-4 rounded-full" style={{ backgroundColor: 'rgb(205 205 205)' }} />
            </div>
            <p className="text-sm text-gray-200">Neutral</p>
          </button>
          <button
            type="button"
            onClick={() => setSettings({ theme: 'light' })}
            className={`flex-1 rounded-xl border p-3 text-left transition-colors ${
              settings.theme === 'light'
                ? 'border-indigo-500 ring-1 ring-indigo-500'
                : 'border-gray-700 hover:border-gray-600'
            }`}
          >
            <div className="flex gap-1 mb-2">
              <span className="w-4 h-4 rounded-full" style={{ backgroundColor: 'rgb(255 255 255)', border: '1px solid rgb(209 213 219)' }} />
              <span className="w-4 h-4 rounded-full" style={{ backgroundColor: 'rgb(249 250 251)', border: '1px solid rgb(209 213 219)' }} />
              <span className="w-4 h-4 rounded-full" style={{ backgroundColor: 'rgb(79 70 229)' }} />
            </div>
            <p className="text-sm text-gray-200">Claro</p>
          </button>
        </div>
      </div>

      <div className="card space-y-4">
        <div>
          <p className="text-sm text-gray-200">Alterar senha de acesso</p>
          <p className="text-xs text-gray-500 mt-0.5">Troca a senha usada para entrar no app.</p>
        </div>

        <form onSubmit={changePassword} className="space-y-3">
          <input
            type="password"
            placeholder="Senha atual"
            value={pwForm.currentPassword}
            onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
            className="input w-full"
            autoComplete="current-password"
            required
          />
          <input
            type="password"
            placeholder="Nova senha"
            value={pwForm.newPassword}
            onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
            className="input w-full"
            autoComplete="new-password"
            minLength={6}
            required
          />
          <input
            type="password"
            placeholder="Confirmar nova senha"
            value={pwForm.confirmPassword}
            onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })}
            className="input w-full"
            autoComplete="new-password"
            minLength={6}
            required
          />

          {pwStatus && (
            <p className={`text-xs ${pwStatus.type === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>
              {pwStatus.message}
            </p>
          )}

          <button type="submit" className="btn-primary text-sm" disabled={saving}>
            {saving ? 'Salvando...' : 'Alterar senha'}
          </button>
        </form>
      </div>
    </div>
  );
}
