# Single-image build: nginx (static UI + reverse proxy), Node API, pytapo
# bridge and go2rtc, all supervised by supervisord inside one container.

# ---- stage 1: build the React app ----
FROM docker.io/library/node:22-bookworm-slim AS webbuild
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ .
RUN npm run build

# ---- stage 2: API dependencies ----
FROM docker.io/library/node:22-bookworm-slim AS apideps
WORKDIR /api
COPY api/package.json api/package-lock.json* ./
RUN npm install --omit=dev

# ---- stage 3: runtime ----
FROM docker.io/library/node:22-bookworm-slim
ARG TARGETARCH=amd64
ARG GO2RTC_VERSION=v1.9.14
ENV NODE_ENV=production \
    DATA_DIR=/data \
    HOST_ROOT=/host \
    TAPO_BRIDGE=http://127.0.0.1:8484 \
    GO2RTC=http://127.0.0.1:1984 \
    PORT=3001

RUN apt-get update \
 && apt-get install -y --no-install-recommends nginx supervisor python3 python3-venv curl ca-certificates tzdata ffmpeg \
 && rm -rf /var/lib/apt/lists/* \
 && rm -f /etc/nginx/sites-enabled/default

# go2rtc static binary (amd64 / arm64 / arm)
RUN case "$TARGETARCH" in \
      amd64) A=amd64 ;; arm64) A=arm64 ;; arm) A=arm ;; *) A=amd64 ;; \
    esac \
 && curl -fsSL "https://github.com/AlexxIT/go2rtc/releases/download/${GO2RTC_VERSION}/go2rtc_linux_${A}" -o /usr/local/bin/go2rtc \
 && chmod +x /usr/local/bin/go2rtc

# pytapo in its own venv
RUN python3 -m venv /opt/tapo && /opt/tapo/bin/pip install --no-cache-dir pytapo==3.4.19

WORKDIR /app
COPY --from=apideps /api/node_modules ./api/node_modules
COPY api/package.json ./api/
COPY api/src ./api/src
COPY tapo-bridge/server.py ./tapo-bridge/server.py
COPY --from=webbuild /web/dist /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/conf.d/dashboard.conf
COPY go2rtc/go2rtc.yaml /app/go2rtc.template.yaml
COPY supervisord.conf /etc/supervisor/conf.d/dashboard.conf

RUN mkdir -p /data /run/go2rtc \
 && ln -sf /dev/stdout /var/log/nginx/access.log \
 && ln -sf /dev/stderr /var/log/nginx/error.log

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD curl -fs http://127.0.0.1/healthz || exit 1
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
