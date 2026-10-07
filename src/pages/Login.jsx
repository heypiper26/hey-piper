import { useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { api } from '../api.js';

export default function Login({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(err.message || 'Erro ao entrar');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gray-950">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-2xl p-8 space-y-4">
        <div className="flex items-center justify-center mb-2">
          <span className="text-[17px] tracking-tight" style={{ fontWeight: 650 }}>
            <span className="text-gray-500">hey</span><span className="text-white">piper</span>
          </span>
        </div>
        <div>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 pr-16 rounded-xl bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-600"
            />
            <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 pr-2">
              {password && (
                <button
                  type="button"
                  onClick={() => setPassword('')}
                  tabIndex={-1}
                  className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"
                  aria-label="Limpar senha"
                >
                  <X size={16} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                className="p-1.5 text-gray-500 hover:text-gray-300 transition-colors"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
