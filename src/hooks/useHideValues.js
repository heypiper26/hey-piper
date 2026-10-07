import { useState, useEffect } from 'react';

const KEY = 'budget:hideValues';
const listeners = new Set();
let hiddenState = localStorage.getItem(KEY) === 'true';

function setHiddenState(next) {
  hiddenState = next;
  localStorage.setItem(KEY, String(next));
  listeners.forEach((fn) => fn(hiddenState));
}

export function useHideValues() {
  const [hidden, setHidden] = useState(hiddenState);

  useEffect(() => {
    listeners.add(setHidden);
    return () => listeners.delete(setHidden);
  }, []);

  function toggle() {
    setHiddenState(!hiddenState);
  }

  return { hidden, toggle, setHidden: setHiddenState };
}

// Returns "••••" when hidden, otherwise the original value
export function mask(value, hidden) {
  return hidden ? '••••' : value;
}
