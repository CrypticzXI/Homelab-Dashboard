import React from 'react';
import { bytes, duration, relDate, speed } from '../lib/format.js';
import { DataWidget, Meter, ProgressRow, Stat } from './common.jsx';

const plexImg = (widget, thumb, w = 120) =>
  `/api/widgets/${encodeURIComponent(widget.id)}/plex-image?path=${encodeURIComponent(thumb)}&w=${w}`;

/* ---------- Plex ---------- */
export function PlexWidget({ widget }) {
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={15_000}>
        {(d) => (
          <>
            <div className="stats">
              <Stat value={d.nowPlaying.length} label="Streaming" tone={d.nowPlaying.length ? 'ok' : ''} />
              {d.libraries.slice(0, 3).map((l) => (
                <Stat key={l.key} value={l.count ?? '—'} label={l.title} />
              ))}
            </div>
            {d.nowPlaying.length ? (
              <ul className="list">
                {d.nowPlaying.map((s, i) => (
                  <li key={i}>
                    {s.thumb ? <img className="thumb" src={plexImg(widget, s.thumb, 80)} alt="" /> : null}
                    <span className="name">
                      {s.title}
                      <small>
                        {s.subtitle ? `${s.subtitle} · ` : ''}
                        {s.user} · {s.player} · {s.state}
                      </small>
                      <div className="bar thin" style={{ marginTop: 4 }}>
                        <i style={{ width: `${s.progress}%` }} />
                      </div>
                    </span>
                  </li>
                ))}
              </ul>
            ) : d.recent.length ? (
              <>
                <div className="meter">
                  <div className="row">
                    <span>Recently added</span>
                  </div>
                </div>
                <div className="posters">
                  {d.recent.map((r, i) =>
                    r.thumb ? <img key={i} src={plexImg(widget, r.thumb, 120)} alt={r.title} title={`${r.title} ${r.subtitle}`} /> : null,
                  )}
                </div>
              </>
            ) : (
              <div className="empty">Nothing playing right now.</div>
            )}
          </>
        )}
      </DataWidget>
    </div>
  );
}

/* ---------- Weaver (usenet) ---------- */
const weaverTone = (state) =>
  state === 'FAILED' ? 'bad' : state === 'PAUSED' || state === 'QUEUED' ? '' : state === 'DOWNLOADING' ? '' : 'ok';

