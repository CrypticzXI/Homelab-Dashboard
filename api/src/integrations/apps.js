/**
 * Integration pack #2. Every fetcher returns the "standard" shape rendered by
 * web/src/widgets/std.jsx:
 *   { stats: [{label, value, tone?}], meters: [{label, value, pct, tone?}],
 *     rows: [{name, sub?, value?, tag?, tone?, dot?, pct?}], chips: [{text, tone}], note?, version? }
 * Keep each fetcher small and defensive: services differ between versions.
 */
import { baseUrl, fetchJson } from './http.js';

const need = (v, what) => {
  if (!v) throw new Error(`${what} is not configured`);
  return v;
};
const basic = (u, p) => ({ authorization: 'Basic ' + Buffer.from(`${u}:${p || ''}`).toString('base64') });
const gb = (b) => `${(b / 1024 ** 3).toFixed(b >= 100 * 1024 ** 3 ? 0 : 1)} GB`;
const tb = (b) => (b >= 1024 ** 4 ? `${(b / 1024 ** 4).toFixed(1)} TB` : gb(b));
const mbps = (bps) => `${(bps / 125_000).toFixed(1)} Mbps`;
const speed = (bps) => (bps >= 1024 ** 2 ? `${(bps / 1024 ** 2).toFixed(1)} MB/s` : `${(bps / 1024).toFixed(0)} KB/s`);
const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const dur = (s) => (s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m`);
const ago = (iso) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? 'now' : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};
const max = (c, d = 8) => Number(c.max) || d;

/* ---------------- Prowlarr ---------------- */
export async function getProwlarr(c) {
  const url = baseUrl(c.url);
  const headers = { 'X-Api-Key': need(c.apiKey, 'Prowlarr API key') };
  const [indexers, stats, health] = await Promise.all([
    fetchJson(`${url}/api/v1/indexer`, { headers }),
    fetchJson(`${url}/api/v1/indexerstats`, { headers }).catch(() => ({ indexers: [] })),
    fetchJson(`${url}/api/v1/health`, { headers }).catch(() => []),
  ]);
  const st = stats.indexers || [];
  const grabs = st.reduce((a, i) => a + (i.numberOfGrabs || 0), 0);
  const queries = st.reduce((a, i) => a + (i.numberOfQueries || 0), 0);
  const failed = st.reduce((a, i) => a + (i.numberOfFailedQueries || 0) + (i.numberOfFailedGrabs || 0), 0);
  return {
    stats: [
      { label: 'Indexers', value: indexers.filter((i) => i.enable).length },
      { label: 'Queries', value: queries.toLocaleString() },
      { label: 'Grabs', value: grabs.toLocaleString(), tone: 'ok' },
      { label: 'Failed', value: failed, tone: failed ? 'warn' : '' },
    ],
    rows: st
      .sort((a, b) => (b.numberOfQueries || 0) - (a.numberOfQueries || 0))
      .slice(0, max(c))
      .map((i) => ({ name: i.indexerName, sub: `${i.numberOfGrabs || 0} grabs`, value: `${i.numberOfQueries || 0} q · ${Math.round(i.averageResponseTime || 0)} ms`, dot: i.numberOfFailedQueries ? 'warn' : 'ok' })),
    chips: health.slice(0, 4).map((h) => ({ text: h.message, tone: h.type === 'error' ? 'bad' : 'warn' })),
  };
}

/* ---------------- Lidarr / Readarr (v1 API, same shape as Sonarr) ---------------- */
async function arrV1(c, kind) {
  const url = baseUrl(c.url);
  const headers = { 'X-Api-Key': need(c.apiKey, `${kind} API key`) };
  const [status, queue, missing] = await Promise.all([
    fetchJson(`${url}/api/v1/system/status`, { headers }),
    fetchJson(`${url}/api/v1/queue?pageSize=${max(c, 6)}`, { headers }),
    fetchJson(`${url}/api/v1/wanted/missing?pageSize=1`, { headers }).catch(() => null),
  ]);
  const title = (q) => (q.artist ? `${q.artist.artistName} — ${q.album?.title || q.title}` : q.author ? `${q.author.authorName} — ${q.book?.title || q.title}` : q.title);
  return {
    version: status.version,
    stats: [
      { label: 'Queue', value: queue.totalRecords ?? (queue.records || []).length },
      { label: 'Missing', value: missing?.totalRecords ?? '—', tone: missing?.totalRecords ? 'warn' : '' },
    ],
    rows: (queue.records || []).map((q) => ({ name: title(q), sub: q.trackedDownloadState || q.status, value: q.timeleft || '', pct: q.size ? Math.round(((q.size - q.sizeleft) / q.size) * 100) : 0 })),
  };
}
export const getLidarr = (c) => arrV1(c, 'Lidarr');
export const getReadarr = (c) => arrV1(c, 'Readarr');

/* ---------------- Bazarr ---------------- */
export async function getBazarr(c) {
  const url = baseUrl(c.url);
  const headers = { 'X-API-KEY': need(c.apiKey, 'Bazarr API key') };
  const [badges, status] = await Promise.all([fetchJson(`${url}/api/badges`, { headers }), fetchJson(`${url}/api/system/status`, { headers }).catch(() => null)]);
  return {
    version: status?.data?.bazarr_version,
    stats: [
      { label: 'Episodes', value: badges.episodes ?? 0, tone: badges.episodes ? 'warn' : 'ok' },
      { label: 'Movies', value: badges.movies ?? 0, tone: badges.movies ? 'warn' : 'ok' },
      { label: 'Providers', value: badges.providers ?? 0, tone: badges.providers ? 'bad' : '' },
    ],
    note: 'Wanted subtitles (episodes / movies) and providers with errors',
  };
}

/* ---------------- SABnzbd ---------------- */
export async function getSabnzbd(c) {
  const url = baseUrl(c.url);
  const key = need(c.apiKey, 'SABnzbd API key');
  const [q, h] = await Promise.all([
    fetchJson(`${url}/api?mode=queue&output=json&apikey=${encodeURIComponent(key)}&limit=${max(c, 6)}`),
    fetchJson(`${url}/api?mode=history&output=json&apikey=${encodeURIComponent(key)}&limit=4`).catch(() => null),
  ]);
  const qu = q.queue;
  if (!qu) throw new Error(q.error || 'SABnzbd returned no queue');
  const kb = Number(qu.kbpersec || 0);
  return {
    version: qu.version,
    stats: [
      { label: 'Speed', value: qu.paused ? 'Paused' : speed(kb * 1024), tone: qu.paused ? 'warn' : kb ? 'ok' : '' },
      { label: 'Queue', value: qu.noofslots_total ?? qu.noofslots ?? 0 },
      { label: 'Left', value: `${Number(qu.mbleft || 0) >= 1024 ? (Number(qu.mbleft) / 1024).toFixed(1) + ' GB' : Math.round(Number(qu.mbleft || 0)) + ' MB'}` },
      { label: 'ETA', value: qu.timeleft || '—' },
    ],
    rows: (qu.slots || []).map((s) => ({ name: s.filename, sub: s.status?.toLowerCase(), value: `${s.percentage}% · ${s.timeleft}`, pct: Number(s.percentage) })),
    chips: (h?.history?.slots || []).map((s) => ({ text: `${s.status === 'Completed' ? '✓' : '✗'} ${s.name}`, tone: s.status === 'Completed' ? 'ok' : 'bad' })),
  };
}

/* ---------------- NZBGet ---------------- */
export async function getNzbget(c) {
  const url = baseUrl(c.url);
  const headers = { 'content-type': 'application/json', ...(c.username ? basic(c.username, c.password) : {}) };
  const rpc = (method) => fetchJson(`${url}/jsonrpc`, { method: 'POST', headers, body: JSON.stringify({ method, params: [] }) }).then((r) => r.result);
  const [st, groups] = await Promise.all([rpc('status'), rpc('listgroups').catch(() => [])]);
  return {
    stats: [
      { label: 'Speed', value: st.DownloadPaused ? 'Paused' : speed(st.DownloadRate || 0), tone: st.DownloadPaused ? 'warn' : st.DownloadRate ? 'ok' : '' },
      { label: 'Queue', value: groups.length },
      { label: 'Left', value: `${((st.RemainingSizeMB || 0) / 1024).toFixed(1)} GB` },
    ],
    rows: groups.slice(0, max(c, 6)).map((g) => ({ name: g.NZBName, sub: g.Status?.toLowerCase(), value: `${(g.RemainingSizeMB / 1024).toFixed(1)} GB left`, pct: pctOf(g.FileSizeMB - g.RemainingSizeMB, g.FileSizeMB) })),
  };
}

/* ---------------- Deluge ---------------- */
const delugeCookies = new Map();
export async function getDeluge(c) {
  const url = baseUrl(c.url);
  const call = async (method, params, retry = true) => {
    const cookie = delugeCookies.get(url);
    const res = await fetch(`${url}/json`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ id: 1, method, params }) });
    const setc = res.headers.get('set-cookie');
    if (setc) delugeCookies.set(url, setc.split(';')[0]);
    const j = await res.json();
    if (j.error && retry && /not authenticated|Not authenticated/i.test(j.error.message || '')) {
      await call('auth.login', [c.password || ''], false);
      return call(method, params, false);
    }
    if (j.error) throw new Error(j.error.message);
    return j.result;
  };
  if (!delugeCookies.get(url)) {
    const ok = await call('auth.login', [c.password || ''], false);
    if (!ok) throw new Error('Deluge rejected the web UI password');
  }
  const ui = await call('web.update_ui', [['name', 'progress', 'state', 'total_size', 'download_payload_rate', 'upload_payload_rate', 'eta'], {}]);
  const ts = Object.values(ui.torrents || {});
  return {
    stats: [
      { label: 'Down', value: speed(ui.stats?.download_rate || 0), tone: ui.stats?.download_rate ? 'ok' : '' },
      { label: 'Up', value: speed(ui.stats?.upload_rate || 0) },
      { label: 'Active', value: ts.filter((t) => t.state === 'Downloading').length },
      { label: 'Seeding', value: ts.filter((t) => t.state === 'Seeding').length },
    ],
    rows: ts
      .filter((t) => t.state === 'Downloading')
      .concat(ts.filter((t) => t.state !== 'Downloading'))
      .slice(0, max(c, 6))
      .map((t) => ({ name: t.name, sub: t.state.toLowerCase(), value: t.progress < 100 ? `${t.progress.toFixed(0)}%${t.eta > 0 ? ' · ' + dur(t.eta) : ''}` : gb(t.total_size), pct: t.progress })),
  };
}

/* ---------------- Tautulli ---------------- */
export async function getTautulli(c) {
  const url = baseUrl(c.url);
  const key = need(c.apiKey, 'Tautulli API key');
  const api = (cmd) => fetchJson(`${url}/api/v2?apikey=${encodeURIComponent(key)}&cmd=${cmd}`).then((r) => r.response?.data);
  const [act, libs] = await Promise.all([api('get_activity'), api('get_libraries').catch(() => [])]);
  return {
    stats: [
      { label: 'Streams', value: act.stream_count ?? 0, tone: Number(act.stream_count) ? 'ok' : '' },
      { label: 'Bandwidth', value: mbps((act.total_bandwidth || 0) * 1000) },
      ...(libs || []).slice(0, 2).map((l) => ({ label: l.section_name, value: Number(l.count || 0).toLocaleString() })),
    ],
    rows: (act.sessions || []).map((s) => ({ name: s.full_title, sub: `${s.user} · ${s.player} · ${s.transcode_decision}`, value: s.state, pct: Number(s.progress_percent) })),
  };
}

/* ---------------- Portainer ---------------- */
export async function getPortainer(c) {
  const url = baseUrl(c.url);
  const headers = { 'X-API-Key': need(c.apiKey, 'Portainer access token') };
  const eps = await fetchJson(`${url}/api/endpoints`, { headers });
  const rows = eps.map((e) => {
    const s = e.Snapshots?.[0] || e.Kubernetes?.Snapshots?.[0] || {};
    return { name: e.Name, sub: e.Type === 2 ? 'agent' : e.Type === 4 ? 'edge' : 'local', value: `${s.RunningContainerCount ?? 0} up · ${s.StoppedContainerCount ?? 0} down · ${s.StackCount ?? 0} stacks`, dot: e.Status === 1 ? 'ok' : 'bad' };
  });
  const sum = (k) => eps.reduce((a, e) => a + (e.Snapshots?.[0]?.[k] || 0), 0);
  return {
    stats: [
      { label: 'Environments', value: eps.length },
      { label: 'Running', value: sum('RunningContainerCount'), tone: 'ok' },
      { label: 'Stopped', value: sum('StoppedContainerCount'), tone: sum('StoppedContainerCount') ? 'warn' : '' },
      { label: 'Images', value: sum('ImageCount') },
    ],
    rows: rows.slice(0, max(c)),
  };
}

/* ---------------- TrueNAS SCALE ---------------- */
export async function getTruenas(c) {
  const url = baseUrl(c.url);
  const headers = { authorization: `Bearer ${need(c.apiKey, 'TrueNAS API key')}` };
  const [info, pools, alerts] = await Promise.all([
    fetchJson(`${url}/api/v2.0/system/info`, { headers }),
    fetchJson(`${url}/api/v2.0/pool`, { headers }).catch(() => []),
    fetchJson(`${url}/api/v2.0/alert/list`, { headers }).catch(() => []),
  ]);
  const live = alerts.filter((a) => !a.dismissed);
  return {
    version: info.version,
    stats: [
      { label: 'Pools', value: pools.length },
      { label: 'Healthy', value: pools.filter((p) => p.healthy).length, tone: pools.every((p) => p.healthy) ? 'ok' : 'bad' },
      { label: 'Alerts', value: live.length, tone: live.some((a) => a.level === 'CRITICAL') ? 'bad' : live.length ? 'warn' : '' },
      { label: 'Uptime', value: dur(info.uptime_seconds || 0) },
    ],
    meters: pools.filter((p) => p.size).map((p) => ({ label: `${p.name} · ${p.status}`, value: `${tb(p.allocated)} / ${tb(p.size)}`, pct: pctOf(p.allocated, p.size), tone: p.healthy ? '' : 'bad' })),
    chips: live.slice(0, 3).map((a) => ({ text: a.formatted?.slice(0, 80), tone: a.level === 'CRITICAL' ? 'bad' : 'warn' })),
  };
}

/* ---------------- Nextcloud ---------------- */
export async function getNextcloud(c) {
  const url = baseUrl(c.url);
  const headers = c.apiKey ? { 'NC-Token': c.apiKey } : c.username ? basic(c.username, c.password) : {};
  const r = await fetchJson(`${url}/ocs/v2.php/apps/serverinfo/api/v1/info?format=json&skipApps=true`, { headers: { ...headers, 'OCS-APIRequest': 'true' } });
  const d = r.ocs?.data;
  if (!d) throw new Error('serverinfo app not enabled or token wrong');
  const sys = d.nextcloud?.system || {};
  const st = d.nextcloud?.storage || {};
  const au = d.activeUsers || {};
  return {
    version: sys.version,
    stats: [
      { label: 'Users', value: st.num_users ?? 0 },
      { label: 'Active 24h', value: au.last24hours ?? 0, tone: 'ok' },
      { label: 'Files', value: Number(st.num_files || 0).toLocaleString() },
      { label: 'Free', value: gb(Number(sys.freespace || 0)) },
    ],
    meters: sys.mem_total ? [{ label: 'Memory', value: `${gb((sys.mem_total - sys.mem_free) * 1024)} / ${gb(sys.mem_total * 1024)}`, pct: pctOf(sys.mem_total - sys.mem_free, sys.mem_total) }] : [],
    chips: d.server?.php?.version ? [{ text: `PHP ${d.server.php.version}` }, { text: `${d.server.database?.type} ${d.server.database?.version}` }] : [],
  };
}

/* ---------------- Gotify ---------------- */
export async function getGotify(c) {
  const url = baseUrl(c.url);
  const headers = { 'X-Gotify-Key': need(c.apiKey, 'Gotify client token') };
  const [msgs, apps] = await Promise.all([fetchJson(`${url}/message?limit=${max(c, 6)}`, { headers }), fetchJson(`${url}/application`, { headers }).catch(() => [])]);
  const appName = (id) => apps.find((a) => a.id === id)?.name || `app ${id}`;
  return {
    stats: [{ label: 'Apps', value: apps.length }, { label: 'Recent', value: (msgs.messages || []).length }],
    rows: (msgs.messages || []).map((m) => ({ name: m.title || appName(m.appid), sub: m.message?.slice(0, 120), value: ago(m.date), dot: m.priority >= 7 ? 'bad' : m.priority >= 4 ? 'warn' : 'ok' })),
  };
}

/* ---------------- Grafana ---------------- */
export async function getGrafana(c) {
  const url = baseUrl(c.url);
  const headers = c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : c.username ? basic(c.username, c.password) : {};
  const [health, alerts] = await Promise.all([fetchJson(`${url}/api/health`), fetchJson(`${url}/api/alertmanager/grafana/api/v2/alerts`, { headers }).catch(() => null)]);
  const firing = (alerts || []).filter((a) => a.status?.state === 'active');
  return {
    version: health.version,
    stats: [
      { label: 'Status', value: health.database === 'ok' ? 'OK' : health.database, tone: health.database === 'ok' ? 'ok' : 'bad' },
      { label: 'Firing', value: alerts ? firing.length : '—', tone: firing.length ? 'bad' : 'ok' },
      { label: 'Alerts', value: alerts ? alerts.length : '—' },
    ],
    rows: firing.slice(0, max(c, 6)).map((a) => ({ name: a.labels?.alertname, sub: a.annotations?.summary || Object.entries(a.labels || {}).filter(([k]) => !['alertname', 'grafana_folder'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' '), value: a.labels?.severity, dot: 'bad' })),
    note: alerts ? null : 'Add a service-account token to see alerts',
  };
}

/* ---------------- Traefik ---------------- */
export async function getTraefik(c) {
  const url = baseUrl(c.url);
  const headers = c.username ? basic(c.username, c.password) : {};
  const [ov, routers] = await Promise.all([fetchJson(`${url}/api/overview`, { headers }), fetchJson(`${url}/api/http/routers`, { headers }).catch(() => [])]);
  const h = ov.http || {};
  const bad = routers.filter((r) => r.status !== 'enabled');
  return {
    version: ov.version,
    stats: [
      { label: 'Routers', value: h.routers?.total ?? routers.length, tone: h.routers?.errors ? 'bad' : '' },
      { label: 'Services', value: h.services?.total ?? 0 },
      { label: 'Middlewares', value: h.middlewares?.total ?? 0 },
      { label: 'Errors', value: (h.routers?.errors || 0) + (h.services?.errors || 0), tone: h.routers?.errors || h.services?.errors ? 'bad' : 'ok' },
    ],
    rows: (bad.length ? bad : routers).slice(0, max(c, 6)).map((r) => ({ name: r.name, sub: r.rule?.slice(0, 80), value: r.provider, dot: r.status === 'enabled' ? 'ok' : 'bad' })),
  };
}

/* ---------------- Nginx Proxy Manager ---------------- */
const npmTokens = new Map();
export async function getNpm(c) {
  const url = baseUrl(c.url);
  const login = async () => {
    const r = await fetchJson(`${url}/api/tokens`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: need(c.username, 'NPM email'), secret: c.password || '' }) });
    npmTokens.set(url, r.token);
    return r.token;
  };
  let token = npmTokens.get(url) || (await login());
  const get = async (p, retry = true) => {
    try {
      return await fetchJson(`${url}${p}`, { headers: { authorization: `Bearer ${token}` } });
    } catch (e) {
      if (retry && /401|403/.test(e.message)) {
        token = await login();
        return get(p, false);
      }
      throw e;
    }
  };
  const [hosts, certs] = await Promise.all([get('/api/nginx/proxy-hosts'), get('/api/nginx/certificates').catch(() => [])]);
  const soon = certs.filter((x) => x.expires_on && new Date(x.expires_on).getTime() - Date.now() < 14 * 86400_000);
  return {
    stats: [
      { label: 'Hosts', value: hosts.length },
      { label: 'Enabled', value: hosts.filter((h) => h.enabled).length, tone: 'ok' },
      { label: 'Certs', value: certs.length },
      { label: 'Expiring', value: soon.length, tone: soon.length ? 'warn' : '' },
    ],
    rows: hosts.slice(0, max(c)).map((h) => ({ name: h.domain_names?.join(', '), sub: `${h.forward_scheme}://${h.forward_host}:${h.forward_port}`, value: h.certificate_id ? 'TLS' : 'http', dot: h.enabled ? 'ok' : '' })),
    chips: soon.map((x) => ({ text: `${x.nice_name} expires ${ago(x.expires_on)}`, tone: 'warn' })),
  };
}

