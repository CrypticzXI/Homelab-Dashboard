import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { login, logout, requireAuth } from './auth.js';
import { loadConfig, saveConfig, redactConfig, mergeIncomingConfig, findWidget, UPLOAD_DIR } from './config.js';
import { fetchWidgetData, WIDGET_TYPES } from './integrations/index.js';
import { plexImage } from './integrations/plex.js';
import { invalidate, cached } from './integrations/http.js';
import { getSystem } from './integrations/system.js';
import { dockerAction, dockerLogs } from './integrations/docker.js';
import { homeAssistantAction } from './integrations/services.js';
import { startScryerSearch, cancelScryerSearch, clearScryerSearch } from './integrations/scryerWanted.js';
import { getTapoSnapshot, getTapo, tapoStreamName, eventPhotoPath } from './integrations/tapo.js';
import { start as startUptime, downList, testAlert } from './uptime.js';

// Homelab services (Proxmox, TrueNAS, UniFi, OPNsense…) mostly run self-signed certs.
// Default on; set ALLOW_SELF_SIGNED=false to require valid certificates.
if ((process.env.ALLOW_SELF_SIGNED || 'true').toLowerCase() !== 'false') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const api = express.Router();

/* ---- auth ---- */
api.post('/auth/login', login);
api.post('/auth/logout', logout);
api.get('/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

/* everything below needs a session */
api.use(requireAuth);

/* ---- config ---- */
api.get('/config', (_req, res) => res.json(redactConfig(loadConfig())));

api.put('/config', (req, res) => {
  const incoming = req.body;
  if (!incoming || !Array.isArray(incoming.sections)) return res.status(400).json({ error: 'Invalid config' });
  const merged = mergeIncomingConfig(loadConfig(), incoming);
  saveConfig(merged);
  invalidate('widget:');
  res.json(redactConfig(merged));
});

/** Host summary for the top bar (CPU / RAM / disk / uptime). */
api.get('/system', async (_req, res) => {
  const cfg = loadConfig();
  try {
    const data = await cached('topbar:system', 4000, () => getSystem(cfg.topbar?.system || {}));
    res.json({ ok: true, data });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

/* ---- uptime monitor ---- */
api.get('/uptime/down', (_req, res) => res.json({ down: downList(loadConfig()) }));
api.post('/alerts/test', async (req, res) => {
  try {
    const cfg = loadConfig();
    const alerts = { ...(req.body || {}) };
    if (alerts.webhookUrl === '__SECRET__') alerts.webhookUrl = cfg.alerts?.webhookUrl || '';
    await testAlert(alerts, cfg.title);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

/* ---- container controls (only when a Docker widget has controls enabled) ---- */
function controlsEnabled() {
  const cfg = loadConfig();
  return (cfg.sections || []).some((s) => (s.widgets || []).some((w) => w.type === 'docker' && w.config?.controls === true));
}
api.post('/docker/:id/:action', async (req, res) => {
  if (!controlsEnabled()) return res.status(403).json({ error: 'Container controls are disabled' });
  try {
    res.json(await dockerAction(req.params.id, req.params.action));
    invalidate('widget:');
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
api.get('/docker/:id/logs', async (req, res) => {
  if (!controlsEnabled()) return res.status(403).json({ error: 'Container controls are disabled' });
  try {
    res.json(await dockerLogs(req.params.id, Number(req.query.tail) || 200));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ---- Home Assistant entity actions ---- */
api.post('/widgets/:id/ha/:entity/:action', async (req, res) => {
  const widget = findWidget(loadConfig(), req.params.id);
  if (!widget || widget.type !== 'homeassistant') return res.status(404).json({ error: 'Widget not found' });
  if (widget.config?.controls === false) return res.status(403).json({ error: 'Controls disabled for this widget' });
  try {
    res.json(await homeAssistantAction(widget.config, req.params.entity, req.params.action));
    invalidate(`widget:${widget.id}`);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ---- Scryer mass search (start / cancel / clear report) ---- */
api.post('/widgets/:id/scryer-search/:op', async (req, res) => {
  const widget = findWidget(loadConfig(), req.params.id);
  if (!widget || widget.type !== 'scryerwanted') return res.status(404).json({ error: 'Widget not found' });
  try {
    const op = req.params.op;
    const r =
      op === 'start' ? await startScryerSearch(widget.id, widget.config) : op === 'cancel' ? await cancelScryerSearch(widget.id, widget.config) : op === 'clear' ? clearScryerSearch(widget.id) : null;
    if (!r) return res.status(400).json({ error: 'Unknown operation' });
    invalidate(`widget:${widget.id}`);
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/* ---- Tapo camera snapshot (cached 10 min; taking one wakes the camera) ---- */
api.get('/widgets/:id/tapo/:cam/snapshot', async (req, res) => {
  const widget = findWidget(loadConfig(), req.params.id);
  if (!widget || widget.type !== 'tapo') return res.status(404).end();
  try {
    const buf = await getTapoSnapshot({ ...(widget.config || {}), __widgetId: widget.id }, req.params.cam);
    res.set('content-type', 'image/jpeg');
    res.set('cache-control', 'private, max-age=600');
    res.send(buf);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* ---- Tapo stored event photos ---- */
api.get('/widgets/:id/tapo/:cam/event/:start.jpg', (req, res) => {
  const widget = findWidget(loadConfig(), req.params.id);
  if (!widget || widget.type !== 'tapo') return res.status(404).end();
  const file = eventPhotoPath(tapoStreamName(widget.id, req.params.cam), Number(req.params.start));
  if (!file || !fs.existsSync(file)) return res.status(404).end();
  res.set('cache-control', 'private, max-age=86400');
  res.sendFile(file);
});

/* Background watch: poll Tapo widgets that opted in, so event photos are captured
   even when nobody has the dashboard open. Same 10-minute floor as page loads. */
setInterval(() => {
  const cfg = loadConfig();
  for (const s of cfg.sections || []) {
    for (const w of s.widgets || []) {
      if (w.type === 'tapo' && w.config?.watch === true) getTapo({ ...w.config, __widgetId: w.id }).catch(() => {});
    }
  }
}, 10 * 60_000).unref();

/* ---- wallpapers (Bing daily images, proxied because bing.com has no CORS) ---- */
api.get('/wallpapers/bing', async (_req, res) => {
  try {
    const data = await cached('wallpapers:bing', 3600_000, async () => {
      const r = await fetch('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=en-GB');
      const j = await r.json();
      return (j.images || []).map((i) => ({
        url: `https://www.bing.com${i.urlbase}_UHD.jpg`,
        thumb: `https://www.bing.com${i.urlbase}_320x240.jpg`,
        title: i.title || i.copyright,
      }));
    });
    res.json({ images: data });
  } catch (e) {
    res.json({ images: [], error: e.message });
  }
});

api.get('/widget-types', (_req, res) => res.json(Object.keys(WIDGET_TYPES)));

/* ---- widget data ---- */
api.get('/widgets/:id/data', async (req, res) => {
  const widget = findWidget(loadConfig(), req.params.id);
  if (!widget) return res.status(404).json({ error: 'Widget not found' });
  try {
    res.json({ ok: true, data: await fetchWidgetData(widget), at: Date.now() });
  } catch (e) {
    res.json({ ok: false, error: e.message || String(e), at: Date.now() });
  }
});

/** Test a widget config from the editor before saving (secrets may be the redaction marker). */
api.post('/widgets/test', async (req, res) => {
  const draft = req.body;
  if (!draft?.type || !WIDGET_TYPES[draft.type]) return res.status(400).json({ error: 'Unknown widget type' });
  const cfg = loadConfig();
  const prev = draft.id ? findWidget(cfg, draft.id) : null;
  const config = { ...(draft.config || {}) };
  for (const k of Object.keys(config)) if (config[k] === '__SECRET__') config[k] = prev?.config?.[k] ?? '';
  try {
    res.json({ ok: true, data: await WIDGET_TYPES[draft.type].fetch(config) });
  } catch (e) {
    res.json({ ok: false, error: e.message || String(e) });
  }
});

/* ---- plex image proxy ---- */
api.get('/widgets/:id/plex-image', async (req, res) => {
  const widget = findWidget(loadConfig(), req.params.id);
  if (!widget || widget.type !== 'plex') return res.status(404).end();
  const thumb = String(req.query.path || '');
  if (!thumb.startsWith('/')) return res.status(400).end();
  try {
    const upstream = await plexImage(widget.config, thumb, Number(req.query.w) || 240);
    if (!upstream.ok) return res.status(upstream.status).end();
    res.set('content-type', upstream.headers.get('content-type') || 'image/jpeg');
    res.set('cache-control', 'private, max-age=3600');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.status(502).end();
  }
});

/* ---- background upload ---- */
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
      cb(null, `bg-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimetype)),
});

api.post('/background', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded (jpeg/png/webp/gif/avif, max 25MB)' });
  // remove previous uploads so the data dir doesn't grow forever
  for (const f of fs.readdirSync(UPLOAD_DIR)) {
    if (f.startsWith('bg-') && f !== req.file.filename) fs.rmSync(path.join(UPLOAD_DIR, f), { force: true });
  }
  const cfg = loadConfig();
  cfg.background = { ...(cfg.background || {}), type: 'upload', url: `/api/background/${req.file.filename}` };
  saveConfig(cfg);
  res.json({ url: cfg.background.url });
});

api.get('/background/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const full = path.join(UPLOAD_DIR, file);
  if (!file.startsWith('bg-') || !fs.existsSync(full)) return res.status(404).end();
  res.set('cache-control', 'private, max-age=86400');
  res.sendFile(full);
});

app.use('/api', api);
app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
  startUptime();
});
