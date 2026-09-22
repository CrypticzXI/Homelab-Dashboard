async function request(method, url, body, isForm = false) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: isForm ? undefined : body ? { 'content-type': 'application/json' } : undefined,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  me: () => request('GET', '/api/auth/me'),
  login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  logout: () => request('POST', '/api/auth/logout'),
  getConfig: () => request('GET', '/api/config'),
  system: () => request('GET', '/api/system'),
  down: () => request('GET', '/api/uptime/down'),
  testAlert: (alerts) => request('POST', '/api/alerts/test', alerts),
  dockerAction: (id, action) => request('POST', `/api/docker/${id}/${action}`),
  dockerLogs: (id, tail) => request('GET', `/api/docker/${id}/logs?tail=${tail}`),
  haAction: (widgetId, entity, action) => request('POST', `/api/widgets/${encodeURIComponent(widgetId)}/ha/${encodeURIComponent(entity)}/${action}`),
  bingWallpapers: () => request('GET', '/api/wallpapers/bing'),
  scryerSearch: (widgetId, op) => request('POST', `/api/widgets/${encodeURIComponent(widgetId)}/scryer-search/${op}`),
  saveConfig: (cfg) => request('PUT', '/api/config', cfg),
  widgetData: (id) => request('GET', `/api/widgets/${encodeURIComponent(id)}/data`),
  testWidget: (draft) => request('POST', '/api/widgets/test', draft),
  uploadBackground: (file) => {
    const fd = new FormData();
    fd.append('image', file);
    return request('POST', '/api/background', fd, true);
  },
};