/* ---------------- Paperless-ngx ---------------- */
export async function getPaperless(c) {
  const url = baseUrl(c.url);
  const headers = c.apiKey ? { authorization: `Token ${c.apiKey}` } : basic(c.username, c.password);
  const [st, docs] = await Promise.all([fetchJson(`${url}/api/statistics/`, { headers }), fetchJson(`${url}/api/documents/?ordering=-created&page_size=${max(c, 5)}`, { headers }).catch(() => ({ results: [] }))]);
  return {
    stats: [
      { label: 'Documents', value: Number(st.documents_total || 0).toLocaleString() },
      { label: 'Inbox', value: st.documents_inbox ?? 0, tone: st.documents_inbox ? 'warn' : 'ok' },
      { label: 'Tags', value: st.tag_count ?? '—' },
      { label: 'Correspondents', value: st.correspondent_count ?? '—' },
    ],
    rows: (docs.results || []).map((d) => ({ name: d.title, sub: d.created?.slice(0, 10), value: '' })),
  };
}

/* ---------------- Syncthing ---------------- */
export async function getSyncthing(c) {
  const url = baseUrl(c.url);
  const headers = { 'X-API-Key': need(c.apiKey, 'Syncthing API key') };
  const [status, conns, devices, folders] = await Promise.all([
    fetchJson(`${url}/rest/system/status`, { headers }),
    fetchJson(`${url}/rest/system/connections`, { headers }),
    fetchJson(`${url}/rest/config/devices`, { headers }),
    fetchJson(`${url}/rest/config/folders`, { headers }),
  ]);
  const others = devices.filter((d) => d.deviceID !== status.myID);
  const connected = others.filter((d) => conns.connections?.[d.deviceID]?.connected);
  const fstat = await Promise.all(folders.slice(0, max(c, 6)).map((f) => fetchJson(`${url}/rest/db/status?folder=${encodeURIComponent(f.id)}`, { headers }).then((s) => ({ f, s })).catch(() => ({ f, s: null }))));
  return {
    stats: [
      { label: 'Devices', value: `${connected.length}/${others.length}`, tone: connected.length === others.length ? 'ok' : 'warn' },
      { label: 'Folders', value: folders.length },
      { label: 'Uptime', value: dur(status.uptime || 0) },
    ],
    rows: fstat.map(({ f, s }) => ({ name: f.label || f.id, sub: s?.state || 'unknown', value: s ? `${gb(s.globalBytes || 0)}${s.needBytes ? ` · ${gb(s.needBytes)} to sync` : ''}` : '', dot: !s ? '' : s.state === 'idle' ? 'ok' : s.state === 'error' ? 'bad' : 'warn', pct: s && s.globalBytes ? pctOf(s.globalBytes - (s.needBytes || 0), s.globalBytes) : undefined })),
    chips: others.map((d) => ({ text: d.name, tone: conns.connections?.[d.deviceID]?.connected ? 'ok' : '' })),
  };
}

