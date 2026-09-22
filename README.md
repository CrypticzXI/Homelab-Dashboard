# Homelab Dashboard

[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/ci.yml)
[![Build & publish image](https://github.com/OWNER/REPO/actions/workflows/release.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/release.yml)

A self-hosted, login-protected dashboard for your homelab. Glassy dark UI, custom background, drag-and-drop widgets, works on phone and desktop.

- **Login** – single user, credentials from `.env`, 30-day session cookie
- **Edit mode** – desktop only (button top-right); add/remove/reorder widgets and sections, upload a background, pick an accent colour
- **Bookmarks** – clickable tiles with logos from [dashboard-icons](https://github.com/homarr-labs/dashboard-icons)
- **50+ widgets** – Docker (start/stop/restart + logs), Server, Proxmox, Portainer, TrueNAS, Glances, Scrutiny, Syncthing, Grafana, Traefik, Nginx Proxy Manager, Uptime Kuma · Pi-hole, AdGuard, Tailscale, Speedtest, UniFi, OPNsense, MikroTik · Plex, Tautulli, Jellyfin/Emby, Scryer, Weaver, Sonarr, Radarr, Lidarr, Readarr, Prowlarr, Bazarr, Jellyseerr/Overseerr, Immich, Audiobookshelf, Komga · qBittorrent, Transmission, Deluge, SABnzbd, NZBGet · Home Assistant (with toggles), Tapo cameras, Frigate · Nextcloud, Paperless-ngx, Gotify, Miniflux, Gitea/Forgejo, Minecraft · Prometheus (any `/metrics`), Weather, Clock, and a *Custom JSON* widget for anything else
- **Uptime monitoring** – every bookmark is pinged each minute; tiles show latency, up/down and a 24h uptime strip; a banner appears when something is down and you can get Discord / Slack / ntfy / Telegram / webhook alerts
- **Liquid Glass UI** – tinted, refractive glass surfaces (tint colour / strength / blur adjustable) over eight themes: Aurora, Cyberpunk, Nord, Catppuccin, Dracula, Gruvbox, OLED black, Light; backgrounds from Bing's image of the day, random photos, a URL or an upload
- **Search** – `/` or `Ctrl+K`, filters tiles live, Enter opens the first match
- **Secrets stay server-side** – API keys/tokens are stored in `data/config.json` on the server and never sent to the browser; the browser only ever talks to the dashboard's own API

## Install on a Linux server

Everything ships as **one container** (nginx, the API, the Tapo bridge and go2rtc, supervised inside the image). Needs Docker with the compose plugin, or Podman with `podman-compose`.

Copy the project to the server and run the installer:

```bash
tar xzf homelab-dashboard-deploy.tar.gz -C ~/homelab-dashboard && cd ~/homelab-dashboard && ./install.sh
```

It detects your container engine, finds the Docker/Podman socket (enabling the rootless Podman socket if needed), asks for a username / password / port / timezone, writes a `.env` with a random session secret, builds the image and starts it — then prints the URL and credentials. First build takes a few minutes.

```bash
./install.sh --update     # rebuild and restart after changing code
./install.sh --systemd    # Podman only: user service so it starts at boot
docker compose logs -f    # or: podman compose logs -f
```

Docker restarts the container on boot by itself (`restart: unless-stopped`).

### Pre-built image (GitHub Actions)

Every push to `main` publishes a multi-arch image (amd64 + arm64) to GHCR, and tagged releases (`v1.2.3`) also get a source tarball. To run the published image instead of building:

```bash
cp .env.example .env                 # set credentials, port, socket
export IMAGE=ghcr.io/<owner>/<repo>:latest
docker compose -f docker-compose.ghcr.yml up -d
```

### Manual alternative

```bash
cp .env.example .env      # set DASH_USER / DASH_PASSWORD / DASH_PORT / CONTAINER_SOCKET
docker compose up -d --build      # or: podman compose up -d --build
```

Open `http://<server>:8080` (or whatever `DASH_PORT` you set), sign in, click **Edit**.

### Docker widget: socket access

`install.sh` sets this for you. To change it later, set `CONTAINER_SOCKET` in `.env`:

| Engine | `CONTAINER_SOCKET` | Before starting |
|---|---|---|
| Docker | `/var/run/docker.sock` (default) | – |
| Podman, rootless | `/run/user/$(id -u)/podman/podman.sock` | `systemctl --user enable --now podman.socket` |
| Podman, rootful | `/run/podman/podman.sock` | `sudo systemctl enable --now podman.socket` |

SELinux hosts (Fedora/RHEL) are handled – the compose file sets `label=disable`. Podman needs `podman-compose` or `docker-compose` installed as the compose provider. If you'd rather not expose the socket at all, point `CONTAINER_SOCKET` at a [docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy).

> **Podman Desktop on Windows/macOS:** the socket lives inside the podman machine, so use the rootless path above (`/run/user/1000/podman/podman.sock`). Run compose from PowerShell, not Git Bash – Git Bash rewrites `/run/...` paths to `C:\Program Files\Git\run\...`. Also set `HOST_ALIAS` to your PC's LAN IP so `localhost` in widget URLs reaches services running on the PC.

### Self-signed certificates

Most homelab services (Proxmox, TrueNAS, UniFi, OPNsense, Portainer…) use self-signed HTTPS. The API accepts those by default; set `ALLOW_SELF_SIGNED=false` in `.env` to require valid certificates.

### Server widget

The host filesystem is mounted read-only at `/host` so disk usage reflects the real machine. In the widget config, list mount points as they are on the host (`/`, `/mnt/media`, …).

### HTTPS

Put your usual reverse proxy (SWAG / Traefik / Caddy) in front of the `web` container. The API sets the `Secure` cookie flag automatically when it sees `X-Forwarded-Proto: https`.

## Widgets & what they need

| Widget | Needs | Notes |
|---|---|---|
| Bookmark | URL | Icon: a dashboard-icons name (`plex`, `proxmox`, `github-light`), an emoji, or an image URL |
| Docker | socket mounted (see above) | Running/stopped counts, per-container CPU & memory |
| Server | – | Host CPU, memory, disks, uptime |
| Plex | Server URL + `X-Plex-Token` | Now playing, library counts, recently-added posters (proxied so the token never leaves the server) |
| Scryer | URL + API key (`ska_…`) | Library counts, 24h activity, download queue, upcoming episodes. GraphQL at `/graphql`, key sent as `Authorization: Bearer` |
| Weaver | URL + API key | Speed, queue counts, active jobs with progress. GraphQL at `/graphql`, key sent as `x-api-key` |
| qBittorrent | WebUI URL + user/pass | Speeds, leeching/seeding counts, active torrents |
| Transmission | URL (+ user/pass) | Same as above via RPC |
| Prometheus | `/metrics` URL (+ auth header) | Pick any metrics by name with label filters, aggregation and formatting. Scryer needs `SCRYER_METRICS=1`; Weaver's is on by default |
| Uptime Kuma | URL + API key | Monitor list with status, response time, expiring certs |
| Proxmox | URL + API token id/secret | Nodes, VMs/LXC with CPU & RAM, storage |
| Pi-hole / AdGuard | URL + password (v6) or API token (v5) / user+pass | Queries, blocked %, clients |
| Sonarr / Radarr | URL + API key | Queue with progress, missing count, this week's calendar |
| Jellyfin / Emby | URL + API key | Now playing, library counts |
| Jellyseerr / Overseerr | URL + API key | Request counts, recent requests |
| Tailscale | API access token | Devices, online/offline, updates available |
| Speedtest Tracker | URL (+ API token) | Latest down/up/ping |
| Home Assistant | URL + long-lived token + entity ids | Sensors as values; switches/lights/fans get a toggle |
| Immich | URL + API key | Photo/video counts, storage |
| Tapo cameras | camera or H200 hub IP + TP-Link cloud password | Cached snapshot, battery %, recent detection events, live view on demand. Needs the `tapo` and `go2rtc` services (included in compose) |
| Prowlarr / Lidarr / Readarr / Bazarr | URL + API key | Indexer stats · queues & missing · wanted subtitles |
| SABnzbd / NZBGet / Deluge | URL + API key or user/pass | Speed, queue with progress, history |
| Tautulli | URL + API key | Plex streams, bandwidth, library sizes |
| Portainer | URL + access token | Environments with running/stopped containers |
| TrueNAS SCALE | URL + API key | Pools with capacity and health, alerts, uptime |
| Glances | URL of a remote host's Glances | CPU / memory / load / temp / disks of other machines |
| Scrutiny | URL | S.M.A.R.T. status, temperature and age per disk |
| Syncthing | URL + API key | Connected devices, folder state and pending bytes |
| Grafana | URL + service-account token | Health and firing alerts |
| Traefik | API URL | Routers / services / middlewares and errors |
| Nginx Proxy Manager | URL + email/password | Proxy hosts, certificates expiring within 14 days |
| UniFi Network | console URL + API key (UniFi OS 9+) | Devices online, clients |
| OPNsense / MikroTik | URL + API credentials | Gateways & updates · CPU, memory, interfaces |
| Nextcloud / Paperless-ngx / Gotify / Miniflux / Gitea / Audiobookshelf / Komga | URL + token | Counts and latest items for each |
| Frigate | URL | Cameras, detection fps, recent events |
| Minecraft | host:port | Native server-list ping — works for LAN servers; players, ping, MOTD |
| Weather | latitude, longitude | Open-Meteo, no key required |
| Clock | optional timezone | |
| Custom JSON | endpoint URL, optional headers, field paths | Show any values from any JSON API, e.g. label `Uptime`, path `data.uptime`, suffix `s` |

### Tapo cameras

Inside the image, a small [pytapo](https://github.com/JurajNyiri/pytapo) bridge handles device info, battery and detection events, and [go2rtc](https://github.com/AlexxIT/go2rtc) (+ ffmpeg) turns the proprietary `tapo://` protocol into a browser-playable stream and JPEG frames. go2rtc is only reachable through nginx, only for signed-in users, and only on its playback endpoints.

- **Before anything works:** Tapo app → **Me → Third-Party Compatibility → On** (TP-Link gates local access behind this since Dec 2024). Then open each camera once in the app on the same Wi-Fi. If it stops working after a firmware update, toggle it off/on again.
- Enter the IP of a camera or of an **H200 hub** (the hub lists its cameras). Log in with your **TP-Link ID email + password** — that's the free Tapo app account, verified locally by the camera; no cloud service or Tapo Care needed. Wired cameras can use a local *Camera Account* instead (Advanced → Camera Account); battery models don't offer one.
- Battery-friendly: cameras are contacted only on page load, at most **once per 10 minutes** (battery, events, and — for mains cameras — a still image, all cached server-side), and while ▶ live view is open. Stop it and go2rtc drops the connection so the camera sleeps.
- **Event photos:** when a refresh sees a new detection, one frame is grabbed and stored against that event under `data/tapo/` (last 50 per camera). They show as thumbnails in the timeline (click to enlarge) and the newest doubles as the tile's idle image. Optional *background watch* keeps checking every 10 min even with no browser open.
- Live view has mute, stop and fullscreen; events show type (person / vehicle / pet / ring / …), time and duration, grouped by day.

**Container controls** are off by default; enable them per Docker widget (edit → "Allow start / stop / restart"). Stop/restart ask for confirmation. Logs open in an overlay and refresh every 5s.

**Alerts** live under Edit → Background & theme → Alerts. Bookmarks are pinged every 60s from the API container; two consecutive failures = down, first success = recovered. History is kept for 24h in `data/uptime.json`.

Every data widget has a **Test connection** button in the editor so you can check credentials before saving. Any widget can have an *Open on click* URL to jump to the service.

## Adding a new widget type

1. `api/src/integrations/` – write `getFoo(config)` returning plain JSON, register it in `index.js` with a cache TTL.
2. `web/src/widgets/` – write a React component that renders it, register it in `index.jsx` with the form fields the editor should show (`secret` fields are redacted automatically).

## Development

```bash
# terminal 1
cd api && DASH_USER=admin DASH_PASSWORD=test DATA_DIR=../data npm run dev
# terminal 2
cd web && npm run dev      # http://localhost:5173, proxies /api to :3001
```

## Layout

```
Dockerfile        single image: nginx + API + Tapo bridge + go2rtc (supervisord)
install.sh        Linux installer / updater
api/              Node/Express API – auth, config, widget fetchers, uploads
web/              Vite + React frontend
tapo-bridge/      pytapo sidecar for Tapo cameras
nginx/ go2rtc/    service configs baked into the image
data/             created at runtime: config.json, session secret, uploads,
                  uptime history, Tapo event photos — back this folder up
```

## Backup

Everything stateful lives in `data/` (dashboard layout, hashed session secret, API keys, uptime history, camera event photos). Copy that folder and your `.env` and you can rebuild anywhere.
