import { useEffect, useRef } from 'react';

const IDLE_MS = 15 * 60 * 1000; // 15 minutos
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart'];

export function useIdleLogout(active, onIdle) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (!active) return;

    const reset = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(onIdle, IDLE_MS);
    };

    reset();
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, reset));

    return () => {
      clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [active, onIdle]);
}
