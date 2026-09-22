import { fetchJson } from './http.js';
import { getGithub } from './github.js';

/**
 * Generic JSON widget: fetch any URL (with optional headers stored server-side)
 * and pick values out of the response with dot/bracket paths like
 * `data.items[0].count` or `MediaContainer.size`.
 */
function pick(obj, path) {
  if (!path) return obj;
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

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

export async function getGeneric(config) {
  if (!config.endpoint) throw new Error('Endpoint URL is not configured');
  const body = await fetchJson(config.endpoint, { headers: parseHeaders(config.headers) });
  const fields = Array.isArray(config.fields) ? config.fields : [];
  return {
    fields: fields.map((f) => {
      let value = pick(body, f.path);
      if (value != null && typeof value === 'object') value = Array.isArray(value) ? `${value.length} items` : JSON.stringify(value);
      return { label: f.label || f.path, value: value ?? '—', suffix: f.suffix || '' };
    }),
  };
}

/* ---------------- Weather via Open-Meteo (no key needed) ---------------- */

const WMO = {
  0: ['Clear', '☀️'], 1: ['Mostly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
  45: ['Fog', '🌫️'], 48: ['Rime fog', '🌫️'], 51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'],
  61: ['Light rain', '🌧️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'], 66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'],
  71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 77: ['Snow grains', '🌨️'],
  80: ['Showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Violent showers', '⛈️'], 85: ['Snow showers', '🌨️'], 86: ['Snow showers', '❄️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm, hail', '⛈️'], 99: ['Thunderstorm, hail', '⛈️'],
};

export async function getWeather(config) {
  const lat = Number(config.lat), lon = Number(config.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Latitude/longitude are not configured');
  const unit = config.units === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=5&timezone=auto&temperature_unit=${unit}`;
  const d = await fetchJson(url);
  const code = d.current.weather_code;
  return {
    location: config.label || `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
    unit: unit === 'fahrenheit' ? '°F' : '°C',
    temp: Math.round(d.current.temperature_2m),
    feels: Math.round(d.current.apparent_temperature),
    humidity: d.current.relative_humidity_2m,
    wind: Math.round(d.current.wind_speed_10m),
    condition: WMO[code]?.[0] || 'Unknown',
    icon: WMO[code]?.[1] || '🌡️',
    daily: d.daily.time.map((t, i) => ({
      day: new Date(t + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' }),
      icon: WMO[d.daily.weather_code[i]]?.[1] || '🌡️',
      max: Math.round(d.daily.temperature_2m_max[i]),
      min: Math.round(d.daily.temperature_2m_min[i]),
    })),
  };
}

/* ---------------- Bookmark ping (latency + up/down) ---------------- */

/**
 * Probe a service URL. Any HTTP answer (including 401/403 from a login page)
 * counts as "up"; only network failures and 5xx count as down.
 */
export async function getLink(config) {
  // repo stats for github.com bookmarks (cached 15 min; skipped by the uptime monitor)
  const github = config.github === false ? null : await getGithub(config.url, config.token);
  const extra = github ? { github } : {};
  if (config.ping === false) return { ping: false, ...extra };
  const target = (config.pingUrl || config.url || '').trim();
  if (!target) throw new Error('URL is not configured');
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? target : `http://${target}`;
  const started = performance.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    let res;
    try {
      res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: ctrl.signal });
      if (res.status === 405 || res.status === 501) throw new Error('retry-get');
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      res = await fetch(url, { method: 'GET', redirect: 'manual', signal: ctrl.signal });
    }
    const ms = Math.round(performance.now() - started);
    return { ping: true, ok: res.status < 500, status: res.status, ms, ...extra };
  } catch (e) {
    const ms = Math.round(performance.now() - started);
    return { ping: true, ok: false, status: 0, ms, error: e.name === 'AbortError' ? 'timeout' : (e.cause?.code || e.message), ...extra };
  } finally {
    clearTimeout(t);
  }
}
