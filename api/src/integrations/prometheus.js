import { baseUrl, describeFetchError, cached } from './http.js';

/* ---------------- Prometheus text exposition parser ---------------- */

/** Parse `name{label="v",...} value [ts]` lines into samples. `# HELP` text is kept per family. */
export function parsePrometheus(text) {
  const samples = [];
  const help = {};
  const types = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const m = /^# (HELP|TYPE) (\S+) (.*)$/.exec(line);
      if (m) (m[1] === 'HELP' ? help : types)[m[2]] = m[3];
      continue;
    }
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)(?:\s+(\S+))?$/.exec(line);
    if (!m) continue;
    const labels = {};
    if (m[2]) {
      for (const lm of m[2].slice(1, -1).matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) {
        labels[lm[1]] = lm[2].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
      }
    }
    const v = m[3];
    const value = v === '+Inf' ? Infinity : v === '-Inf' ? -Infinity : v === 'NaN' ? NaN : Number(v);
    samples.push({ name: m[1], labels, value });
  }
  return { samples, help, types };
}

/** Parse a label matcher like `{indexer="foo", kind=~"a|b"}` or `indexer="foo"`. */
export function parseMatcher(src) {
  const out = [];
  if (!src) return out;
  for (const m of String(src).matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*(=~|!=|=)\s*"([^"]*)"/g)) {
    out.push({ key: m[1], op: m[2], value: m[3], re: m[2] === '=~' ? new RegExp(`^(?:${m[3]})$`) : null });
  }
  return out;
}

export function matches(sample, matchers) {
  return matchers.every(({ key, op, value, re }) => {
    const v = sample.labels[key] ?? '';
    if (op === '=') return v === value;
    if (op === '!=') return v !== value;
    return re.test(v);
  });
}

/** Select samples by exact metric name + optional matcher string. */
export function select(parsed, name, matcher) {
  const ms = parseMatcher(matcher);
  return parsed.samples.filter((s) => s.name === name && matches(s, ms));
}

export function aggregate(samples, agg = 'sum') {
  const vals = samples.map((s) => s.value).filter((v) => Number.isFinite(v));
  if (!vals.length) return null;
  switch (agg) {
    case 'max': return Math.max(...vals);
    case 'min': return Math.min(...vals);
    case 'avg': return vals.reduce((a, b) => a + b, 0) / vals.length;
    case 'count': return vals.length;
    case 'first': return vals[0];
    default: return vals.reduce((a, b) => a + b, 0);
  }
}

/* ---------------- scraping ---------------- */

function parseHeaders(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  const out = {};
  for (const line of String(raw).split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export async function scrape(url, headers = {}, timeoutMs = 10_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetch(url, { headers: { accept: 'text/plain', ...headers }, signal: ctrl.signal });
    } catch (e) {
      throw new Error(describeFetchError(e, url));
    }
    if (res.status === 404) throw new Error('No /metrics endpoint (404) — metrics may be disabled in the app');
    if (res.status === 401 || res.status === 403) throw new Error(`Metrics endpoint refused the key (HTTP ${res.status})`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parsePrometheus(await res.text());
  } finally {
    clearTimeout(t);
  }
}

/** Cached scrape keyed by URL so several widgets on one endpoint share a fetch. */
export const scrapeCached = (url, headers, ttl = 15_000) =>
  cached(`prom:${url}:${JSON.stringify(headers)}`, ttl, () => scrape(url, headers));

/* ---------------- value formatting ---------------- */

const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
export function formatValue(v, format) {
  if (v == null || Number.isNaN(v)) return '—';
  switch (format) {
    case 'bytes': {
      let i = 0, n = Math.abs(v);
      while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
      return `${(v < 0 ? '-' : '')}${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }
    case 'percent': return `${(v <= 1 ? v * 100 : v).toFixed(1)}%`;
    case 'seconds': return formatDuration(v);
    case 'ago': return formatDuration(Date.now() / 1000 - v) + ' ago';
    case 'until': return 'in ' + formatDuration(v - Date.now() / 1000);
    case 'bool': return v ? 'yes' : 'no';
    case 'raw': return String(v);
    default: return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
}
function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(sec)}s`;
}

/* ---------------- generic Prometheus widget ---------------- */

/**
 * config.endpoint  – full /metrics URL
 * config.headers   – "Authorization: Bearer xxx" lines (secret, server-side)
 * config.metrics   – [{ label, name, match, agg, format }]
 */
export async function getPrometheus(config) {
  if (!config.endpoint) throw new Error('Metrics URL is not configured');
  const url = baseUrl(config.endpoint);
  const parsed = await scrapeCached(url, parseHeaders(config.headers));
  const rows = Array.isArray(config.metrics) ? config.metrics : [];
  return {
    families: parsed.samples.length ? new Set(parsed.samples.map((s) => s.name)).size : 0,
    fields: rows
      .filter((r) => r.name)
      .map((r) => {
        const v = aggregate(select(parsed, r.name.trim(), r.match), r.agg || 'sum');
        return { label: r.label || r.name, value: formatValue(v, r.format), raw: v };
      }),
    // handy for the editor's "Test connection": a few metric names to pick from
    sampleNames: [...new Set(parsed.samples.map((s) => s.name))].filter((n) => !/_bucket$|_sum$|_count$/.test(n)).slice(0, 60),
  };
}

/** Group samples of one metric by a label, returning [{ key, value }]. */
export function byLabel(parsed, name, label) {
  return select(parsed, name).map((s) => ({ key: s.labels[label] ?? Object.values(s.labels)[0] ?? name, labels: s.labels, value: s.value }));
}
