import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { bytes, duration, relDate } from '../lib/format.js';
import { DataWidget, Meter, ProgressRow, Stat } from './common.jsx';

const Rows = ({ children }) => <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>;

/* ---------- Uptime Kuma ---------- */
export function UptimeKumaWidget({ widget }) {
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={20_000}>
        {(d) => (
          <>
            <div className="stats">
              <Stat value={d.up} label="Up" tone="ok" small />
              <Stat value={d.down} label="Down" tone={d.down ? 'bad' : ''} small />
              {d.pending ? <Stat value={d.pending} label="Pending" tone="warn" small /> : null}
              <Stat value={d.total} label="Monitors" small />
            </div>
            <ul className="list compact">
              {d.monitors.map((m) => (
                <li key={m.name}>
                  <i className={`dot ${m.status === 'up' ? 'ok' : m.status === 'down' ? 'bad' : 'warn'}`} />
                  <span className="name" title={m.url}>
                    {m.name}
                  </span>
                  {m.certDays != null && m.certDays < 14 ? <span className="tag warn">cert {Math.round(m.certDays)}d</span> : null}
                  <span className="val mono">{m.ms != null ? `${Math.round(m.ms)} ms` : m.status}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </DataWidget>
    </div>
  );
}

/* ---------- Pi-hole / AdGuard ---------- */
export function DnsWidget({ widget }) {
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={15_000}>
        {(d) => (
          <>
            <div className="stats">
              <Stat value={d.queries.toLocaleString()} label="Queries" small />
              <Stat value={d.blocked.toLocaleString()} label="Blocked" tone="warn" small />
              <Stat value={`${d.percent}%`} label="Blocked %" small />
              {d.clients != null ? <Stat value={d.clients} label="Clients" small /> : null}
              {d.avgMs != null ? <Stat value={`${d.avgMs} ms`} label="Avg" small /> : null}
            </div>
            <Meter label={d.blocking === false ? 'Blocking disabled' : d.domainsOnList ? `${d.domainsOnList.toLocaleString()} domains on lists` : 'Blocking'} value={`${d.percent}%`} pct={d.percent} tone={d.blocking === false ? 'bad' : 'warn'} />
          </>
        )}
      </DataWidget>
    </div>
  );
}

/* ---------- Proxmox ---------- */
export function ProxmoxWidget({ widget }) {
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={15_000}>
        {(d) => (
          <>
            <div className="stats">
              <Stat value={`${d.running} / ${d.vms + d.lxc}`} label="Running" tone="ok" small />
              <Stat value={d.vms} label="VMs" small />
              <Stat value={d.lxc} label="LXC" small />
            </div>
            {d.nodes.map((n) => (
              <div key={n.name} className="meter">
                <div className="row">
                  <span>
                    <i className={`dot ${n.status === 'online' ? 'ok' : 'bad'}`} style={{ display: 'inline-block', marginRight: 6 }} />
                    {n.name} · up {duration(n.uptime)}
                  </span>
                  <b>
                    {n.cpu}% · {bytes(n.mem, 1)} / {bytes(n.maxmem, 0)}
                  </b>
                </div>
                <div className="bar thin">
                  <i style={{ width: `${(n.mem / n.maxmem) * 100}%` }} />
                </div>
              </div>
            ))}
            <ul className="list compact">
              {d.guests.map((g) => (
                <li key={g.id}>
                  <i className={`dot ${g.status === 'running' ? 'ok' : ''}`} />
                  <span className="name">
                    {g.name} <span className="tag">{g.type === 'qemu' ? 'vm' : 'lxc'}</span>
                  </span>
                  <span className="val mono">{g.status === 'running' ? `${g.cpu}% · ${bytes(g.mem, 0)}` : g.status}</span>
                </li>
              ))}
            </ul>
            {d.storage.map((s) => (
              <Meter key={s.node + s.name} label={`${s.name} @ ${s.node}`} value={`${bytes(s.used, 0)} / ${bytes(s.total, 0)}`} pct={(s.used / s.total) * 100} />
            ))}
          </>
        )}
      </DataWidget>
    </div>
  );
}

/* ---------- Tailscale ---------- */
export function TailscaleWidget({ widget }) {
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={30_000}>
        {(d) => (
          <>
            <div className="stats">
              <Stat value={d.online} label="Online" tone="ok" small />
              <Stat value={d.total - d.online} label="Offline" small />
              <Stat value={d.total} label="Devices" small />
            </div>
            <ul className="list compact">
              {d.devices.map((x) => (
                <li key={x.name + x.ip}>
                  <i className={`dot ${x.online ? 'ok' : ''}`} />
                  <span className="name">
                    {x.name}
                    <small>
                      {x.os} · {x.ip}
                      {x.exitNode ? ' · exit node' : ''}
                    </small>
                  </span>
                  {x.updateAvailable ? <span className="tag warn">update</span> : null}
                  <span className="val">{x.online ? 'online' : relDate(x.lastSeen)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </DataWidget>
    </div>
  );
}

/* ---------- Speedtest ---------- */
export function SpeedtestWidget({ widget }) {
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={60_000}>
        {(d) => (
          <>
            <div className="stats">
              <Stat value={d.down} label="↓ Mbps" tone="ok" />
              <Stat value={d.up} label="↑ Mbps" />
              <Stat value={d.ping ?? '—'} label="Ping ms" />
            </div>
            <div className="meter">
              <div className="row">
                <span>{d.server || 'Last result'}</span>
                <b>{d.at ? new Date(d.at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</b>
              </div>
            </div>
          </>
        )}
      </DataWidget>
    </div>
  );
}

/* ---------- Sonarr / Radarr ---------- */
export function ArrWidget({ widget }) {
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={15_000}>
        {(d) => (
          <>
            <div className="stats">
              <Stat value={d.queue} label="Queue" small />
              <Stat value={d.missing ?? '—'} label="Missing" tone={d.missing ? 'warn' : ''} small />
              <Stat value={d.upcoming.length} label="Upcoming" small />
            </div>
            {d.items.length ? (
              <Rows>
                {d.items.map((q, i) => (
                  <ProgressRow key={i} name={q.title} sub={q.status} right={q.eta || `${q.progress}%`} pct={q.progress} tone={q.warning ? 'warn' : ''} />
                ))}
              </Rows>
            ) : null}
            {!d.items.length && d.upcoming.length ? (
              <ul className="list compact">
                {d.upcoming.map((u, i) => (
                  <li key={i}>
                    <span className="tag accent">{relDate(u.date)}</span>
                    <span className="name">
                      {u.title}
                      <small>{u.sub}</small>
                    </span>
                    {u.hasFile ? <span className="tag ok">got</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {!d.items.length && !d.upcoming.length ? <div className="empty">Queue empty, nothing upcoming this week.</div> : null}
          </>
        )}
      </DataWidget>
    </div>
  );
}

/* ---------- Jellyfin ---------- */
export function JellyfinWidget({ widget }) {
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={15_000}>
        {(d) => (
          <>
            <div className="stats">
              <Stat value={d.playing.length} label="Streaming" tone={d.playing.length ? 'ok' : ''} small />
              <Stat value={d.movies} label="Movies" small />
              <Stat value={d.series} label="Series" small />
              <Stat value={d.episodes} label="Episodes" small />
            </div>
            {d.playing.length ? (
              <ul className="list">
                {d.playing.map((p, i) => (
                  <li key={i}>
                    <span className="name">
                      {p.title}
                      <small>
                        {p.sub ? `${p.sub} · ` : ''}
                        {p.user} · {p.client} · {p.paused ? 'paused' : p.transcoding ? 'transcoding' : 'direct'}
                      </small>
                      <div className="bar thin" style={{ marginTop: 4 }}>
                        <i style={{ width: `${p.progress}%` }} />
                      </div>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty">Nothing playing right now.</div>
            )}
          </>
        )}
      </DataWidget>
    </div>
  );
}

/* ---------- Jellyseerr / Overseerr ---------- */
export function SeerrWidget({ widget }) {
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={20_000}>
        {(d) => (
          <>
            <div className="stats">
              <Stat value={d.pending} label="Pending" tone={d.pending ? 'warn' : ''} small />
              <Stat value={d.processing} label="Processing" small />
              <Stat value={d.available} label="Available" tone="ok" small />
              <Stat value={d.total} label="Total" small />
            </div>
            <ul className="list compact">
              {d.requests.map((r, i) => (
                <li key={i}>
                  <span className={`tag ${r.status === 'pending' ? 'warn' : r.status === 'declined' ? 'bad' : 'ok'}`}>{r.status}</span>
                  <span className="name">
                    {r.title}
                    <small>
                      {r.type} · {r.user} · {relDate(r.at)}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </DataWidget>
    </div>
  );
}

/* ---------- Home Assistant ---------- */
const TOGGLABLE = new Set(['switch', 'light', 'input_boolean', 'fan', 'automation']);
export function HomeAssistantWidget({ widget }) {
  const [busy, setBusy] = useState(null);
  const canControl = widget.config?.controls !== false;
  const toggle = async (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(id);
    try {
      await api.haAction(widget.id, id, 'toggle');
    } finally {
      setTimeout(() => setBusy(null), 800);
    }
  };
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={5_000}>
        {(d) =>
          d.entities.length ? (
            <ul className="list compact">
              {d.entities.map((en) => {
                const on = en.state === 'on';
                const tog = canControl && TOGGLABLE.has(en.domain);
                return (
                  <li key={en.id}>
                    <i className={`dot ${en.error ? 'bad' : on ? 'ok' : en.state === 'off' ? '' : 'warn'}`} />
                    <span className="name" title={en.id}>
                      {en.name}
                      {en.error ? <small>{en.error}</small> : null}
                    </span>
                    {tog ? (
                      <button className={`toggle ${on ? 'on' : ''} ${busy === en.id ? 'busy' : ''}`} onClick={(e) => toggle(e, en.id)} title="Toggle">
                        <i />
                      </button>
                    ) : (
                      <span className="val">
                        {en.state}
                        {en.unit ? ` ${en.unit}` : ''}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="empty">Connected. Edit this widget and add entity ids (e.g. sensor.living_room_temperature).</div>
          )
        }
      </DataWidget>
    </div>
  );
}

/* ---------- Immich ---------- */
export function ImmichWidget({ widget }) {
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={60_000}>
        {(d) => (
          <>
            <div className="stats">
              <Stat value={d.photos.toLocaleString()} label="Photos" small />
              <Stat value={d.videos.toLocaleString()} label="Videos" small />
              <Stat value={d.users} label="Users" small />
              <Stat value={bytes(d.usage, 0)} label="Library" small />
            </div>
            {d.diskSize ? <Meter label={`Disk · ${d.diskSize} total`} value={d.diskUse} pct={d.diskUsagePercentage} /> : null}
          </>
        )}
      </DataWidget>
    </div>
  );
}
