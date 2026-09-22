import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, loadConfig } from './config.js';
import { getLink } from './integrations/generic.js';

/**
 * Background uptime monitor for bookmark tiles.
 *
 * Every INTERVAL it pings every link widget that has ping enabled and appends
 * {t, ok, ms} to a per-widget ring buffer (24h). State changes (after
 * DOWN_AFTER consecutive failures) fire a webhook if one is configured under
 * config.alerts. History is persisted to data/uptime.json.
 */
const INTERVAL = 60_000;
const KEEP_MS = 24 * 3600_000;
const DOWN_AFTER = 2;
const FILE = path.join(DATA_DIR, 'uptime.json');

const history = new Map(); // id -> [{t, ok, ms}]
const state = new Map(); // id -> { down: bool, fails: number, since: ts }
let timer = null;

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const [id, arr] of Object.entries(raw.history || {})) history.set(id, arr);
    for (const [id, st] of Object.entries(raw.state || {})) state.set(id, st);
  } catch {
    /* first run */
  }
}
let dirty = false;
function save() {
  if (!dirty) return;
  dirty = false;
  const out = { history: Object.fromEntries(history), state: Object.fromEntries(state) };
  try {
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(out));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (e) {
    console.error('uptime save failed', e.message);
  }
}

function linkWidgets(cfg) {
  const out = [];
  for (const s of cfg.sections || []) for (const w of s.widgets || []) if (w.type === 'link' && w.config?.ping !== false && (w.config?.url || w.config?.pingUrl)) out.push(w);
  return out;
}

async function tick() {
  const cfg = loadConfig();
  const widgets = linkWidgets(cfg);
  const ids = new Set(widgets.map((w) => w.id));
  for (const id of history.keys()) if (!ids.has(id)) { history.delete(id); state.delete(id); dirty = true; }

  await Promise.all(
    widgets.map(async (w) => {
      let r;
      try {
        r = await getLink({ ...w.config, github: false });
      } catch (e) {
        r = { ok: false, ms: 0, error: e.message };
      }
      const now = Date.now();
      const arr = history.get(w.id) || [];
      arr.push({ t: now, ok: !!r.ok, ms: r.ms ?? 0 });
      while (arr.length && arr[0].t < now - KEEP_MS) arr.shift();
      history.set(w.id, arr);
      dirty = true;

      const st = state.get(w.id) || { down: false, fails: 0, since: null };
      if (r.ok) {
        if (st.down) {
          st.down = false;
          st.since = now;
          notify(cfg, w, 'up', r).catch(() => {});
        }
        st.fails = 0;
      } else {
        st.fails++;
        if (!st.down && st.fails >= DOWN_AFTER) {
          st.down = true;
          st.since = now;
          notify(cfg, w, 'down', r).catch(() => {});
        }
      }
      state.set(w.id, st);
    }),
  );
  save();
}

/* ---------------- alerts ---------------- */

/** Work out the webhook flavour from its URL when the user hasn't picked one. */
function detectType(a) {
  if (a.type && a.type !== 'auto') return a.type;
  const u = a.webhookUrl || '';
  if (/discord(app)?\.com\/api\/webhooks/i.test(u)) return 'discord';
  if (/hooks\.slack\.com/i.test(u)) return 'slack';
  if (/api\.telegram\.org\/bot/i.test(u)) return 'telegram';
  if (/ntfy\./i.test(u)) return 'ntfy';
  return 'generic';
}

async function notify(cfg, widget, kind, r) {
  const a = cfg.alerts || {};
  if (!a.enabled || !a.webhookUrl) return;
  const title = `${widget.title} is ${kind.toUpperCase()}`;
  const detail = kind === 'down' ? `Ping failed (${r.error || `HTTP ${r.status}`}) — ${widget.config.pingUrl || widget.config.url}` : `Back up after outage (${r.ms} ms)`;
  const emoji = kind === 'down' ? '🔴' : '🟢';
  let body, headers = { 'content-type': 'application/json' };
  switch (detectType(a)) {
    case 'discord':
      body = JSON.stringify({ username: cfg.title || 'Homelab', embeds: [{ title: `${emoji} ${title}`, description: detail, color: kind === 'down' ? 0xf87171 : 0x34d399 }] });
      break;
    case 'slack':
      body = JSON.stringify({ text: `${emoji} *${title}*\n${detail}` });
      break;
    case 'ntfy':
      headers = { 'content-type': 'text/plain', title, priority: kind === 'down' ? '4' : '3', tags: kind === 'down' ? 'red_circle' : 'green_circle' };
      body = detail;
      break;
    case 'telegram': // webhookUrl = https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>
      body = JSON.stringify({ text: `${emoji} ${title}\n${detail}` });
      break;
    default: // generic JSON
      body = JSON.stringify({ event: kind, title, detail, widget: widget.title, url: widget.config.url, at: new Date().toISOString() });
  }
  let res;
  try {
    res = await fetch(a.webhookUrl, { method: 'POST', headers, body });
  } catch (e) {
    throw new Error(`Could not reach webhook: ${e.cause?.code || e.message}`);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`Webhook returned HTTP ${res.status}${text ? `: ${text}` : ''}`);
  }
}

/** Send a test notification with the given alert settings (used by the settings modal). */
export async function testAlert(alerts, dashTitle) {
  const fake = { title: 'Test service', config: { url: 'https://example.com' } };
  await notify({ alerts: { ...alerts, enabled: true }, title: dashTitle }, fake, 'down', { status: 0, error: 'this is a test', ms: 0 });
}

/* ---------------- queries ---------------- */

/** 24h history compressed into `buckets` slots: each { ok: 0..1 ratio, ms avg, n } plus summary. */
export function summary(id, buckets = 48) {
  const arr = history.get(id) || [];
  const now = Date.now();
  const span = KEEP_MS / buckets;
  const out = Array.from({ length: buckets }, () => ({ n: 0, up: 0, ms: 0 }));
  for (const p of arr) {
    const i = Math.min(buckets - 1, Math.max(0, Math.floor((p.t - (now - KEEP_MS)) / span)));
    const b = out[i];
    b.n++;
    if (p.ok) b.up++;
    b.ms += p.ms;
  }
  const total = arr.length;
  const ups = arr.filter((p) => p.ok).length;
  const st = state.get(id) || { down: false, since: null };
  return {
    buckets: out.map((b) => ({ n: b.n, ok: b.n ? b.up / b.n : null, ms: b.n ? Math.round(b.ms / b.n) : null })),
    uptime: total ? +((ups / total) * 100).toFixed(2) : null,
    avgMs: ups ? Math.round(arr.filter((p) => p.ok).reduce((a, p) => a + p.ms, 0) / ups) : null,
    samples: total,
    down: st.down,
    since: st.since,
  };
}

export function downList(cfg) {
  const out = [];
  for (const w of linkWidgets(cfg)) {
    const st = state.get(w.id);
    if (st?.down) out.push({ id: w.id, title: w.title, since: st.since, url: w.config.url });
  }
  return out;
}

export function start() {
  load();
  tick().catch(() => {});
  timer = setInterval(() => tick().catch(() => {}), INTERVAL);
  timer.unref?.();
}
