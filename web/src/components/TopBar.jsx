import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Icon } from '../lib/icons.jsx';
import { bytes, duration } from '../lib/format.js';

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="clock">
      <b>{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</b>
      <span>{now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
    </div>
  );
}

function Spark({ values, max = 100 }) {
  if (values.length < 2) return <svg className="spark" viewBox="0 0 60 22" preserveAspectRatio="none" />;
  const w = 60, h = 22;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 1 - (Math.min(v, max) / max) * (h - 2)).toFixed(1)}`);
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={pts.join(' ')} />
    </svg>
  );
}

/** Compact host stats: CPU (with sparkline), RAM, first disk, uptime. */
function HostStats() {
  const [d, setD] = useState(null);
  const hist = useRef([]);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await api.system();
        if (!alive) return;
        if (r.ok) {
          hist.current = [...hist.current.slice(-29), r.data.cpu];
          setD(r.data);
        }
      } catch {
        /* keep last */
      }
    };
    tick();
    const t = setInterval(() => !document.hidden && tick(), 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!d) return null;
  const disk = d.disks?.find((x) => !x.error);
  const memPct = (d.mem.used / d.mem.total) * 100;
  return (
    <div className="hoststats">
      <div className="hs" title={`Load ${d.load.join(' / ')} · ${d.cores} cores`}>
        <Spark values={hist.current} />
        <div>
          <b>{d.cpu}%</b>
          <span>CPU</span>
        </div>
      </div>
      <div className="hs" title={`${bytes(d.mem.used)} of ${bytes(d.mem.total, 0)}`}>
        <div className="ring" style={{ '--p': memPct }} />
        <div>
          <b>{bytes(d.mem.used, 1)}</b>
          <span>RAM</span>
        </div>
      </div>
      {disk ? (
        <div className="hs" title={`${disk.path}: ${bytes(disk.used, 0)} of ${bytes(disk.total, 0)}`}>
          <div className="ring" style={{ '--p': (disk.used / disk.total) * 100 }} />
          <div>
            <b>{bytes(disk.free, 0)}</b>
            <span>free</span>
          </div>
        </div>
      ) : null}
      <div className="hs">
        <div>
          <b>{duration(d.uptime)}</b>
          <span>{d.hostname}</span>
        </div>
      </div>
    </div>
  );
}

export default function TopBar({ config, query, onQuery, onEnter, editing, onEdit, onLogout }) {
  const inputRef = useRef();
  useEffect(() => {
    const h = (e) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        onQuery('');
        inputRef.current.blur();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onQuery]);

  return (
    <header className="topbar">
      <div className="brand">
        <div className="monogram">{(config.title || 'H').trim().charAt(0).toUpperCase()}</div>
        <div>
          <h1>{config.title || 'Homelab'}</h1>
          {config.subtitle ? <p className="sub">{config.subtitle}</p> : null}
        </div>
      </div>
      {config.topbar?.showSystem !== false ? <HostStats /> : null}
      <div className="search">
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          value={query}
          placeholder="Search services…"
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onEnter()}
        />
        {query ? (
          <button className="clear" onClick={() => onQuery('')} title="Clear">
            <Icon name="x" size={14} />
          </button>
        ) : (
          <kbd>/</kbd>
        )}
      </div>
      <Clock />
      <div className="header-actions">
        {!editing ? (
          <button className="btn desktop-only" onClick={onEdit} title="Edit dashboard">
            <Icon name="edit" size={15} /> Edit
          </button>
        ) : null}
        <button className="btn icon ghost" onClick={onLogout} title="Sign out">
          <Icon name="logout" size={16} />
        </button>
      </div>
    </header>
  );
}
