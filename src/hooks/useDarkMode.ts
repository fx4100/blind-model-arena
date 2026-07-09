import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'bm_darkmode';

function getInitial(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === 'true';
  } catch {
    // localStorage unavailable
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyClass(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
}

export function useDarkMode(): [boolean, () => void] {
  const [dark, setDark] = useState(getInitial);

  // Apply on mount and when dark changes
  useEffect(() => {
    applyClass(dark);
  }, [dark]);

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return [dark, toggle];
}