/* ---------------- Glances (remote host stats) ---------------- */
export async function getGlances(c) {
  const url = baseUrl(c.url);
  const headers = c.username ? basic(c.username, c.password) : {};
  let v = 4;
  const get = (p) => fetchJson(`${url}/api/${v}/${p}`, { headers });
  let ql;
  try {
    ql = await get('quicklook');
  } catch {
    v = 3;
    ql = await get('quicklook');
  }
  const [fs, sys, up, sensors] = await Promise.all([get('fs').catch(() => []), get('system').catch(() => ({})), get('uptime').catch(() => ''), get('sensors').catch(() => [])]);
  const temp = (sensors || []).find((s) => /package|cpu|core 0|tctl/i.test(s.label));
  return {
    stats: [
      { label: 'CPU', value: `${Math.round(ql.cpu)}%`, tone: ql.cpu > 85 ? 'bad' : '' },
      { label: 'Memory', value: `${Math.round(ql.mem)}%`, tone: ql.mem > 90 ? 'bad' : '' },
      { label: 'Load', value: Number(ql.load || 0).toFixed(1) },
      ...(temp ? [{ label: 'Temp', value: `${Math.round(temp.value)}°`, tone: temp.value > 80 ? 'bad' : '' }] : []),
    ],
    meters: (fs || []).slice(0, 4).map((f) => ({ label: f.mnt_point, value: `${gb(f.used)} / ${gb(f.size)}`, pct: Math.round(f.percent) })),
    note: `${sys.hostname || ''} · ${sys.platform || sys.os_name || ''}${up ? ` · up ${String(up).replace(/,.*/, '')}` : ''}`,
  };
}

