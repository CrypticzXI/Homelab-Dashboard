import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}

/** Default dashboard shipped on first run so the page isn't empty. */
export const defaultConfig = () => ({
  title: 'Homelab',
  subtitle: 'Everything in one place',
  background: { type: 'gradient', url: '', blur: 0, dim: 45 },
  accent: '#7c5cff',
  topbar: { system: { disks: ['/'] }, showSystem: true },
  sections: [
    {
      id: 'sec-infra',
      title: 'Infrastructure',
      layout: 'grid',
      widgets: [
        { id: 'w-docker', type: 'docker', title: 'Docker', subtitle: 'Containers on this host', w: 2, config: {} },
        { id: 'w-system', type: 'system', title: 'Server', subtitle: 'Host resources', w: 2, config: { disks: ['/'] } },
      ],
    },
    {
      id: 'sec-links',
      title: 'Links',
      layout: 'column',
      widgets: [
        { id: 'b-1', type: 'link', title: 'GitHub', subtitle: 'Code & issues', config: { url: 'https://github.com', icon: 'github-light' } },
        { id: 'b-2', type: 'link', title: 'Docker Hub', subtitle: 'Images', config: { url: 'https://hub.docker.com', icon: 'docker' } },
      ],
    },
    {
      id: 'sec-tools',
      title: 'Tools',
      layout: 'column',
      widgets: [
        { id: 'b-3', type: 'link', title: 'dashboard-icons', subtitle: 'Icon names for tiles', config: { url: 'https://github.com/homarr-labs/dashboard-icons', icon: 'homarr' } },
      ],
    },
  ],
});

/** Keys inside widget.config that must never be sent to the browser. */
export const SECRET_KEYS = new Set(['token', 'apiKey', 'password', 'headers']);

export function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    const cfg = defaultConfig();
    saveConfig(cfg);
    return cfg;
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

export function saveConfig(cfg) {
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, CONFIG_FILE);
}

/** Return a copy of the config with secrets replaced by a marker so the UI can show "set". */
export function redactConfig(cfg) {
  const clone = structuredClone(cfg);
  if (clone.alerts?.webhookUrl) clone.alerts.webhookUrl = '__SECRET__';
  for (const section of clone.sections || []) {
    for (const widget of section.widgets || []) {
      widget.config = widget.config || {};
      for (const key of SECRET_KEYS) {
        if (widget.config[key]) widget.config[key] = '__SECRET__';
      }
    }
  }
  return clone;
}

/**
 * Merge an incoming (possibly redacted) config from the browser with the stored one.
 * Any secret still equal to the marker is restored from the existing widget with the same id.
 */
export function mergeIncomingConfig(existing, incoming) {
  const existingWidgets = new Map();
  for (const section of existing.sections || []) {
    for (const widget of section.widgets || []) existingWidgets.set(widget.id, widget);
  }
  const merged = structuredClone(incoming);
  if (merged.alerts?.webhookUrl === '__SECRET__') merged.alerts.webhookUrl = existing.alerts?.webhookUrl ?? '';
  for (const section of merged.sections || []) {
    for (const widget of section.widgets || []) {
      widget.config = widget.config || {};
      const prev = existingWidgets.get(widget.id);
      for (const key of SECRET_KEYS) {
        if (widget.config[key] === '__SECRET__') {
          widget.config[key] = prev?.config?.[key] ?? '';
        }
      }
    }
  }
  return merged;
}

export function findWidget(cfg, id) {
  for (const section of cfg.sections || []) {
    const w = (section.widgets || []).find((x) => x.id === id);
    if (w) return w;
  }
  return null;
}
