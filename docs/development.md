# Development

[← back to the README](../README.md) · [Widgets](widgets.md) · [Installation](install.md) · [Configuration](configuration.md) · [Cameras](cameras.md)

## Architecture

```
┌─ one container ─────────────────────────────────────────┐
│  nginx   :80    static SPA, /api → API, /go2rtc → go2rtc│
│                 (go2rtc gated behind the login)         │
│  api     :3001  auth, config, widget fetchers, uptime   │
│                 monitor, uploads, container socket      │
│  tapo    :8484  pytapo bridge (device info, events)     │
│  go2rtc  :1984  tapo:// & rtsp:// → MP4/WebRTC/JPEG     │
└─────────────────────────────────────────────────────────┘
                    supervisord
```

```
Dockerfile          single image, multi-stage (web build → API deps → runtime)
supervisord.conf    the four processes
install.sh          Linux installer / updater
api/
  src/server.js         routes, auth gate, static/proxy endpoints
  src/config.js         config load/save, secret redaction
  src/auth.js           login, JWT cookie, throttle
  src/uptime.js         background pinger, history, webhook alerts
  src/integrations/     one module per service
web/
  src/App.jsx           layout, sections, theme/background
  src/components/       TopBar, Section, WidgetCard, editors
  src/widgets/          one component per widget type + registry
  src/styles.css        base design system
  src/glass.css         Liquid Glass layer
tapo-bridge/server.py   pytapo HTTP bridge
docs/                   these docs + screenshots
```

## Running locally

```bash
# terminal 1 — API
cd api && DASH_USER=admin DASH_PASSWORD=test DATA_DIR=../data npm run dev

# terminal 2 — frontend (Vite proxies /api to :3001)
cd web && npm run dev            # http://localhost:5173
```

Camera widgets need go2rtc and the Tapo bridge, which only run in the container — use the full container for those.

## How a widget works

1. The browser polls `GET /api/widgets/:id/data`.
2. The API looks the widget up in the saved config, finds its type in `WIDGET_TYPES`, and calls the fetcher with the widget's config (secrets included — they never leave the server).
3. The result is cached server-side for the type's TTL, so ten open tabs still only hit the service once per TTL.
4. The React component renders it.

Secrets are redacted on the way out (`__SECRET__`) and restored on save by matching the widget id, so editing a widget never requires re-entering keys.

## Adding a widget

**1. Backend** — `api/src/integrations/myservice.js`:

```js
import { baseUrl, fetchJson } from './http.js';

export async function getMyService(config) {
  if (!config.apiKey) throw new Error('API key is not configured');
  const url = baseUrl(config.url);                 // adds http://, maps localhost → host
  const data = await fetchJson(`${url}/api/status`, {
    headers: { 'X-Api-Key': config.apiKey },
  });
  return {                                          // standard widget shape
    stats: [{ label: 'Items', value: data.count, tone: 'ok' }],
    meters: [{ label: 'Disk', value: '40 / 100 GB', pct: 40 }],
    rows: [{ name: 'thing', sub: 'detail', value: '3', dot: 'ok', pct: 50 }],
    chips: [{ text: 'healthy', tone: 'ok' }],
    note: 'footnote',
    version: data.version,
  };
}
```

Register it in `api/src/integrations/index.js`:

```js
myservice: { fetch: getMyService, ttl: 15_000 },
```

**2. Frontend** — add to `web/src/widgets/apps.js` to reuse the standard renderer:

```js
myservice: def('myservice', 'My Service', 'What it shows.', [
  url('Service URL', 'http://192.168.1.10:8080'),
  key('API key', 'Settings → API'),
  max('Rows', 6),
]),
```

Then add the type id to a category in `CATEGORIES` (`web/src/widgets/index.jsx`) so it shows in the picker. For a custom layout, write a component and register it directly in `WIDGETS` instead.

**Field kinds:** `text`, `url`, `number`, `select`, `checkbox`, `list`, `secret`, `secret-textarea`, `fields`, `metrics`. Anything `secret` is redacted automatically.

## Error handling conventions

- Throw with a human sentence — it's shown on the card. `describeFetchError()` turns Node's `fetch failed` into "Connection refused by host:port".
- Prefer degrading over failing: if one sub-request fails, return what you have and put the problem in `note` or a warning line.
- Anything that hits a rate limit or a sleeping device should be cached generously.

## CI

`.github/workflows/ci.yml` runs on every push and PR:

- web build, API syntax check (`node --check`), Python compile, `bash -n install.sh`
- **`.github/scan-secrets.sh`** — fails on literal credentials in URLs, Scryer/GitHub/Plex/Tailscale key formats, private keys, bare 64-char hashes, a committed `.env` or `data/config.json`
- a no-push Docker build

`.github/workflows/release.yml` builds and pushes a multi-arch image to GHCR on `main` and on `v*` tags, with build provenance attestation; tags also get a source tarball attached to the release.

## Screenshots

The images in `docs/img/` are captured from a demo dashboard with Playwright at 2× and downscaled to WebP. No personal data appears in them.
