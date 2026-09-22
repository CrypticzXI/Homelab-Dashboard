import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../lib/api.js';
import { bytes, duration } from '../lib/format.js';
import { Icon } from '../lib/icons.jsx';
import { DataWidget, Meter, Stat } from './common.jsx';

/* ---------- container log viewer (slide-over) ---------- */
function LogPanel({ container, onClose }) {
  const [lines, setLines] = useState(null);
  const [err, setErr] = useState('');
  const [tail, setTail] = useState(200);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .dockerLogs(container.id, tail)
        .then((r) => alive && setLines(r.lines))
        .catch((e) => alive && setErr(e.message));
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [container.id, tail]);
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return createPortal(
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onClick={(e) => e.stopPropagation()}>
      <div className="modal logs">
        <div className="logs-head">
          <h3>{container.name}</h3>
          <span className="tag">{container.image}</span>
          <span className="spacer" />
          <select value={tail} onChange={(e) => setTail(Number(e.target.value))}>
            {[100, 200, 500, 1000].map((n) => (
              <option key={n} value={n}>
                last {n}
              </option>
            ))}
          </select>
          <button className="btn icon ghost" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <pre className="logs-body">
          {err ? <span className="e">{err}</span> : null}
          {lines === null && !err ? 'Loading…' : null}
          {lines?.length === 0 ? 'No output.' : null}
          {lines?.map((l, i) => (
            <span key={i} className={l.s === 'err' ? 'e' : ''}>
              {l.l}
              {'\n'}
            </span>
          ))}
        </pre>
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Docker ---------- */
export function DockerWidget({ widget }) {
  const max = Number(widget.config?.max) || 8;
  const [logs, setLogs] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const act = async (e, c, action) => {
    e.preventDefault();
    e.stopPropagation();
    if (action !== 'start' && !window.confirm(`${action} ${c.name}?`)) return;
    setBusy(c.id);
    setError('');
    try {
      await api.dockerAction(c.id, action);
    } catch (err) {
      setError(err.message);
    } finally {
      setTimeout(() => setBusy(null), 1500);
    }
  };
  const openLogs = (e, c) => {
    e.preventDefault();
    e.stopPropagation();
    setLogs(c);
  };

  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={10_000}>
        {(d) => (
          <>
            <div className="stats">
              <Stat value={d.running} label="Running" tone="ok" />
              <Stat value={d.stopped} label="Stopped" tone={d.stopped ? 'warn' : ''} />
              <Stat value={d.total} label="Total" />
            </div>
            <ul className={`list compact ${d.controls ? 'has-controls' : ''}`}>
              {d.containers.slice(0, max).map((c) => {
                const running = c.state === 'running';
                return (
                  <li key={c.id} className={busy === c.id ? 'busy' : ''}>
                    <i className={`dot ${running ? 'ok' : c.state === 'restarting' ? 'warn' : 'bad'}`} />
                    <span className="name" title={`${c.image}\n${c.status}`}>
                      {c.name}
                    </span>
                    {running && c.cpu != null ? (
                      <span className="val mono">
                        {c.cpu}% · {bytes(c.memUsed, 0)}
                      </span>
                    ) : (
                      <span className="val">{c.status}</span>
                    )}
                    {d.controls ? (
                      <span className="row-actions" onPointerDown={(e) => e.stopPropagation()}>
                        <button title="Logs" onClick={(e) => openLogs(e, c)}>
                          <Icon name="logs" size={13} />
                        </button>
                        {running ? (
                          <>
                            <button title="Restart" onClick={(e) => act(e, c, 'restart')}>
                              <Icon name="refresh" size={13} />
                            </button>
                            <button title="Stop" className="stop" onClick={(e) => act(e, c, 'stop')}>
                              <Icon name="stop" size={13} />
                            </button>
                          </>
                        ) : (
                          <button title="Start" className="start" onClick={(e) => act(e, c, 'start')}>
                            <Icon name="play" size={13} />
                          </button>
                        )}
                      </span>
                    ) : null}
                  </li>
                );
              })}
              {d.containers.length > max ? (
                <li>
                  <span className="name" style={{ color: 'var(--dim)' }}>
                    +{d.containers.length - max} more
                  </span>
                </li>
              ) : null}
            </ul>
            {error ? <div className="err">{error}</div> : null}
          </>
        )}
      </DataWidget>
      {logs ? <LogPanel container={logs} onClose={() => setLogs(null)} /> : null}
    </div>
  );
}

/* ---------- System ---------- */
export function SystemWidget({ widget }) {
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={5_000}>
        {(d) => (
          <>
            <Meter label={`CPU · ${d.cores} cores · load ${d.load[0]}`} value={`${d.cpu}%`} pct={d.cpu} />
            <Meter label="Memory" value={`${bytes(d.mem.used, 1)} / ${bytes(d.mem.total, 0)}`} pct={(d.mem.used / d.mem.total) * 100} />
            {d.disks.map((disk) =>
              disk.error ? (
                <div key={disk.path} className="warn-line">
                  {disk.path}: {disk.error}
                </div>
              ) : (
                <Meter key={disk.path} label={`Disk ${disk.path}`} value={`${bytes(disk.used, 0)} / ${bytes(disk.total, 0)}`} pct={(disk.used / disk.total) * 100} />
              ),
            )}
            <div className="meter">
              <div className="row">
                <span>{d.hostname}</span>
                <b>up {duration(d.uptime)}</b>
              </div>
            </div>
          </>
        )}
      </DataWidget>
    </div>
  );
}
