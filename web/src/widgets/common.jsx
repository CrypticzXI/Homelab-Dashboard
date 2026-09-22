import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Icon } from '../lib/icons.jsx';

/**
 * Map of widget id -> JSON of {type, config} as last saved on the server.
 * Lets widgets tell whether their current config actually exists server-side
 * yet (a freshly added or re-configured widget can't be fetched until Save).
 */
export const SavedWidgetsContext = createContext(new Map());

/** Set by the widget body, read by the card header: { ok, error, at, ms?, up? }. */
export const CardStatusContext = createContext(() => {});

export function useIsSaved(widget) {
  const saved = useContext(SavedWidgetsContext);
  return saved.get(widget.id) === JSON.stringify({ type: widget.type, config: widget.config || {} });
}

/** Poll `/api/widgets/:id/data`. Pauses while the tab is hidden. */
export function useWidgetData(widget, pollMs, enabled = true) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const timer = useRef();
  const setStatus = useContext(CardStatusContext);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = async () => {
      if (document.hidden) return schedule();
      try {
        const r = await api.widgetData(widget.id);
        if (!alive) return;
        setState(r.ok ? { loading: false, data: r.data, error: null } : (s) => ({ loading: false, data: s.data, error: r.error }));
        setStatus({ ok: r.ok, error: r.ok ? null : r.error, at: Date.now(), data: r.ok ? r.data : null });
      } catch (e) {
        if (alive) {
          setState((s) => ({ loading: false, data: s.data, error: e.message }));
          setStatus({ ok: false, error: e.message, at: Date.now() });
        }
      }
      schedule();
    };
    const schedule = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(tick, pollMs);
    };
    tick();
    const onVis = () => !document.hidden && tick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVis);
    };
    // re-run when the config changes (after save) — widget.config is replaced wholesale
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget.id, JSON.stringify(widget.config), pollMs, enabled]);
  return state;
}

export function Skeleton({ rows = 3 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - i * 18}%` }} />
      ))}
    </div>
  );
}

export function ErrorLine({ error }) {
  return (
    <div className="err">
      <Icon name="warn" size={16} />
      <span>{error}</span>
    </div>
  );
}

export function Stat({ value, label, tone, small }) {
  return (
    <div className={`stat ${tone || ''}`}>
      <b className={small ? 'sm' : ''}>{value}</b>
      <span>{label}</span>
    </div>
  );
}

export function Meter({ label, value, pct, tone }) {
  const t = tone || (pct > 90 ? 'bad' : pct > 75 ? 'warn' : '');
  return (
    <div className="meter">
      <div className="row">
        <span>{label}</span>
        <b>{value}</b>
      </div>
      <div className={`bar ${t}`}>
        <i style={{ width: `${Math.min(100, Math.max(0, pct || 0))}%` }} />
      </div>
    </div>
  );
}

export function ProgressRow({ name, sub, right, pct, tone }) {
  return (
    <div className="progress-row">
      <div className="top">
        <span className="name" title={name}>
          {name}
          {sub ? <span style={{ color: 'var(--dim)' }}> · {sub}</span> : null}
        </span>
        <span className="val">{right}</span>
      </div>
      <div className={`bar thin ${tone || ''}`}>
        <i style={{ width: `${Math.min(100, Math.max(0, pct || 0))}%` }} />
      </div>
    </div>
  );
}

/** Wraps a data-driven widget: handles loading / error states uniformly. */
export function DataWidget({ widget, poll, children }) {
  const isSaved = useIsSaved(widget);
  const { loading, data, error } = useWidgetData(widget, poll, isSaved);
  if (!isSaved) return <div className="empty">Save the dashboard to load live data.</div>;
  if (loading && !data) return <Skeleton />;
  if (error && !data) return <ErrorLine error={error} />;
  return (
    <>
      {children(data)}
      {error ? <div className="warn-line">Last refresh failed: {error}</div> : null}
    </>
  );
}
