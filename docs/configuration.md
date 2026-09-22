# Configuration

[← back to the README](../README.md) · [Widgets](widgets.md) · [Installation](install.md) · [Cameras](cameras.md) · [Development](development.md)

## Environment variables

All configuration lives in `.env` (see [`.env.example`](../.env.example)).

| Variable | Default | What it does |
|---|---|---|
| `DASH_USER` | `admin` | Login username |
| `DASH_PASSWORD` | `change-me` | Login password (hashed at startup, never stored in plain text on disk) |
| `DASH_PORT` | `8080` | Host port to publish |
| `SESSION_SECRET` | generated | Cookie signing key; if unset, one is generated into `data/secret` |
| `CONTAINER_SOCKET` | `/var/run/docker.sock` | Docker/Podman API socket for the Docker widget |
| `HOST_ALIAS` | `host.docker.internal` | What `localhost` / `127.0.0.1` in a widget URL is rewritten to |
| `ALLOW_SELF_SIGNED` | `true` | Accept self-signed HTTPS certs on the services you add |
| `GITHUB_TOKEN` | – | Raises GitHub API limits for bookmark repo stats |
| `TZ` | `UTC` | Timezone for logs and event timestamps |

Changing `.env` needs a restart: `docker compose up -d`.

The compose file reads every one of these from `.env`, so it rarely needs editing itself. Building from source? Use `docker-compose.build.yml` instead — same variables.

## Container socket

| Engine | `CONTAINER_SOCKET` | Enable first |
|---|---|---|
| Docker | `/var/run/docker.sock` | – |
| Podman, rootless | `/run/user/$(id -u)/podman/podman.sock` | `systemctl --user enable --now podman.socket` |
| Podman, rootful | `/run/podman/podman.sock` | `sudo systemctl enable --now podman.socket` |

SELinux hosts are handled — the compose file sets `label=disable` on the service. If you'd rather not expose the socket directly, point `CONTAINER_SOCKET` at a [docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy) and leave container controls off.

## Reaching services on the same machine

Inside the container, `localhost` is the container itself. Type `localhost:8096` into a widget and it's rewritten to `HOST_ALIAS`, which the installer sets to your LAN IP. On Docker/Podman under Linux the default `host.docker.internal` alias also works; on Podman Desktop for Windows/macOS it points at the Podman VM rather than your machine, so set the LAN IP explicitly.

## Themes and appearance

**Edit → Background & theme**:

- **Look** — title/subtitle, one of 8 themes, accent override, **glass tint colour**, **tint strength** (0–40%) and **blur** (6–60px), host-stats toggle
- **Background** — animated aurora, Bing image of the day (with a picker of the last 8), random photo (seeded), an image URL, or an upload; plus dim and blur sliders
- **Alerts** — see below

Glass looks best over a real wallpaper with dim around 30–50% and a little blur.

## Uptime monitoring and alerts

Every bookmark with ping enabled is checked from the server each minute. History is kept for 24 hours in `data/uptime.json` and drawn as the strip under each tile.

Two consecutive failures mark a service **down**: a red banner appears at the top of the dashboard, and if alerts are enabled a notification is sent. Recovery sends a follow-up.

| Service | Webhook URL |
|---|---|
| Discord | `https://discord.com/api/webhooks/…` |
| Slack | `https://hooks.slack.com/services/…` |
| ntfy | `https://ntfy.sh/your-topic` |
| Telegram | `https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>` |
| Generic | any URL — receives a JSON body |

The type is detected from the URL, or you can pick it. There's a **Send test** button, and the URL is stored server-side like any other secret.

## Container controls

Off by default. Enable per Docker widget (*Allow start / stop / restart and log viewing*). Then each row gets logs / restart / stop / start buttons; stop and restart ask for confirmation. The API refuses these calls unless a widget has the option enabled.

## HTTPS

Put your usual reverse proxy (SWAG, Traefik, Caddy, Nginx Proxy Manager) in front of the container. The API sets the `Secure` flag on the session cookie automatically when it sees `X-Forwarded-Proto: https`.

The dashboard is single-user by design — don't expose it to the internet without HTTPS and ideally an auth layer in front.

## Backup

Everything stateful is in `data/`:

```
data/config.json     dashboard layout + API keys  ← treat as a secret
data/secret          session signing key
data/uptime.json     24h ping history
data/uploads/        uploaded background image
data/tapo/           camera event photos + index
```

Copy `data/` and `.env` and you can rebuild anywhere:

```bash
tar czf homelab-dashboard-backup-$(date +%F).tar.gz data .env
```

To move an existing dashboard to a new server, copy `data/config.json` into place **before** the first start — otherwise you get the default layout.
