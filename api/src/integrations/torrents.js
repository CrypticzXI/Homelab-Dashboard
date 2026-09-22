import { baseUrl, describeFetchError } from './http.js';

async function safeFetch(url, opts) {
  try {
    return await fetch(url, opts);
  } catch (e) {
    throw new Error(describeFetchError(e, url));
  }
}

/* ---------------- qBittorrent (WebUI API v2) ---------------- */

const qbSessions = new Map(); // url -> SID cookie

async function qbLogin(url, config) {
  const res = await safeFetch(`${url}/api/v2/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', referer: url },
    body: new URLSearchParams({ username: config.username || '', password: config.password || '' }),
  });
  const text = await res.text();
  if (!res.ok || text.trim() !== 'Ok.') throw new Error('qBittorrent login failed — check username/password');
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('qBittorrent did not return a session cookie');
  qbSessions.set(url, cookie);
  return cookie;
}

async function qbGet(url, config, path, retry = true) {
  const cookie = qbSessions.get(url) || (await qbLogin(url, config));
  const res = await safeFetch(`${url}${path}`, { headers: { cookie, referer: url } });
  if (res.status === 403 && retry) {
    qbSessions.delete(url);
    return qbGet(url, config, path, false);
  }
  if (!res.ok) throw new Error(`qBittorrent HTTP ${res.status}`);
  return res.json();
}

export async function getQbittorrent(config) {
  const url = baseUrl(config.url);
  const [info, torrents] = await Promise.all([
    qbGet(url, config, '/api/v2/transfer/info'),
    qbGet(url, config, '/api/v2/torrents/info?sort=added_on&reverse=true&limit=50'),
  ]);
  const active = torrents.filter((t) => ['downloading', 'uploading', 'stalledDL', 'metaDL', 'forcedDL'].includes(t.state));
  return {
    client: 'qBittorrent',
    downSpeed: info.dl_info_speed,
    upSpeed: info.up_info_speed,
    total: torrents.length,
    downloading: torrents.filter((t) => ['downloading', 'stalledDL', 'metaDL', 'forcedDL'].includes(t.state)).length,
    seeding: torrents.filter((t) => ['uploading', 'stalledUP', 'forcedUP'].includes(t.state)).length,
    paused: torrents.filter((t) => t.state.startsWith('paused') || t.state.startsWith('stopped')).length,
    items: (active.length ? active : torrents).slice(0, 6).map((t) => ({
      name: t.name,
      progress: Math.round(t.progress * 100),
      state: t.state,
      size: t.size,
      dlspeed: t.dlspeed,
      upspeed: t.upspeed,
      eta: t.eta > 0 && t.eta < 8640000 ? t.eta : null,
    })),
  };
}

/* ---------------- Transmission (RPC) ---------------- */

const trSessions = new Map(); // url -> X-Transmission-Session-Id

async function trRpc(url, config, method, args, retry = true) {
  const headers = { 'content-type': 'application/json' };
  if (config.username) {
    headers.authorization = 'Basic ' + Buffer.from(`${config.username}:${config.password || ''}`).toString('base64');
  }
  if (trSessions.has(url)) headers['x-transmission-session-id'] = trSessions.get(url);
  const res = await safeFetch(`${url}/transmission/rpc`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ method, arguments: args }),
  });
  if (res.status === 409 && retry) {
    trSessions.set(url, res.headers.get('x-transmission-session-id'));
    return trRpc(url, config, method, args, false);
  }
  if (res.status === 401) throw new Error('Transmission rejected the username/password');
  if (!res.ok) throw new Error(`Transmission HTTP ${res.status}`);
  const body = await res.json();
  if (body.result !== 'success') throw new Error(body.result);
  return body.arguments;
}

export async function getTransmission(config) {
  const url = baseUrl(config.url);
  const [stats, list] = await Promise.all([
    trRpc(url, config, 'session-stats', {}),
    trRpc(url, config, 'torrent-get', {
      fields: ['id', 'name', 'percentDone', 'status', 'totalSize', 'rateDownload', 'rateUpload', 'eta', 'addedDate'],
    }),
  ]);
  const torrents = (list.torrents || []).sort((a, b) => b.addedDate - a.addedDate);
  const stateName = (s) => ({ 0: 'paused', 1: 'checkWait', 2: 'checking', 3: 'queued', 4: 'downloading', 5: 'seedWait', 6: 'seeding' })[s] || 'unknown';
  const active = torrents.filter((t) => t.status === 4 || (t.status === 6 && t.rateUpload > 0));
  return {
    client: 'Transmission',
    downSpeed: stats.downloadSpeed,
    upSpeed: stats.uploadSpeed,
    total: torrents.length,
    downloading: torrents.filter((t) => t.status === 4).length,
    seeding: torrents.filter((t) => t.status === 6).length,
    paused: torrents.filter((t) => t.status === 0).length,
    items: (active.length ? active : torrents).slice(0, 6).map((t) => ({
      name: t.name,
      progress: Math.round(t.percentDone * 100),
      state: stateName(t.status),
      size: t.totalSize,
      dlspeed: t.rateDownload,
      upspeed: t.rateUpload,
      eta: t.eta > 0 ? t.eta : null,
    })),
  };
}
