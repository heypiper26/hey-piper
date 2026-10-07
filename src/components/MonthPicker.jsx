import { useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fmt } from '../utils/format.js';
import { usePeriod } from '../hooks/usePeriod.js';

function shift(year, month, delta) {
  const idx = year * 12 + (month - 1) + delta;
  return [Math.floor(idx / 12), (idx % 12) + 1];
}

function isTyping(el) {
  return el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

// Global month anchor shown in the top bar. ←/→ step months (outside inputs and
// modals); when away from the current month the label turns indigo and clicking
// it jumps back to today.
export default function MonthPicker() {
  const { year, month, setPeriod, isCurrent, resetToCurrent } = usePeriod();
  const prev = () => setPeriod(...shift(year, month, -1));
  const next = () => setPeriod(...shift(year, month, 1));

  useEffect(() => {
    const handler = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isTyping(e.target)) return;
      if (document.querySelector('.fixed.inset-0.z-50')) return; // a Modal is open
      e.preventDefault();
      setPeriod(...shift(year, month, e.key === 'ArrowLeft' ? -1 : 1));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [year, month, setPeriod]);

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <button onClick={prev} className="btn-ghost p-1.5" title="Mês anterior (←)"><ChevronLeft size={16} /></button>
      <button
        onClick={resetToCurrent}
        disabled={isCurrent}
        title={isCurrent ? undefined : 'Voltar para o mês atual'}
        className={`text-sm font-medium capitalize min-w-[110px] sm:min-w-[140px] text-center rounded-lg px-1 py-1 transition-colors ${
          isCurrent ? 'cursor-default' : 'text-indigo-400 hover:bg-indigo-500/10'
        }`}
      >
        {fmt.monthYear(year, month)}
      </button>
      <button onClick={next} className="btn-ghost p-1.5" title="Próximo mês (→)"><ChevronRight size={16} /></button>
    </div>
  );
}
