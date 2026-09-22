/**
 * Integration pack: Uptime Kuma, Pi-hole, AdGuard Home, Proxmox, Tailscale,
 * Speedtest Tracker, Sonarr/Radarr, Jellyfin, Jellyseerr/Overseerr,
 * Home Assistant, Immich. Each fetcher takes the widget config and returns
 * plain JSON for the matching React component in web/src/widgets/services.jsx.
 */
import { baseUrl, fetchJson, describeFetchError } from './http.js';
import { scrapeCached, select, aggregate } from './prometheus.js';

const need = (v, what) => {
  if (!v) throw new Error(`${what} is not configured`);
  return v;
};

/* ---------------- Uptime Kuma ---------------- */
// Uses Kuma's Prometheus endpoint (Settings → API Keys). Basic auth with an empty user.
export async function getUptimeKuma(config) {
  const url = baseUrl(config.url);
  const key = need(config.apiKey, 'Uptime Kuma API key');
  const p = await scrapeCached(`${url}/metrics`, { authorization: 'Basic ' + Buffer.from(`:${key}`).toString('base64') }, 20_000);
  const monitors = select(p, 'monitor_status').map((s) => {
    const name = s.labels.monitor_name || s.labels.monitor_url || 'monitor';
    const rt = select(p, 'monitor_response_time').find((r) => r.labels.monitor_name === s.labels.monitor_name);
    const cert = select(p, 'monitor_cert_days_remaining').find((r) => r.labels.monitor_name === s.labels.monitor_name);
    return {
      name,
      type: s.labels.monitor_type,
      url: s.labels.monitor_url,
      status: ['down', 'up', 'pending', 'maintenance'][s.value] || 'unknown',
      ms: rt?.value ?? null,
      certDays: cert?.value ?? null,
    };
  });
  const order = { down: 0, pending: 1, maintenance: 2, up: 3 };
  monitors.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  return {
    up: monitors.filter((m) => m.status === 'up').length,
    down: monitors.filter((m) => m.status === 'down').length,
    pending: monitors.filter((m) => m.status === 'pending').length,
    total: monitors.length,
    monitors: monitors.slice(0, Number(config.max) || 8),
  };
}

