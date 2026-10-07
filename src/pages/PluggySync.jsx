import { useState } from 'react';
import { Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../api.js';
import { StepReview, categorizeTransactions, useLogger, LogPanel } from './SmartImport.jsx';

export default function PluggySync() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { logs, log, logRef, reset } = useLogger();

  async function handleSync() {
    setLoading(true);
    setError(null);
    reset();
    try {
      log('🔄', 'Buscando transações novas via Pluggy...');
      const { candidates, skipped } = await api.getPluggyCandidates();
      log('📊', `${candidates.length} transação(ões) nova(s), ${skipped} já existente(s), ignoradas`, skipped > 0 ? '#a5b4fc' : '#6b7280');

      const categorized = await categorizeTransactions(candidates.map((c) => ({ ...c, notes: '' })), log);

      setResult({ transactions: categorized, totalExtracted: candidates.length, skipped });
    } catch (e) {
      log('❌', e.message, '#f87171');
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: '28px 24px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Sparkles size={22} style={{ color: '#818cf8' }} />
          <h1 style={{ color: '#f3f4f6', fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>Smart Import</h1>
        </div>
        <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
          Busca transações novas das contas e cartões conectados via Pluggy (últimos 30 dias) para revisão e importação.
        </p>
      </div>

      {!result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ textAlign: 'center', padding: '40px 20px 20px' }}>
            <button onClick={handleSync} disabled={loading} className="btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, opacity: loading ? 0.6 : 1 }}>
              {loading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={16} />}
              {loading ? 'Sincronizando...' : 'Sincronizar agora'}
            </button>
          </div>

          <LogPanel logs={logs} logRef={logRef} running={loading} />

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <AlertCircle size={16} style={{ color: '#f87171', flexShrink: 0 }} />
              <span style={{ color: '#fca5a5', fontSize: 13 }}>{error}</span>
            </div>
          )}
        </div>
      )}

      {result && <StepReview result={result} onBack={() => setResult(null)} />}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