/* ---------------- Scrutiny (disk health) ---------------- */
export async function getScrutiny(c) {
  const url = baseUrl(c.url);
  const r = await fetchJson(`${url}/api/summary`);
  const disks = Object.values(r.data?.summary || {});
  const status = (n) => ({ 0: 'ok', 1: 'bad', 2: 'bad', 3: 'bad' })[n] ?? 'warn';
  const failed = disks.filter((d) => d.device?.device_status).length;
  return {
    stats: [
      { label: 'Disks', value: disks.length },
      { label: 'Passed', value: disks.length - failed, tone: 'ok' },
      { label: 'Failed', value: failed, tone: failed ? 'bad' : '' },
    ],
    rows: disks.slice(0, max(c)).map((d) => ({ name: d.device?.device_name || d.device?.wwn, sub: `${d.device?.model_name || ''} · ${tb(d.device?.capacity || 0)}`, value: `${d.smart?.temp ?? '—'}° · ${Math.round((d.smart?.power_on_hours || 0) / 24)} d`, dot: status(d.device?.device_status) })),
  };
}

/* ---------------- Frigate ---------------- */
export async function getFrigate(c) {
  const url = baseUrl(c.url);
  const headers = c.username ? basic(c.username, c.password) : {};
  const [stats, events] = await Promise.all([fetchJson(`${url}/api/stats`, { headers }), fetchJson(`${url}/api/events?limit=${max(c, 6)}`, { headers }).catch(() => [])]);
  const cams = Object.entries(stats.cameras || {});
  const sto = stats.service?.storage ? Object.values(stats.service.storage)[0] : null;
  return {
    version: stats.service?.version,
    stats: [
      { label: 'Cameras', value: cams.length },
      { label: 'Detect fps', value: cams.reduce((a, [, v]) => a + (v.detection_fps || 0), 0).toFixed(1) },
      ...(stats.detectors ? [{ label: 'Inference', value: `${Math.round(Object.values(stats.detectors)[0]?.inference_speed || 0)} ms` }] : []),
      ...(sto ? [{ label: 'Storage', value: `${Math.round(sto.used / sto.total * 100)}%` }] : []),
    ],
    rows: events.map((e) => ({ name: `${e.label} · ${e.camera}`, sub: new Date(e.start_time * 1000).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }), value: e.top_score ? `${Math.round(e.top_score * 100)}%` : '', dot: e.end_time ? 'ok' : 'warn' })),
    chips: cams.map(([n, v]) => ({ text: `${n} ${v.camera_fps?.toFixed(0) || 0} fps`, tone: v.camera_fps ? 'ok' : 'bad' })),
  };
}

