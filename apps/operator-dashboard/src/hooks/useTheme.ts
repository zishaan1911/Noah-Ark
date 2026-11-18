import { useCallback, useEffect, useState } from 'react';
import type { Theme } from '../lib/types';

const KEY = 'ark-theme';

function load(): Theme {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Light by default; remembered in localStorage and mirrored to `<html data-theme>`. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(load);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // Private mode: the theme just lasts for this visit.
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return [theme, toggle];
}
