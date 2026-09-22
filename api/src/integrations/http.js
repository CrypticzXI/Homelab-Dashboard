/** Small fetch helpers shared by the integrations. */

/** Hostname that reaches the machine running the containers (see extra_hosts in docker-compose.yml). */
export const HOST_ALIAS = process.env.HOST_ALIAS || 'host.docker.internal';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

/**
 * Normalise a user-entered service URL:
 *  - add http:// when the scheme is missing ("192.168.1.10:8080")
 *  - "localhost"/"127.0.0.1" inside the container would be the container itself,
 *    so point those at the host machine instead
 */
export function baseUrl(url) {
  if (!url || !String(url).trim()) throw new Error('URL is not configured');
  let raw = String(url).trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'http://' + raw;
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`Invalid URL "${url}"`);
  }
  if (LOOPBACK.has(u.hostname)) u.hostname = HOST_ALIAS;
  return u.toString().replace(/\/+$/, '');
}

/** Node wraps network failures as "fetch failed" with the useful bit in `cause`. */
export function describeFetchError(e, url) {
  if (e.name === 'AbortError') return `Timed out connecting to ${url}`;
  const c = e.cause || e;
  const code = c.code || '';
  let host = (() => { try { return new URL(url).host; } catch { return url; } })();
  if (host.startsWith(HOST_ALIAS)) host += ' (localhost mapped to the host machine)';
  if (code === 'ECONNREFUSED') return `Connection refused by ${host}`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `Could not resolve host ${host}`;
  if (code === 'ETIMEDOUT') return `Timed out connecting to ${host}`;
  if (code === 'ECONNRESET') return `Connection reset by ${host}`;
  if (/certificate|self.signed|SSL/i.test(c.message || '')) return `TLS error for ${host}: ${c.message}`;
  return c.message && c.message !== 'fetch failed' ? c.message : `Could not reach ${host}${code ? ` (${code})` : ''}`;
}

export async function fetchJson(url, opts = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetch(url, { ...opts, signal: ctrl.signal });
    } catch (e) {
      throw new Error(describeFetchError(e, url));
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}${text ? ': ' + text.slice(0, 200) : ''}`);
    }
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw new Error('Response was not JSON');
    }
  } finally {
    clearTimeout(t);
  }
}

export async function graphql(url, query, variables, headers) {
  const body = await fetchJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify({ query, variables }),
  });
  if (body?.errors?.length && !body.data) {
    throw new Error(body.errors.map((e) => e.message).join('; '));
  }
  return { data: body?.data || {}, errors: body?.errors || [] };
}

/** Tiny TTL cache so a page full of widgets refreshing doesn't hammer services. */
const cache = new Map();
export async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, exp: Date.now() + ttlMs });
  return value;
}
export function invalidate(prefix) {
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}
