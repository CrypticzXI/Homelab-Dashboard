import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fetchJson, describeFetchError } from './http.js';
import { DATA_DIR } from '../config.js';

/**
 * TP-Link Tapo cameras.
 *  - device list / battery / events come from the pytapo sidecar (TAPO_BRIDGE)
 *  - live view + snapshots come from go2rtc (GO2RTC), which only connects to a
 *    camera while something is actually consuming the stream
 *
 * Everything camera-facing is cached for MIN_INTERVAL so a page load never
 * wakes a battery camera more than once per 10 minutes.
 */
const BRIDGE = (process.env.TAPO_BRIDGE || 'http://tapo:8484').replace(/\/+$/, '');
const GO2RTC = (process.env.GO2RTC || 'http://go2rtc:1984').replace(/\/+$/, '');
const MIN_INTERVAL = 10 * 60_000;

/* ---------------- event photo store (data/tapo/<stream>/) ----------------
 * When a refresh sees an event that wasn't there last time, we grab one frame
 * from the camera and keep it against that event. One capture per refresh,
 * so a battery camera is woken at most once per MIN_INTERVAL for this.
 */
const PHOTO_DIR = path.join(DATA_DIR, 'tapo');
const KEEP_PHOTOS = 50;
const photoIndex = new Map(); // stream -> { events: { [start]: { file, type, capturedAt } }, lastSeen }

function loadIndex(stream) {
  if (photoIndex.has(stream)) return photoIndex.get(stream);
  let idx = { events: {}, lastSeen: 0 };
  try {
    idx = JSON.parse(fs.readFileSync(path.join(PHOTO_DIR, stream, 'index.json'), 'utf8'));
  } catch {
    /* new camera */
  }
  photoIndex.set(stream, idx);
  return idx;
}
function saveIndex(stream, idx) {
  const dir = path.join(PHOTO_DIR, stream);
  fs.mkdirSync(dir, { recursive: true });
  // prune oldest photos beyond KEEP_PHOTOS
  const starts = Object.keys(idx.events).map(Number).sort((a, b) => b - a);
  for (const old of starts.slice(KEEP_PHOTOS)) {
    fs.rmSync(path.join(dir, idx.events[old].file), { force: true });
    delete idx.events[old];
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(idx));
}
export function eventPhotoPath(stream, start) {
  const idx = loadIndex(stream);
  const e = idx.events[start];
  return e ? path.join(PHOTO_DIR, stream, e.file) : null;
}

async function grabFrame(stream) {
  const res = await fetch(`${GO2RTC}/api/frame.jpeg?src=${encodeURIComponent(stream)}`, { signal: AbortSignal.timeout(25_000) }).catch((e) => {
    throw new Error(describeFetchError(e, GO2RTC));
  });
  if (!res.ok) throw new Error(`go2rtc could not grab a frame (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/** Attach stored photos to events and capture one for the newest unseen event. */
async function photosForEvents(stream, events, allow) {
  const idx = loadIndex(stream);
  let captured = null;
  const newest = events.find((e) => e.start && e.start > (idx.lastSeen || 0) && !idx.events[e.start]);
  if (allow && newest) {
    try {
      const buf = await grabFrame(stream);
      const file = `${newest.start}.jpg`;
      fs.mkdirSync(path.join(PHOTO_DIR, stream), { recursive: true });
      fs.writeFileSync(path.join(PHOTO_DIR, stream, file), buf);
      idx.events[newest.start] = { file, type: newest.type, capturedAt: Date.now() };
      idx.lastError = null;
      captured = newest.start;
    } catch (e) {
      idx.lastError = e.message;
    }
  }
  if (events.length) idx.lastSeen = Math.max(idx.lastSeen || 0, ...events.map((e) => e.start || 0));
  saveIndex(stream, idx);
  const out = events.map((e) => ({ ...e, photo: idx.events[e.start] ? `${e.start}` : null }));
  const latest = Object.keys(idx.events).map(Number).sort((a, b) => b - a)[0];
  return { events: out, captured, latestPhoto: latest || null, photoError: idx.lastError || null };
}

const cache = new Map(); // key -> { at, value }
const inflight = new Map();
async function once(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < MIN_INTERVAL) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
  const p = fn()
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
export const cachedAt = (key) => cache.get(key)?.at || null;

async function bridge(path, body) {
  let r;
  try {
    r = await fetchJson(`${BRIDGE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, 60_000);
  } catch (e) {
    throw new Error(`Tapo bridge unreachable (${e.message}) — is the "tapo" service running?`);
  }
  if (!r?.ok) throw new Error(friendly(r?.error || 'Tapo bridge error', body.host));
  return r;
}

/** pytapo/requests errors are wordy; turn the common ones into one line. */
function friendly(msg, host) {
  if (/Connection refused|NewConnectionError|Max retries/.test(msg)) return `Could not connect to ${host}:443 — check the IP and that the camera/hub is on the LAN`;
  if (/timed out|timeout/i.test(msg)) return `Timed out connecting to ${host}`;
  if (/KLAP login, which needs/.test(msg)) return msg;
  if (/Invalid authentication data|-40401|password|Auth/i.test(msg)) return 'Tapo rejected the login — check the TP-Link ID email + password (or the Camera Account credentials in that mode)';
  if (/Temporary Suspension|-40404/.test(msg)) return 'Tapo temporarily locked logins after failed attempts — wait a few minutes';
  return msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
}

