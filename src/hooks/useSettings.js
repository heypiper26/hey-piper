import { useState, useEffect } from 'react';

const KEY = 'budget:settings';
const DEFAULTS = { idleLogout: true, hideValuesOnOpen: false, theme: 'default' };

const listeners = new Set();
let state = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };

function applyTheme(theme) {
  if (theme && theme !== 'default') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}
applyTheme(state.theme);

function setState(next) {
  state = { ...state, ...next };
  localStorage.setItem(KEY, JSON.stringify(state));
  if (next.theme !== undefined) applyTheme(state.theme);
  listeners.forEach((fn) => fn(state));
}

export function useSettings() {
  const [settings, setSettings] = useState(state);

  useEffect(() => {
    listeners.add(setSettings);
    return () => listeners.delete(setSettings);
  }, []);

  return { settings, setSettings: setState };
}