/* ---------------- UniFi Network (Integration API, UniFi OS 9+) ---------------- */
export async function getUnifi(c) {
  const url = baseUrl(c.url);
  const headers = { 'X-API-KEY': need(c.apiKey, 'UniFi API key'), accept: 'application/json' };
  const sites = await fetchJson(`${url}/proxy/network/integration/v1/sites`, { headers });
  const site = (sites.data || [])[0];
  if (!site) throw new Error('No UniFi sites visible to this key');
  const [devices, clients] = await Promise.all([
    fetchJson(`${url}/proxy/network/integration/v1/sites/${site.id}/devices?limit=200`, { headers }),
    fetchJson(`${url}/proxy/network/integration/v1/sites/${site.id}/clients?limit=1000`, { headers }).catch(() => ({ data: [], totalCount: null })),
  ]);
  const devs = devices.data || [];
  return {
    stats: [
      { label: 'Devices', value: `${devs.filter((d) => d.state === 'ONLINE').length}/${devs.length}`, tone: devs.every((d) => d.state === 'ONLINE') ? 'ok' : 'warn' },
      { label: 'Clients', value: clients.totalCount ?? (clients.data || []).length },
      { label: 'Wireless', value: (clients.data || []).filter((x) => x.type === 'WIRELESS').length },
    ],
    rows: devs.slice(0, max(c)).map((d) => ({ name: d.name, sub: `${d.model} · ${d.ipAddress || ''}`, value: d.state?.toLowerCase(), dot: d.state === 'ONLINE' ? 'ok' : 'bad' })),
    note: site.name,
  };
}