/* ---------------- Pi-hole (v6 API, falls back to v5) ---------------- */
const piholeSessions = new Map();
export async function getPihole(config) {
  const url = baseUrl(config.url);
  const password = config.password || '';
  // v6
  try {
    let sid = piholeSessions.get(url);
    const auth = async () => {
      const r = await fetchJson(`${url}/api/auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
      if (!r?.session?.valid) throw new Error('Pi-hole rejected the password');
      sid = r.session.sid;
      piholeSessions.set(url, sid);
    };
    if (!sid) await auth();
    let s;
    try {
      s = await fetchJson(`${url}/api/stats/summary`, { headers: { 'X-FTL-SID': sid } });
    } catch (e) {
      if (!/401/.test(e.message)) throw e;
      await auth();
      s = await fetchJson(`${url}/api/stats/summary`, { headers: { 'X-FTL-SID': sid } });
    }
    const blocking = await fetchJson(`${url}/api/dns/blocking`, { headers: { 'X-FTL-SID': sid } }).catch(() => null);
    return {
      version: 6,
      queries: s.queries.total,
      blocked: s.queries.blocked,
      percent: +Number(s.queries.percent_blocked).toFixed(1),
      domainsOnList: s.gravity?.domains_being_blocked,
      clients: s.clients?.active,
      blocking: blocking?.blocking ?? null,
    };
  } catch (e) {
    if (!/404|Response was not JSON/.test(e.message)) throw e;
  }
  // v5
  const token = config.apiKey || '';
  const s = await fetchJson(`${url}/admin/api.php?summaryRaw&auth=${encodeURIComponent(token)}`);
  if (!s || s.dns_queries_today == null) throw new Error('Pi-hole v5 needs the API token (Settings → API → Show API token)');
  return {
    version: 5,
    queries: s.dns_queries_today,
    blocked: s.ads_blocked_today,
    percent: +Number(s.ads_percentage_today).toFixed(1),
    domainsOnList: s.domains_being_blocked,
    clients: s.unique_clients,
    blocking: s.status === 'enabled',
  };
}

/* ---------------- AdGuard Home ---------------- */
export async function getAdguard(config) {
  const url = baseUrl(config.url);
  const headers = config.username ? { authorization: 'Basic ' + Buffer.from(`${config.username}:${config.password || ''}`).toString('base64') } : {};
  const [s, st] = await Promise.all([fetchJson(`${url}/control/stats`, { headers }), fetchJson(`${url}/control/status`, { headers }).catch(() => null)]);
  const q = s.num_dns_queries || 0;
  return {
    queries: q,
    blocked: s.num_blocked_filtering || 0,
    percent: q ? +(((s.num_blocked_filtering || 0) / q) * 100).toFixed(1) : 0,
    avgMs: s.avg_processing_time != null ? Math.round(s.avg_processing_time * 1000) : null,
    blocking: st?.protection_enabled ?? null,
    version: st?.version || null,
  };
}

/* ---------------- Proxmox VE ---------------- */
// API token: Datacenter → Permissions → API Tokens. Format user@realm!tokenid, secret is the UUID.
export async function getProxmox(config) {
  const url = baseUrl(config.url);
  const headers = { authorization: `PVEAPIToken=${need(config.tokenId, 'Proxmox token id')}=${need(config.apiKey, 'Proxmox token secret')}` };
  const r = await fetchJson(`${url}/api2/json/cluster/resources`, { headers });
  const res = r.data || [];
  const nodes = res.filter((x) => x.type === 'node').map((n) => ({ name: n.node, status: n.status, cpu: +((n.cpu || 0) * 100).toFixed(1), mem: n.mem, maxmem: n.maxmem, uptime: n.uptime }));
  const guests = res
    .filter((x) => x.type === 'qemu' || x.type === 'lxc')
    .map((g) => ({ id: g.vmid, name: g.name, type: g.type, node: g.node, status: g.status, cpu: +((g.cpu || 0) * 100).toFixed(1), mem: g.mem, maxmem: g.maxmem }))
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'running' ? -1 : 1));
  const storage = res.filter((x) => x.type === 'storage' && x.maxdisk).map((s) => ({ name: s.storage, node: s.node, used: s.disk, total: s.maxdisk }));
  return {
    nodes,
    vms: guests.filter((g) => g.type === 'qemu').length,
    lxc: guests.filter((g) => g.type === 'lxc').length,
    running: guests.filter((g) => g.status === 'running').length,
    guests: guests.slice(0, Number(config.max) || 8),
    storage: storage.slice(0, 4),
  };
}

/* ---------------- Tailscale ---------------- */
export async function getTailscale(config) {
  const key = need(config.apiKey, 'Tailscale API key');
  const tailnet = config.tailnet || '-';
  const r = await fetchJson(`https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(tailnet)}/devices`, { headers: { authorization: `Bearer ${key}` } });
  const now = Date.now();
  const devices = (r.devices || []).map((d) => ({
    name: (d.name || '').split('.')[0],
    os: d.os,
    ip: d.addresses?.[0],
    online: now - new Date(d.lastSeen).getTime() < 5 * 60_000,
    lastSeen: d.lastSeen,
    exitNode: d.advertisedRoutes?.includes('0.0.0.0/0'),
    updateAvailable: d.updateAvailable,
  }));
  devices.sort((a, b) => (a.online === b.online ? a.name.localeCompare(b.name) : a.online ? -1 : 1));
  return { total: devices.length, online: devices.filter((d) => d.online).length, devices: devices.slice(0, Number(config.max) || 8) };
}

/* ---------------- Speedtest Tracker ---------------- */
export async function getSpeedtest(config) {
  const url = baseUrl(config.url);
  const headers = config.apiKey ? { authorization: `Bearer ${config.apiKey}`, accept: 'application/json' } : { accept: 'application/json' };
  const r = await fetchJson(`${url}/api/v1/results/latest`, { headers });
  const d = r.data || r;
  // v1 returns bits/s; older versions Mbps
  const toMbps = (v) => (v > 100000 ? v / 1_000_000 : v);
  return {
    down: +toMbps(d.download).toFixed(1),
    up: +toMbps(d.upload).toFixed(1),
    ping: d.ping != null ? +Number(d.ping).toFixed(1) : null,
    server: d.data?.server?.name || d.server_name || null,
    at: d.created_at,
  };
}

/* ---------------- Sonarr / Radarr ---------------- */
export async function getArr(config, kind) {
  const url = baseUrl(config.url);
  const headers = { 'X-Api-Key': need(config.apiKey, `${kind} API key`) };
  const today = new Date();
  const end = new Date(Date.now() + 7 * 86400_000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const [status, queue, missing, calendar] = await Promise.all([
    fetchJson(`${url}/api/v3/system/status`, { headers }),
    fetchJson(`${url}/api/v3/queue?pageSize=6&includeUnknownMovieItems=true&includeUnknownSeriesItems=true`, { headers }),
    fetchJson(`${url}/api/v3/wanted/missing?pageSize=1&monitored=true`, { headers }).catch(() => null),
    fetchJson(`${url}/api/v3/calendar?start=${iso(today)}&end=${iso(end)}&includeSeries=true&includeMovie=true`, { headers }).catch(() => []),
  ]);
  const items = (queue.records || []).map((q) => ({
    title: q.series ? `${q.series.title} ${q.episode ? `S${String(q.episode.seasonNumber).padStart(2, '0')}E${String(q.episode.episodeNumber).padStart(2, '0')}` : ''}` : q.movie?.title || q.title,
    status: q.trackedDownloadState || q.status,
    progress: q.size ? Math.round(((q.size - q.sizeleft) / q.size) * 100) : 0,
    size: q.size,
    eta: q.timeleft,
    warning: q.trackedDownloadStatus === 'warning' || q.status === 'warning',
  }));
  return {
    version: status.version,
    queue: queue.totalRecords ?? items.length,
    missing: missing?.totalRecords ?? null,
    items,
    upcoming: (calendar || []).slice(0, 8).map((c) => ({
      title: c.series ? `${c.series.title}` : c.title,
      sub: c.series ? `S${String(c.seasonNumber).padStart(2, '0')}E${String(c.episodeNumber).padStart(2, '0')} ${c.title || ''}` : c.year,
      date: c.airDateUtc || c.digitalRelease || c.physicalRelease || c.inCinemas,
      hasFile: c.hasFile,
    })),
  };
}
export const getSonarr = (c) => getArr(c, 'Sonarr');
export const getRadarr = (c) => getArr(c, 'Radarr');

/* ---------------- Jellyfin / Emby ---------------- */
export async function getJellyfin(config) {
  const url = baseUrl(config.url);
  const headers = { 'X-Emby-Token': need(config.apiKey, 'Jellyfin API key') };
  const [counts, sessions, info] = await Promise.all([
    fetchJson(`${url}/Items/Counts`, { headers }),
    fetchJson(`${url}/Sessions?activeWithinSeconds=300`, { headers }),
    fetchJson(`${url}/System/Info`, { headers }).catch(() => null),
  ]);
  const playing = (sessions || [])
    .filter((s) => s.NowPlayingItem)
    .map((s) => {
      const it = s.NowPlayingItem;
      return {
        title: it.SeriesName ? `${it.SeriesName} — ${it.Name}` : it.Name,
        sub: it.Type === 'Episode' ? `S${String(it.ParentIndexNumber).padStart(2, '0')}E${String(it.IndexNumber).padStart(2, '0')}` : it.ProductionYear || '',
        user: s.UserName,
        client: s.Client,
        paused: s.PlayState?.IsPaused,
        progress: it.RunTimeTicks ? Math.round(((s.PlayState?.PositionTicks || 0) / it.RunTimeTicks) * 100) : 0,
        transcoding: s.PlayState?.PlayMethod === 'Transcode',
      };
    });
  return {
    server: info ? `${info.ProductName || 'Jellyfin'} ${info.Version}` : 'Jellyfin',
    movies: counts.MovieCount,
    series: counts.SeriesCount,
    episodes: counts.EpisodeCount,
    songs: counts.SongCount,
    playing,
  };
}

/* ---------------- Jellyseerr / Overseerr ---------------- */
export async function getSeerr(config) {
  const url = baseUrl(config.url);
  const headers = { 'X-Api-Key': need(config.apiKey, 'API key') };
  const [count, recent] = await Promise.all([
    fetchJson(`${url}/api/v1/request/count`, { headers }),
    fetchJson(`${url}/api/v1/request?take=6&sort=added&filter=all`, { headers }).catch(() => ({ results: [] })),
  ]);
  const statusName = (s) => ({ 1: 'pending', 2: 'approved', 3: 'declined' })[s] || 'unknown';
  return {
    pending: count.pending,
    approved: count.approved,
    available: count.available,
    processing: count.processing,
    total: count.total,
    requests: (recent.results || []).map((r) => ({
      title: r.media?.title || r.media?.tmdbId ? `${r.type} #${r.media?.tmdbId}` : r.type,
      type: r.type,
      status: statusName(r.status),
      user: r.requestedBy?.displayName || r.requestedBy?.username,
      at: r.createdAt,
      tmdbId: r.media?.tmdbId,
    })),
  };
}