export function WeaverWidget({ widget }) {
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={5_000}>
        {(d) => {
          const s = d.summary;
          const remaining = s.totalBytes - s.downloadedBytes;
          return (
            <>
              <div className="stats">
                <Stat value={d.paused ? 'Paused' : speed(s.currentDownloadSpeed)} label="Speed" tone={d.paused ? 'warn' : s.currentDownloadSpeed ? 'ok' : ''} small />
                <Stat value={s.activeItems} label="Active" small />
                <Stat value={s.queuedItems} label="Queued" small />
                <Stat value={s.failedItems} label="Failed" tone={s.failedItems ? 'bad' : ''} small />
              </div>
              {d.queue.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {d.queue.map((q) => (
                    <ProgressRow
                      key={q.id}
                      name={q.title}
                      sub={q.state.toLowerCase().replace(/_/g, ' ')}
                      right={`${Math.round(q.progress)}% · ${bytes(q.total, 1)}`}
                      pct={q.progress}
                      tone={weaverTone(q.state)}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty">Queue is empty.</div>
              )}
              {remaining > 0 && !d.paused && s.currentDownloadSpeed > 0 ? (
                <div className="meter">
                  <div className="row">
                    <span>{bytes(remaining, 1)} remaining</span>
                    <b>ETA {duration(remaining / s.currentDownloadSpeed)}</b>
                  </div>
                </div>
              ) : null}
              {d.metrics?.disks?.map((disk) =>
                disk.free != null ? (
                  <Meter
                    key={disk.name}
                    label={disk.name}
                    value={`${bytes(disk.free, 0)} free of ${bytes(disk.total, 0)}`}
                    pct={((disk.total - disk.free) / disk.total) * 100}
                  />
                ) : null,
              )}
              {d.metrics?.cap ? (
                <Meter
                  label="Bandwidth cap"
                  value={`${bytes(d.metrics.cap.used, 1)} / ${bytes(d.metrics.cap.limit, 0)}`}
                  pct={(d.metrics.cap.used / d.metrics.cap.limit) * 100}
                />
              ) : null}
              {d.metricsError ? <div className="warn-line" title={d.metricsError}>Metrics: {d.metricsError}</div> : null}
            </>
          );
        }}
      </DataWidget>
    </div>
  );
}

/* ---------- Scryer (media manager) ---------- */
export function ScryerWidget({ widget }) {
  const view = widget.config?.view || 'overview';
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={20_000}>
        {(d) => (
          <>
            {d.health ? (
              <div className="stats">
                <Stat value={d.health.titlesMovie} label="Movies" small />
                <Stat value={d.health.titlesSeries} label="Series" small />
                <Stat value={d.health.titlesAnime} label="Anime" small />
                <Stat value={d.queueTotal ?? '—'} label="Queue" small />
              </div>
            ) : (
              <div className="stats">
                <Stat value={d.queueTotal ?? '—'} label="Queue" small />
                <Stat value={d.pendingRequests} label="Requests" small tone={d.pendingRequests ? 'warn' : ''} />
                <Stat value={d.pendingImports} label="Imports" small tone={d.pendingImports ? 'warn' : ''} />
              </div>
            )}

            {d.activity ? (
              <div className="meter">
                <div className="row">
                  <span>Last 24h</span>
                  <b>
                    {d.activity.grabbed} grabbed · {d.activity.imported} imported
                    {d.activity.importFailed + d.activity.downloadFailed ? (
                      <span style={{ color: 'var(--bad)' }}> · {d.activity.importFailed + d.activity.downloadFailed} failed</span>
                    ) : null}
                  </b>
                </div>
              </div>
            ) : null}

            {view !== 'calendar' && d.queue.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {d.queue.map((q) => (
                  <ProgressRow
                    key={q.id}
                    name={q.title}
                    sub={q.state?.toLowerCase().replace(/_/g, ' ')}
                    right={q.eta ? duration(q.eta) : q.size != null ? bytes(q.size, 1) : `${Math.round(q.progress)}%`}
                    pct={q.progress}
                    tone={q.attention ? 'warn' : ''}
                  />
                ))}
              </div>
            ) : null}

            {(view === 'calendar' || !d.queue.length) && d.upcoming.length ? (
              <ul className="list compact">
                {d.upcoming.map((e) => (
                  <li key={e.id}>
                    <span className="tag accent">{relDate(e.airDate)}</span>
                    <span className="name">
                      {e.title}
                      <small>
                        {e.episode} {e.name}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {!d.queue.length && !d.upcoming.length ? <div className="empty">Nothing queued or airing this week.</div> : null}

            {d.metrics?.storage?.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {d.metrics.storage.map((s) => (
                  <Meter
                    key={s.name}
                    label={s.name}
                    value={s.free != null ? `${bytes(s.free, 0)} free of ${bytes(s.total, 0)}` : bytes(s.total, 0)}
                    pct={s.used != null ? (s.used / s.total) * 100 : 0}
                  />
                ))}
              </div>
            ) : null}
            {d.metrics && (d.metrics.clients?.length || d.metrics.indexers?.length) ? (
              <div className="chips">
                {d.metrics.clients.map((c) => (
                  <span key={'c' + c.name} className={`tag ${c.up ? 'ok' : 'bad'}`} title="download client">
                    {c.name}
                  </span>
                ))}
                {d.metrics.indexers.map((i) => (
                  <span key={'i' + i.name} className={`tag ${i.backoff ? 'warn' : 'ok'}`} title={i.backoff ? 'indexer backing off' : 'indexer'}>
                    {i.name}
                  </span>
                ))}
              </div>
            ) : null}
            {d.metrics?.uptime != null || d.metrics?.counters ? (
              <div className="meter">
                <div className="row">
                  <span>
                    {d.metrics.uptime != null ? `up ${duration(d.metrics.uptime)}` : ''}
                    {d.metrics.wsConnections != null ? ` · ${d.metrics.wsConnections} ws` : ''}
                  </span>
                  <b>
                    {d.metrics.counters?.grabs != null ? `${d.metrics.counters.grabs} grabs` : ''}
                    {d.metrics.counters?.imports != null ? ` · ${d.metrics.counters.imports} imports` : ''}
                    {d.metrics.counters?.subtitles ? ` · ${d.metrics.counters.subtitles} subs` : ''}
                  </b>
                </div>
              </div>
            ) : null}
            {d.metricsError ? <div className="warn-line" title={d.metricsError}>Metrics: {d.metricsError}</div> : null}
            {d.warnings?.length ? <div className="warn-line">{d.warnings[0]}</div> : null}
          </>
        )}
      </DataWidget>
    </div>
  );
}

/* ---------- qBittorrent / Transmission ---------- */
export function TorrentWidget({ widget }) {
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={5_000}>
        {(d) => (
          <>
            <div className="stats">
              <Stat value={speed(d.downSpeed)} label="Down" tone={d.downSpeed ? 'ok' : ''} small />
              <Stat value={speed(d.upSpeed)} label="Up" small />
              <Stat value={d.downloading} label="Leeching" small />
              <Stat value={d.seeding} label="Seeding" small />
            </div>
            {d.items.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {d.items.map((t, i) => (
                  <ProgressRow
                    key={i}
                    name={t.name}
                    sub={t.state}
                    right={t.progress < 100 ? `${t.progress}% · ${t.eta ? duration(t.eta) : speed(t.dlspeed)}` : bytes(t.size, 1)}
                    pct={t.progress}
                    tone={t.progress >= 100 ? 'ok' : ''}
                  />
                ))}
              </div>
            ) : (
              <div className="empty">No torrents.</div>
            )}
          </>
        )}
      </DataWidget>
    </div>
  );
}