/* ---------------- OPNsense ---------------- */
export async function getOpnsense(c) {
  const url = baseUrl(c.url);
  const headers = basic(need(c.username, 'OPNsense API key'), need(c.password, 'OPNsense API secret'));
  const [gw, fw] = await Promise.all([fetchJson(`${url}/api/routes/gateway/status`, { headers }).catch(() => ({ items: [] })), fetchJson(`${url}/api/core/firmware/status`, { headers }).catch(() => null)]);
  const items = gw.items || [];
  return {
    version: fw?.product_version,
    stats: [
      { label: 'Gateways', value: items.length },
      { label: 'Online', value: items.filter((g) => /online|none/i.test(g.status_translated || g.status)).length, tone: 'ok' },
      ...(fw ? [{ label: 'Updates', value: fw.status === 'update' ? (fw.upgrade_packages?.length ?? 'yes') : 'none', tone: fw.status === 'update' ? 'warn' : '' }] : []),
    ],
    rows: items.map((g) => ({ name: g.name, sub: g.address, value: `${g.delay || ''} ${g.loss ? '· ' + g.loss : ''}`.trim(), dot: /online|none/i.test(g.status_translated || g.status) ? 'ok' : 'bad' })),
  };
}

/* ---------------- MikroTik RouterOS (REST) ---------------- */
export async function getMikrotik(c) {
  const url = baseUrl(c.url);
  const headers = basic(need(c.username, 'RouterOS user'), c.password);
  const [res, ifs] = await Promise.all([fetchJson(`${url}/rest/system/resource`, { headers }), fetchJson(`${url}/rest/interface`, { headers }).catch(() => [])]);
  const mem = Number(res['total-memory']) - Number(res['free-memory']);
  return {
    version: `${res['board-name']} · RouterOS ${res.version}`,
    stats: [
      { label: 'CPU', value: `${res['cpu-load']}%`, tone: Number(res['cpu-load']) > 80 ? 'bad' : '' },
      { label: 'Memory', value: `${pctOf(mem, Number(res['total-memory']))}%` },
      { label: 'Uptime', value: res.uptime },
      { label: 'Interfaces', value: ifs.filter((i) => i.running === 'true').length },
    ],
    rows: ifs.filter((i) => i.disabled !== 'true').slice(0, max(c)).map((i) => ({ name: i.name, sub: i.type, value: `↓ ${gb(Number(i['rx-byte'] || 0))} ↑ ${gb(Number(i['tx-byte'] || 0))}`, dot: i.running === 'true' ? 'ok' : '' })),
  };
}

