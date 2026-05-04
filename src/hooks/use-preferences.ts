'use client';

import { useState, useEffect, useCallback } from 'react';

export type EmailOpenMode = 'fullscreen' | 'side-pane';
export type AfterDoneAction = 'next' | 'previous' | 'list';

interface Preferences {
  emailOpenMode: EmailOpenMode;
  afterDone: AfterDoneAction;
}

const STORAGE_KEY = 'cleave:preferences';

const defaults: Preferences = {
  emailOpenMode: 'fullscreen',
  afterDone: 'next',
};

function load(): Preferences {
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

function save(prefs: Preferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

export function usePreferences() {
  const [prefs, setPrefs] = useState<Preferences>(defaults);

  useEffect(() => {
    setPrefs(load());
  }, []);

  const update = useCallback((patch: Partial<Preferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);

  return { prefs, update };
}
