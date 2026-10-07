import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

// The selected month is a global anchor shared by every month-based page. It lives
// in the URL (?m=YYYY-MM) so it survives refresh/back and carries across the nav;
// no param means "current month".
export const PERIOD_PARAM = 'm';
export const PERIOD_ROUTES = ['/', '/transactions', '/budget', '/cartao-credito', '/analysis'];

export function parsePeriod(raw) {
  const match = /^(\d{4})-(\d{2})$/.exec(raw || '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function usePeriod() {
  const [params, setParams] = useSearchParams();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const parsed = parsePeriod(params.get(PERIOD_PARAM));
  const year = parsed?.year ?? currentYear;
  const month = parsed?.month ?? currentMonth;

  const setPeriod = useCallback((y, m) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      const t = new Date();
      if (y === t.getFullYear() && m === t.getMonth() + 1) next.delete(PERIOD_PARAM);
      else next.set(PERIOD_PARAM, `${y}-${String(m).padStart(2, '0')}`);
      return next;
    }, { replace: true }); // replace: Back shouldn't step through every month browsed
  }, [setParams]);

  return {
    year,
    month,
    setPeriod,
    isCurrent: year === currentYear && month === currentMonth,
    resetToCurrent: () => setPeriod(currentYear, currentMonth),
  };
}
