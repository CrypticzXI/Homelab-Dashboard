import { StdWidget } from './std.jsx';

/** Registry entries for the integration pack (api/src/integrations/apps.js). */
const url = (label, placeholder) => ({ key: 'url', label, kind: 'url', required: true, placeholder });
const key = (label, hint, required = true) => ({ key: 'apiKey', label, kind: 'secret', required, hint });
const user = (label = 'Username') => ({ key: 'username', label, kind: 'text' });
const pass = (label = 'Password') => ({ key: 'password', label, kind: 'secret' });
const max = (label = 'Rows to show', d = 8) => ({ key: 'max', label, kind: 'number', default: d });

const def = (icon, name, description, fields, extra = {}) => ({ icon, name, description, component: StdWidget, defaultW: 2, defaultTitle: name, fields, ...extra });

export const APP_WIDGETS = {
  prowlarr: def('prowlarr', 'Prowlarr', 'Indexer health, query and grab counts.', [url('Prowlarr URL', 'http://192.168.1.10:9696'), key('API key', 'Settings → General'), max()]),
  lidarr: def('lidarr', 'Lidarr', 'Music queue and missing albums.', [url('Lidarr URL', 'http://192.168.1.10:8686'), key('API key', 'Settings → General'), max('Queue items', 6)]),
  readarr: def('readarr', 'Readarr', 'Book queue and missing titles.', [url('Readarr URL', 'http://192.168.1.10:8787'), key('API key', 'Settings → General'), max('Queue items', 6)]),
  bazarr: def('bazarr', 'Bazarr', 'Wanted subtitles and provider errors.', [url('Bazarr URL', 'http://192.168.1.10:6767'), key('API key', 'Settings → General')]),
  sabnzbd: def('sabnzbd', 'SABnzbd', 'Speed, queue, ETA and recent history.', [url('SABnzbd URL', 'http://192.168.1.10:8080'), key('API key', 'Config → General → API key'), max('Queue items', 6)]),
  nzbget: def('nzbget', 'NZBGet', 'Speed and download queue.', [url('NZBGet URL', 'http://192.168.1.10:6789'), user(), pass(), max('Queue items', 6)]),
  deluge: def('deluge', 'Deluge', 'Transfer speeds and torrents.', [url('Deluge web URL', 'http://192.168.1.10:8112'), pass('Web UI password'), max('Torrents', 6)]),
  tautulli: def('tautulli', 'Tautulli', 'Plex activity, bandwidth and library sizes.', [url('Tautulli URL', 'http://192.168.1.10:8181'), key('API key', 'Settings → Web Interface → API')]),
  portainer: def('portainer', 'Portainer', 'Environments with container counts.', [url('Portainer URL', 'https://192.168.1.10:9443'), key('Access token', 'My account → Access tokens'), max('Environments', 8)]),
  truenas: def('truenas-scale', 'TrueNAS', 'Pools, capacity, alerts and uptime.', [url('TrueNAS URL', 'https://192.168.1.20'), key('API key', 'Settings → API Keys')]),
  nextcloud: def('nextcloud', 'Nextcloud', 'Users, files, storage and server info.', [url('Nextcloud URL', 'https://cloud.example.com'), key('Serverinfo token', 'Administration → Monitoring → token', false), user('or admin user'), pass('app password')]),
  gotify: def('gotify', 'Gotify', 'Latest notifications.', [url('Gotify URL', 'http://192.168.1.10:8070'), key('Client token', 'Clients → create'), max('Messages', 6)]),
  grafana: def('grafana', 'Grafana', 'Health and firing alerts.', [url('Grafana URL', 'http://192.168.1.10:3000'), key('Service account token', 'Administration → Service accounts', false), user('or user'), pass(), max('Alerts', 6)]),
  traefik: def('traefik', 'Traefik', 'Routers, services, middlewares and errors.', [url('Traefik API URL', 'http://192.168.1.10:8080'), user('Basic-auth user (optional)'), pass(), max('Routers', 6)]),
  npm: def('nginx-proxy-manager', 'Nginx Proxy Manager', 'Proxy hosts and expiring certificates.', [url('NPM URL', 'http://192.168.1.10:81'), user('Email'), pass(), max('Hosts', 8)]),
  paperless: def('paperless-ngx', 'Paperless-ngx', 'Document counts, inbox and latest documents.', [url('Paperless URL', 'http://192.168.1.10:8000'), key('API token', 'Profile → API auth token', false), user('or user'), pass(), max('Documents', 5)]),
  syncthing: def('syncthing', 'Syncthing', 'Connected devices and folder sync state.', [url('Syncthing URL', 'http://192.168.1.10:8384'), key('API key', 'Actions → Settings → API key'), max('Folders', 6)]),
  glances: def('glances', 'Glances (remote host)', 'CPU, memory, load, temperature and disks of another machine.', [url('Glances URL', 'http://otherbox:61208'), user('User (optional)'), pass()]),
  scrutiny: def('scrutiny', 'Scrutiny', 'S.M.A.R.T. disk health, temperature and age.', [url('Scrutiny URL', 'http://192.168.1.10:8080'), max('Disks', 8)]),
  frigate: def('frigate', 'Frigate', 'Cameras, detection fps and recent events.', [url('Frigate URL', 'http://192.168.1.10:5000'), user('User (optional)'), pass(), max('Events', 6)]),
  unifi: def('unifi', 'UniFi Network', 'Devices online and connected clients (UniFi OS 9+ API key).', [url('Console URL', 'https://192.168.1.1'), key('API key', 'Console → Control Plane → Integrations'), max('Devices', 8)]),
  opnsense: def('opnsense', 'OPNsense', 'Gateway status and firmware updates.', [url('OPNsense URL', 'https://192.168.1.1'), user('API key'), pass('API secret')]),
  mikrotik: def('mikrotik', 'MikroTik', 'RouterOS CPU, memory, uptime and interfaces.', [url('Router URL', 'https://192.168.88.1'), user('User'), pass(), max('Interfaces', 8)]),
  miniflux: def('miniflux', 'Miniflux', 'Unread count and latest articles.', [url('Miniflux URL', 'http://192.168.1.10:8085'), key('API token', 'Settings → API Keys', false), user('or user'), pass(), max('Articles', 6)]),
  gitea: def('gitea', 'Gitea / Forgejo', 'Recently updated repos, issues and PRs.', [url('Gitea URL', 'https://git.example.com'), key('Access token', 'Settings → Applications'), max('Repos', 8)]),
  audiobookshelf: def('audiobookshelf', 'Audiobookshelf', 'Libraries with item counts and hours.', [url('URL', 'http://192.168.1.10:13378'), key('API token', 'Settings → Users → your user → API token')]),
  komga: def('komga', 'Komga', 'Series and book counts, latest additions.', [url('Komga URL', 'http://192.168.1.10:25600'), key('API key', 'Account settings → API keys', false), user('or email'), pass(), max('Latest series', 5)]),
  minecraft: def('minecraft', 'Minecraft server', 'Online status, players, ping and MOTD — works for LAN servers.', [{ key: 'host', label: 'Server address', kind: 'text', required: true, placeholder: 'mc.example.com:25565' }], { defaultW: 1 }),
};

export const APP_CATEGORIES = {
  infra: ['portainer', 'truenas', 'glances', 'scrutiny', 'syncthing', 'grafana', 'traefik', 'npm'],
  network: ['unifi', 'opnsense', 'mikrotik'],
  media: ['tautulli', 'prowlarr', 'lidarr', 'readarr', 'bazarr', 'audiobookshelf', 'komga'],
  downloads: ['sabnzbd', 'nzbget', 'deluge'],
  home: ['frigate'],
  apps: ['nextcloud', 'paperless', 'gotify', 'miniflux', 'gitea', 'minecraft'],
};
