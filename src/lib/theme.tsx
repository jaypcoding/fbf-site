// Light / dark theme. The choice is kept in the browser (applied before the
// first paint by public/theme-init.js) and, for signed-in users, in the profile
// (profiles.theme_preference), so it follows the account to other devices.
// Without a saved choice the device preference is used.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { supabase } from './supabase';
import { useAuth } from './auth';

export type Theme = 'light' | 'dark';
const KEY = 'fbf-theme';
const listeners = new Set<() => void>();
// incremented on every choice made by the user: a profile answer that arrives after a
// newer choice must not undo it
let choiceVersion = 0;

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: Theme, remember = true) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#16130f' : '#181818');
  if (remember) {
    try { localStorage.setItem(KEY, theme); } catch { /* storage blocked: the choice lasts for this page */ }
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => 'light' as Theme);
  const { session } = useAuth();
  const setTheme = useCallback((next: Theme) => {
    choiceVersion++;
    applyTheme(next);
    // a supabase-js query is only sent when awaited or then()-ed
    if (session) supabase.rpc('set_my_theme_preference', { p_theme: next }).then(() => {}, () => {});
  }, [session]);
  return { theme, setTheme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') };
}

/** Restores the account's theme on sign-in; saves the browser choice when the account has none. */
export function ThemeSync() {
  const { session } = useAuth();
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const version = choiceVersion;
    supabase.from('profiles').select('theme_preference').eq('id', userId).maybeSingle().then(({ data, error }) => {
      if (!active || error || version !== choiceVersion) return;
      const remote = (data as { theme_preference?: string | null } | null)?.theme_preference;
      if (remote === 'dark' || remote === 'light') {
        if (remote !== currentTheme() || stored() !== remote) applyTheme(remote);
      } else if (stored()) {
        supabase.rpc('set_my_theme_preference', { p_theme: stored() }).then(() => {}, () => {});
      }
    });
    return () => { active = false; };
  }, [userId]);
  // follows the device while the user has not chosen
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => { if (!stored()) applyTheme(mq.matches ? 'dark' : 'light', false); };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return null;
}

export function ThemeToggle({ withLabel = false }: { withLabel?: boolean }) {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const label = dark ? 'Usar tema claro' : 'Usar tema escuro';
  return (
    <button type="button" className={`theme-toggle${withLabel ? ' with-label' : ''}`} onClick={toggle} aria-label={label} title={label} aria-pressed={dark}>
      {dark ? <Sun size={16} /> : <Moon size={16} />}
      {withLabel && <span>{dark ? 'Tema claro' : 'Tema escuro'}</span>}
    </button>
  );
}
