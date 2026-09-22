# Installation

[← back to the README](../README.md) · [Widgets](widgets.md) · [Configuration](configuration.md) · [Cameras](cameras.md) · [Development](development.md)

Everything ships as **one container**: nginx, the API, the Tapo bridge and go2rtc, supervised inside a single image published to GHCR.

**Requirements:** Docker with the compose plugin, or Podman with `podman-compose`. ~1 GB of disk, ~200 MB RAM at rest. Built for **amd64 and arm64** (Raspberry Pi 4/5 included).

```
ghcr.io/crypticzxi/homelab-dashboard:latest
```

| Tag | What it is |
|---|---|
| `latest` | Newest build from `main` |
| `v1.2.3` | A specific release |
| `1.2` | Latest patch of that minor release |
| `main` | Same as `latest` |
| `sha-abc1234` | One exact commit |

---

## Docker Compose (recommended)

```bash
# grab the two files you need
mkdir -p ~/homelab-dashboard && cd ~/homelab-dashboard
curl -fsSLO https://raw.githubusercontent.com/CrypticzXI/Homelab-Dashboard/main/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/CrypticzXI/Homelab-Dashboard/main/.env.example
mv .env.example .env

# edit .env — at minimum set DASH_PASSWORD
nano .env

docker compose up -d           # or: podman compose up -d
```

Open `http://<server>:8080`, sign in, click **Edit**.

<details>
<summary><b>The compose file in full</b></summary>

```yaml
services:
  dashboard:
    image: ${IMAGE:-ghcr.io/crypticzxi/homelab-dashboard:latest}
    container_name: homelab-dashboard
    restart: unless-stopped
    ports:
      - "${DASH_PORT:-8080}:80"
    environment:
      DASH_USER: ${DASH_USER:-admin}
      DASH_PASSWORD: ${DASH_PASSWORD:-change-me}
      SESSION_SECRET: ${SESSION_SECRET:-}
      # "localhost" in a widget URL is rewritten to this host
      HOST_ALIAS: ${HOST_ALIAS:-host.docker.internal}
      # Accept self-signed certs on the services you add (Proxmox, TrueNAS, UniFi…)
      ALLOW_SELF_SIGNED: ${ALLOW_SELF_SIGNED:-true}
      # Optional: raises GitHub API limits for bookmark repo stats
      GITHUB_TOKEN: ${GITHUB_TOKEN:-}
      TZ: ${TZ:-UTC}
    volumes:
      # dashboard config, uploads, uptime history, camera photos — back this up
      - ./data:/data
      # Docker or Podman API socket for the Docker widget
      - ${CONTAINER_SOCKET:-/var/run/docker.sock}:/var/run/docker.sock
      # host filesystem, read-only, so the Server widget reports real disks
      - /:/host:ro
    # Needed on SELinux hosts (Fedora/RHEL); Docker ignores it.
    security_opt:
      - label=disable
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Every value comes from `.env`, so the file itself rarely needs editing. See [Configuration](configuration.md) for what each variable does.

</details>

### What the volumes are for

| Mount | Why |
|---|---|
| `./data:/data` | Dashboard layout, API keys, uptime history, camera photos. **Back this up.** |
| `…/docker.sock` | The Docker widget. Drop it if you don't want that widget — everything else still works |
| `/:/host:ro` | Lets the Server widget report the host's real disks and hostname instead of the container's. Read-only, and optional |

### Podman

Same file, and set the socket in `.env`:

```bash
systemctl --user enable --now podman.socket
echo "CONTAINER_SOCKET=/run/user/$(id -u)/podman/podman.sock" >> .env
podman compose up -d
```

`podman compose` needs `podman-compose` or `docker-compose` installed as its provider. For boot start without a login session, see [Starting on boot](#starting-on-boot).

---

## The installer script

If you'd rather answer a few questions than edit `.env` by hand, clone the repo and run:

```bash
git clone https://github.com/CrypticzXI/Homelab-Dashboard.git ~/homelab-dashboard
cd ~/homelab-dashboard
./install.sh
```

It detects Docker or Podman, finds the container socket (enabling the rootless Podman socket if needed), asks for a username, password, port and timezone, writes `.env` with a random `SESSION_SECRET` and your LAN IP as `HOST_ALIAS`, **pulls the published image**, starts it and prints the URL and credentials.

```bash
./install.sh                    # pull the image and start
./install.sh --build            # build from source instead
./install.sh --update           # pull the latest image and restart
./install.sh --update --build   # rebuild from source and restart
./install.sh --systemd          # Podman: install a user service for boot start
./install.sh --help
```

---

## Plain `docker run`

```bash
docker run -d --name homelab-dashboard --restart unless-stopped \
  -p 8080:80 \
  -e DASH_USER=admin \
  -e DASH_PASSWORD='change-me' \
  -e HOST_ALIAS=192.168.1.50 \
  -e TZ=Europe/London \
  -v "$PWD/data:/data" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /:/host:ro \
  --add-host host.docker.internal:host-gateway \
  ghcr.io/crypticzxi/homelab-dashboard:latest
```

---

## Building from source

Only needed if you're changing the code — see [Development](development.md).

```bash
git clone https://github.com/CrypticzXI/Homelab-Dashboard.git
cd Homelab-Dashboard
cp .env.example .env
docker compose -f docker-compose.build.yml up -d --build
```

---

## Updating

```bash
docker compose pull && docker compose up -d
```

Or `./install.sh --update`. Your `data/` folder is untouched by updates.

**Pin a version** if you'd rather update deliberately:

```bash
echo "IMAGE=ghcr.io/crypticzxi/homelab-dashboard:v1.0.0" >> .env
docker compose up -d
```

**Roll back** by pointing `IMAGE` at an earlier tag and running `docker compose up -d` again.

---

## Starting on boot

- **Docker** — handled by `restart: unless-stopped`.
- **Podman rootless** — `./install.sh --systemd` writes `~/.config/systemd/user/homelab-dashboard.service` and enables it. You may also need:
  ```bash
  sudo loginctl enable-linger $USER
  ```

---

## Uninstalling

```bash
docker compose down          # stop and remove the container
rm -rf data .env             # only if you want the configuration gone too
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `denied` / `403` when pulling | The GHCR package is private. Make it public, or `docker login ghcr.io -u <user>` with a PAT that has `read:packages` |
| `repository name must be lowercase` | Use `ghcr.io/crypticzxi/…` — registries reject capitals even though the GitHub username has them |
| `/healthz` never answers | `docker compose logs -f` — supervisord names the process that failed |
| Docker widget: *permission denied* | Socket not readable. Check `CONTAINER_SOCKET`; for rootless Podman run `systemctl --user enable --now podman.socket` |
| A widget can't reach a service on the same machine | Use the LAN IP, or `localhost` with `HOST_ALIAS` set to the host's IP |
| TLS errors on Proxmox / TrueNAS / UniFi | Leave `ALLOW_SELF_SIGNED=true` (the default) |
| Camera widget errors | See the [camera guide](cameras.md) — Third-Party Compatibility must be on |
| Port already in use | Change `DASH_PORT` in `.env`, then `docker compose up -d` |