const sha256Upper = (s) => crypto.createHash('sha256').update(s).digest('hex').toUpperCase();
const streamName = (widgetId, camId) => `tapo-${crypto.createHash('md5').update(`${widgetId}:${camId}`).digest('hex').slice(0, 10)}`;

/** Register (idempotently) a go2rtc stream for a camera. go2rtc won't touch the camera until a viewer connects. */
async function registerStream(name, config, cam) {
  const host = config.host.trim();
  let src;
  if (config.auth === 'camera') {
    // local Camera Account: wired cameras expose RTSP; hub battery cams don't
    if (cam.childId) throw new Error('Battery cameras behind a hub only stream with the TP-Link ID password');
    src = `rtsp://${encodeURIComponent(config.user || 'admin')}:${encodeURIComponent(config.password)}@${host}:554/stream${config.substream ? '2' : '1'}`;
  } else {
    src = cam.childId
      ? `tapo://admin:${sha256Upper(config.password)}@${host}/?deviceId=${encodeURIComponent(cam.childId)}`
      : `tapo://admin:${sha256Upper(config.password)}@${host}${config.substream ? '?subtype=1' : ''}`;
  }
  const res = await fetch(`${GO2RTC}/api/streams?name=${encodeURIComponent(name)}&src=${encodeURIComponent(src)}`, { method: 'PUT' });
  if (!res.ok && res.status !== 409) throw new Error(`go2rtc refused stream registration (HTTP ${res.status})`);
}

export async function getTapo(config) {
  if (!config.host) throw new Error('Camera / hub IP is not configured');
  if (!config.password) throw new Error('Password is not configured');
  if (config.auth === 'camera' && !config.user) throw new Error('Camera Account username is not configured');
  const widgetId = config.__widgetId || 'test';
  const key = `tapo:${config.host}:${widgetId}`;
  const hours = Number(config.hours) || 24;
  const limit = Number(config.events) || 6;

  const policy = config.snapshots === true || config.snapshots === 'all' ? 'all' : config.snapshots === false || config.snapshots === 'off' ? 'off' : 'wired';
  return once(key, async () => {
    const auth = config.auth === 'camera' ? 'camera' : 'cloud';
    const creds = { host: config.host, user: config.user || 'admin', password: config.password, auth, email: config.email || '' };
    const dev = await bridge('/devices', creds);
    let go2rtcOk = true;
    const cameras = await Promise.all(
      dev.cameras.map(async (cam) => {
        const name = streamName(widgetId, cam.id);
        try {
          await registerStream(name, config, cam);
        } catch (e) {
          go2rtcOk = false;
          cam.streamError = e.message;
        }
        let events = [];
        let eventsError = null;
        let photos = { events: [], captured: null, latestPhoto: null, photoError: null };
        if (cam.online !== false) {
          try {
            const r = await bridge('/events', { ...creds, childId: cam.childId, hours, limit });
            events = r.events;
            cam.eventTotal = r.total;
            photos = await photosForEvents(name, events, config.eventPhotos !== false && !cam.streamError);
            events = photos.events;
          } catch (e) {
            eventsError = e.message;
          }
        }
        return {
          id: cam.id,
          name: cam.name,
          model: cam.model,
          online: cam.online,
          battery: cam.battery?.percent ?? null,
          charging: cam.battery?.charging ?? null,
          // battery cams sleep; grabbing a frame wakes them, so only do it when explicitly allowed
          snapshot: policy === 'all' || (policy === 'wired' && cam.battery == null),
          stream: name,
          streamError: cam.streamError || null,
          events,
          eventTotal: cam.eventTotal ?? events.length,
          eventsError,
          latestPhoto: photos.latestPhoto,
          photoError: photos.photoError,
          snapshotAt: cachedAt(`snap:${name}`),
        };
      }),
    );
    return {
      host: dev.host,
      cameras,
      go2rtc: go2rtcOk,
      snapshotPolicy: policy,
      fetchedAt: Date.now(),
      minInterval: MIN_INTERVAL,
    };
  });
}

/**
 * JPEG snapshot via go2rtc, cached for MIN_INTERVAL. Taking one wakes the
 * camera briefly, which is why the widget only asks on page load.
 */
export async function getTapoSnapshot(config, camId) {
  const widgetId = config.__widgetId;
  const name = streamName(widgetId, camId);
  const key = `snap:${name}`;
  return once(key, async () => {
    const res = await fetch(`${GO2RTC}/api/frame.jpeg?src=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(20_000) }).catch((e) => {
      throw new Error(describeFetchError(e, GO2RTC));
    });
    if (!res.ok) throw new Error(`go2rtc could not grab a frame (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  });
}

export const tapoStreamName = streamName;
