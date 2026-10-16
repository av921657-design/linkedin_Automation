'use client';

import { useEffect, useId, useState } from 'react';

/* ---------- tiny form controls, all labelled by an htmlFor/id pair ---------- */

export function Num({ label, get, set, step, hint }) {
  const id = useId();
  const external = get();
  const [v, setV] = useState(() => String(external ?? ''));
  const [seen, setSeen] = useState(external);
  // Rows are keyed by position, so removing one hands this instance a
  // different record. Adopt outside changes, but never mid-keystroke — the
  // local string is what lets the field hold "" or "1." while typing.
  if (external !== seen) {
    setSeen(external);
    const editing = typeof document !== 'undefined' && document.activeElement?.id === id;
    if (!editing) setV(String(external ?? ''));
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        step={step ?? 1}
        value={v}
        onChange={(e) => {
          setV(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n)) set(n);
        }}
        onBlur={() => setV(String(get() ?? ''))}
      />
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function Txt({ label, get, set, mono, placeholder, hint }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        className={mono ? 'mono' : ''}
        placeholder={placeholder}
        value={get() ?? ''}
        onChange={(e) => set(e.target.value)}
      />
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

/** Text input with free-model suggestions (still accepts any id you type). */
export function TxtList({ label, get, set, options }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" className="mono" list={`${id}-list`} value={get() ?? ''} onChange={(e) => set(e.target.value)} />
      <datalist id={`${id}-list`}>{(options ?? []).map((o) => <option key={o} value={o} />)}</datalist>
    </div>
  );
}

export function Check({ label, get, set }) {
  const id = useId();
  return (
    <label className="check" htmlFor={id}>
      <input id={id} type="checkbox" checked={Boolean(get())} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );
}

/** Dropdown for closed-set fields (rewrite.mode, pickStrategy, commentMode). */
export function Select({ label, get, set, options }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={get()} onChange={(e) => set(e.target.value)}>
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
    </div>
  );
}

/* ---------- dark / light theme switch ---------- */

export function useTheme() {
  const [theme, setTheme] = useState('dark');
  // Adopt the palette the pre-paint bootstrap script already set on <html>. Server +
  // client both render at "dark" first (no hydration mismatch); the visible palette
  // already follows the attribute via CSS, so only the icon settles here — and we never
  // write, so there is no dark→correct flash.
  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  }, []);
  // Side effects live in the handler (not a setState updater) so React's dev-mode
  // double-invoke can never apply them twice.
  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('cadence-theme', next); } catch { /* private mode */ }
  };
  return { theme, toggle };
}

// Sun for light mode, moon for dark — the icon shows the theme you'd switch TO.
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const to = theme === 'light' ? 'Switch to dark' : 'Switch to light';
  return (
    <button type="button" className="theme-toggle" onClick={toggle} title={to} aria-label={to}>
      {theme === 'light' ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
        </svg>
      )}
    </button>
  );
}
