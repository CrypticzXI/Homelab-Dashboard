# Installation

[← back to the README](../README.md) · [Widgets](widgets.md) · [Configuration](configuration.md) · [Cameras](cameras.md) · [Development](development.md)

Everything ships as **one container**: nginx, the API, the Tapo bridge and go2rtc, supervised inside a single image. Pick whichever method suits you.

**Requirements:** Docker with the compose plugin, or Podman with `podman-compose`. About 1 GB of disk for the image, ~200 MB RAM at rest. amd64 and arm64 (Raspberry Pi 4/5) are both supported.

---

## Method 1 — the installer (recommended)

```bash
tar xzf homelab-dashboard-*.tar.gz -C ~/homelab-dashboard
cd ~/homelab-dashboard
./install.sh
```

The script:

1. finds Docker or Podman and the matching compose command
2. locates the container socket — enabling the rootless Podman user socket if it isn't running
3. asks for username, password (blank = generated), port and timezone
4. writes `.env` with a random `SESSION_SECRET` and your LAN IP as `HOST_ALIAS`
5. builds the image and starts it, then waits for `/healthz`
6. prints the URL and credentials

First build takes a few minutes — it downloads go2rtc, installs pytapo and bundles the web app.

```bash
./install.sh --update     # rebuild and restart after pulling changes
./install.sh --systemd    # Podman only: install a user service for boot start
```

---

## Method 2 — pre-built image from GHCR

Every push to `main` publishes a multi-arch image; tagged releases (`v1.2.3`) also attach a source tarball.

```bash
cp .env.example .env      # set credentials, port, CONTAINER_SOCKET
export IMAGE=ghcr.io/OWNER/REPO:latest
docker compose -f docker-compose.ghcr.yml up -d
```

To update:

```bash
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

---

## Method 3 — build it yourself

```bash
cp .env.example .env
docker compose up -d --build      # or: podman compose up -d --build
```

---

## Method 4 — plain `docker run`

```bash
docker run -d --name homelab-dashboard --restart unless-stopped \
  -p 8080:80 \
  -e DASH_USER=admin -e DASH_PASSWORD='change-me' \
  -e HOST_ALIAS=192.168.1.50 -e TZ=Europe/London \
  -v "$PWD/data:/data" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /:/host:ro \
  --add-host host.docker.internal:host-gateway \
  ghcr.io/OWNER/REPO:latest
```

---

## Starting on boot

- **Docker** — handled by `restart: unless-stopped` in the compose file.
- **Podman rootless** — `./install.sh --systemd` writes `~/.config/systemd/user/homelab-dashboard.service` and enables it. You may also need:
  ```bash
  sudo loginctl enable-linger $USER
  ```
  so it starts without you logging in.

## Updating

```bash
./install.sh --update              # local build
# or, for the published image:
docker compose -f docker-compose.ghcr.yml pull && docker compose -f docker-compose.ghcr.yml up -d
```

Your dashboard layout and secrets live in `data/`, which is untouched by updates.

## Uninstalling

```bash
docker compose down          # stop and remove the container
rm -rf data .env             # only if you want the configuration gone too
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `/healthz` never answers | `docker compose logs -f` — supervisord prints which process failed |
| Docker widget: *permission denied* | The socket isn't readable. Check `CONTAINER_SOCKET`, and for rootless Podman that `systemctl --user enable --now podman.socket` has been run |
| A widget can't reach a service on the same machine | Use the LAN IP, or `localhost` with `HOST_ALIAS` set to the host's IP |
| TLS errors on Proxmox / TrueNAS / UniFi | Leave `ALLOW_SELF_SIGNED=true` (the default) |
| Camera widget errors | See the [camera guide](cameras.md) — Third-Party Compatibility has to be on |
| Port already in use | Change `DASH_PORT` in `.env`, then `docker compose up -d` |