/* ---------------- Miniflux ---------------- */
export async function getMiniflux(c) {
  const url = baseUrl(c.url);
  const headers = c.apiKey ? { 'X-Auth-Token': c.apiKey } : basic(c.username, c.password);
  const [counters, entries] = await Promise.all([fetchJson(`${url}/v1/feeds/counters`, { headers }), fetchJson(`${url}/v1/entries?status=unread&limit=${max(c, 6)}&order=published_at&direction=desc`, { headers })]);
  const unread = Object.values(counters.unreads || {}).reduce((a, b) => a + b, 0);
  return {
    stats: [{ label: 'Unread', value: unread, tone: unread ? 'warn' : 'ok' }, { label: 'Feeds', value: Object.keys(counters.reads || {}).length + Object.keys(counters.unreads || {}).length }],
    rows: (entries.entries || []).map((e) => ({ name: e.title, sub: e.feed?.title, value: ago(e.published_at), href: e.url })),
  };
}

/* ---------------- Gitea / Forgejo ---------------- */
export async function getGitea(c) {
  const url = baseUrl(c.url);
  const headers = { authorization: `token ${need(c.apiKey, 'Gitea token')}` };
  const [me, repos] = await Promise.all([fetchJson(`${url}/api/v1/user`, { headers }), fetchJson(`${url}/api/v1/repos/search?limit=${max(c)}&sort=updated&order=desc`, { headers })]);
  const list = repos.data || [];
  return {
    stats: [
      { label: 'Repos', value: repos.total_count ?? list.length },
      { label: 'Issues', value: list.reduce((a, r) => a + (r.open_issues_count || 0), 0), tone: 'warn' },
      { label: 'PRs', value: list.reduce((a, r) => a + (r.open_pr_counter || 0), 0) },
    ],
    rows: list.map((r) => ({ name: r.full_name, sub: `updated ${ago(r.updated_at)}`, value: `★ ${r.stars_count} · ${r.open_issues_count} issues`, href: r.html_url })),
    note: `signed in as ${me.login}`,
  };
}

