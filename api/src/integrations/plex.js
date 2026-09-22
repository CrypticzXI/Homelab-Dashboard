import { baseUrl, fetchJson } from './http.js';

const headers = (token) => ({
  accept: 'application/json',
  'X-Plex-Token': token,
  'X-Plex-Client-Identifier': 'homelab-dashboard',
  'X-Plex-Product': 'Homelab Dashboard',
});

function requireToken(config) {
  if (!config.token) throw new Error('Plex token is not configured');
}

export async function getPlex(config) {
  requireToken(config);
  const url = baseUrl(config.url);
  const h = headers(config.token);

  const [identity, sessions, sections] = await Promise.all([
    fetchJson(`${url}/identity`, { headers: h }),
    fetchJson(`${url}/status/sessions`, { headers: h }),
    fetchJson(`${url}/library/sections`, { headers: h }),
  ]);

  const libs = sections?.MediaContainer?.Directory || [];
  const libraries = await Promise.all(
    libs.map(async (lib) => {
      try {
        const r = await fetchJson(
          `${url}/library/sections/${lib.key}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=0`,
          { headers: h },
        );
        return { key: lib.key, title: lib.title, type: lib.type, count: r?.MediaContainer?.totalSize ?? 0 };
      } catch {
        return { key: lib.key, title: lib.title, type: lib.type, count: null };
      }
    }),
  );

  const nowPlaying = (sessions?.MediaContainer?.Metadata || []).map((m) => ({
    title: m.grandparentTitle ? `${m.grandparentTitle} — ${m.title}` : m.title,
    subtitle:
      m.type === 'episode'
        ? `S${String(m.parentIndex).padStart(2, '0')}E${String(m.index).padStart(2, '0')}`
        : m.year
          ? String(m.year)
          : '',
    user: m.User?.title,
    player: m.Player?.title || m.Player?.product,
    state: m.Player?.state,
    progress: m.duration ? Math.round(((m.viewOffset || 0) / m.duration) * 100) : 0,
    thumb: m.grandparentThumb || m.parentThumb || m.thumb || null,
    type: m.type,
  }));

  let recent = [];
  if (config.recent !== false) {
    try {
      const r = await fetchJson(`${url}/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=8`, {
        headers: h,
      });
      recent = (r?.MediaContainer?.Metadata || []).map((m) => ({
        title: m.grandparentTitle || m.parentTitle || m.title,
        subtitle: m.type === 'season' ? m.title : m.year ? String(m.year) : '',
        thumb: m.grandparentThumb || m.parentThumb || m.thumb || null,
        addedAt: m.addedAt,
      }));
    } catch {
      /* optional */
    }
  }

  return {
    server: identity?.MediaContainer?.version ? `Plex ${identity.MediaContainer.version}` : 'Plex',
    libraries,
    nowPlaying,
    recent,
  };
}

/** Proxy a Plex image so the token never reaches the browser. */
export async function plexImage(config, thumbPath, width = 240) {
  requireToken(config);
  const url = baseUrl(config.url);
  const inner = encodeURIComponent(thumbPath);
  const target = `${url}/photo/:/transcode?width=${width}&height=${width * 1.5}&minSize=1&upscale=1&url=${inner}`;
  return fetch(target, { headers: headers(config.token) });
}