/* ---------------- Home Assistant ---------------- */
// Long-lived token from your profile page. `entities` is a list of entity ids to show.
export async function getHomeAssistant(config) {
  const url = baseUrl(config.url);
  const headers = { authorization: `Bearer ${need(config.apiKey, 'Home Assistant token')}` };
  const ids = Array.isArray(config.entities) ? config.entities : [];
  if (!ids.length) {
    await fetchJson(`${url}/api/`, { headers });
    return { entities: [] };
  }
  const entities = await Promise.all(
    ids.map(async (id) => {
      try {
        const s = await fetchJson(`${url}/api/states/${encodeURIComponent(id)}`, { headers });
        return {
          id,
          name: s.attributes?.friendly_name || id,
          state: s.state,
          unit: s.attributes?.unit_of_measurement || '',
          icon: s.attributes?.icon || null,
          domain: id.split('.')[0],
          changed: s.last_changed,
        };
      } catch (e) {
        return { id, name: id, state: '—', error: e.message };
      }
    }),
  );
  return { entities };
}

/** Toggle / call a service on a Home Assistant entity (switch, light, input_boolean, …). */
export async function homeAssistantAction(config, entityId, action) {
  const url = baseUrl(config.url);
  const headers = { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' };
  const domain = entityId.split('.')[0];
  const svc = action === 'toggle' ? 'toggle' : action === 'on' ? 'turn_on' : 'turn_off';
  const d = ['switch', 'light', 'input_boolean', 'fan', 'automation', 'script', 'scene', 'media_player', 'cover', 'lock'].includes(domain) ? domain : 'homeassistant';
  await fetchJson(`${url}/api/services/${d}/${svc}`, { method: 'POST', headers, body: JSON.stringify({ entity_id: entityId }) });
  return { ok: true };
}

/* ---------------- Immich ---------------- */
export async function getImmich(config) {
  const url = baseUrl(config.url);
  const headers = { 'x-api-key': need(config.apiKey, 'Immich API key') };
  const [stats, storage, version] = await Promise.all([
    fetchJson(`${url}/api/server/statistics`, { headers }),
    fetchJson(`${url}/api/server/storage`, { headers }).catch(() => null),
    fetchJson(`${url}/api/server/version`, { headers }).catch(() => null),
  ]);
  return {
    photos: stats.photos,
    videos: stats.videos,
    usage: stats.usage,
    users: (stats.usageByUser || []).length,
    diskUse: storage?.diskUse || null,
    diskSize: storage?.diskSize || null,
    diskUsagePercentage: storage?.diskUsagePercentage ?? null,
    version: version ? `${version.major}.${version.minor}.${version.patch}` : null,
  };
}