/* ---------------- Audiobookshelf ---------------- */
export async function getAudiobookshelf(c) {
  const url = baseUrl(c.url);
  const headers = { authorization: `Bearer ${need(c.apiKey, 'Audiobookshelf API token')}` };
  const libs = (await fetchJson(`${url}/api/libraries`, { headers })).libraries || [];
  const stats = await Promise.all(libs.map((l) => fetchJson(`${url}/api/libraries/${l.id}/stats`, { headers }).then((s) => ({ l, s })).catch(() => ({ l, s: null }))));
  const items = stats.reduce((a, x) => a + (x.s?.totalItems || 0), 0);
  const hours = stats.reduce((a, x) => a + (x.s?.totalDuration || 0), 0) / 3600;
  return {
    stats: [{ label: 'Libraries', value: libs.length }, { label: 'Items', value: items.toLocaleString() }, { label: 'Hours', value: Math.round(hours).toLocaleString() }],
    rows: stats.map(({ l, s }) => ({ name: l.name, sub: l.mediaType, value: s ? `${s.totalItems} items · ${Math.round((s.totalDuration || 0) / 3600)} h · ${gb(s.totalSize || 0)}` : '' })),
  };
}

/* ---------------- Komga ---------------- */
export async function getKomga(c) {
  const url = baseUrl(c.url);
  const headers = c.apiKey ? { 'X-API-Key': c.apiKey } : basic(need(c.username, 'Komga email'), c.password);
  const [libs, series, books] = await Promise.all([fetchJson(`${url}/api/v1/libraries`, { headers }), fetchJson(`${url}/api/v1/series?size=1`, { headers }), fetchJson(`${url}/api/v1/books?size=1`, { headers })]);
  const latest = await fetchJson(`${url}/api/v1/series/latest?size=${max(c, 5)}`, { headers }).catch(() => ({ content: [] }));
  return {
    stats: [{ label: 'Libraries', value: libs.length }, { label: 'Series', value: series.totalElements ?? 0 }, { label: 'Books', value: books.totalElements ?? 0 }],
    rows: (latest.content || []).map((s) => ({ name: s.metadata?.title || s.name, sub: `${s.booksCount} books`, value: s.booksUnreadCount ? `${s.booksUnreadCount} unread` : 'read', dot: s.booksUnreadCount ? 'warn' : 'ok' })),
  };
}

/* ---------------- Minecraft (native Server List Ping, works on LAN) ---------------- */
import net from 'node:net';

function varint(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Buffer.from(out);
}
function readVarint(buf, off) {
  let n = 0, shift = 0, i = off;
  for (;;) {
    if (i >= buf.length) return null;
    const b = buf[i++];
    n |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return [n, i];
    shift += 7;
  }
}
function slp(host, port, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port, timeout });
    let data = Buffer.alloc(0);
    const t0 = Date.now();
    const packet = (id, payload) => {
      const body = Buffer.concat([varint(id), payload]);
      return Buffer.concat([varint(body.length), body]);
    };
    sock.on('connect', () => {
      const h = Buffer.from(host, 'utf8');
      const handshake = Buffer.concat([varint(-1 >>> 0 & 0x7fffffff ? 767 : 767), varint(h.length), h, Buffer.from([port >> 8, port & 0xff]), varint(1)]);
      sock.write(Buffer.concat([packet(0x00, handshake), packet(0x00, Buffer.alloc(0))]));
    });
    sock.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      const len = readVarint(data, 0);
      if (!len) return;
      const [total, o1] = len;
      if (data.length < o1 + total) return;
      const [, o2] = readVarint(data, o1); // packet id
      const [strLen, o3] = readVarint(data, o2);
      const json = data.subarray(o3, o3 + strLen).toString('utf8');
      sock.destroy();
      try {
        resolve({ ...JSON.parse(json), latency: Date.now() - t0 });
      } catch {
        reject(new Error('Bad status response from server'));
      }
    });
    sock.on('timeout', () => { sock.destroy(); reject(new Error(`Timed out connecting to ${host}:${port}`)); });
    sock.on('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' ? `Connection refused by ${host}:${port}` : e.message)));
  });
}
const motdText = (m) => (typeof m === 'string' ? m : m?.text ? m.text + (m.extra || []).map(motdText).join('') : (m?.extra || []).map(motdText).join('')).replace(/§./g, '').trim();

export async function getMinecraft(c) {
  const [host, p] = String(need(c.host, 'Server address')).trim().split(':');
  const port = Number(p) || 25565;
  let r;
  try {
    r = await slp(host, port);
  } catch (e) {
    return { stats: [{ label: 'Status', value: 'Offline', tone: 'bad' }], note: e.message };
  }
  const players = r.players || {};
  return {
    version: r.version?.name,
    stats: [
      { label: 'Status', value: 'Online', tone: 'ok' },
      { label: 'Players', value: `${players.online ?? 0} / ${players.max ?? 0}` },
      { label: 'Ping', value: `${r.latency} ms` },
    ],
    chips: (players.sample || []).slice(0, 12).map((pl) => ({ text: pl.name, tone: 'ok' })),
    note: motdText(r.description) || null,
  };
}
