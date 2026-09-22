import { getDocker } from './docker.js';
import { getSystem } from './system.js';
import { getPlex } from './plex.js';
import { getWeaver } from './weaver.js';
import { getScryer } from './scryer.js';
import { getQbittorrent, getTransmission } from './torrents.js';
import { getGeneric, getWeather, getLink } from './generic.js';
import { getPrometheus } from './prometheus.js';
import {
  getUptimeKuma, getPihole, getAdguard, getProxmox, getTailscale, getSpeedtest,
  getSonarr, getRadarr, getJellyfin, getSeerr, getHomeAssistant, getImmich,
} from './services.js';
import { summary as uptimeSummary } from '../uptime.js';
import { getScryerWanted } from './scryerWanted.js';
import { getTapo } from './tapo.js';
import * as apps from './apps.js';
import { cached } from './http.js';

/**
 * Widget type registry. `ttl` is the server-side cache in ms; the browser polls
 * on its own interval but the upstream service is only hit this often.
 * Adding a new widget = add a fetcher here + a renderer in web/src/widgets.
 */
export const WIDGET_TYPES = {
  docker: { fetch: getDocker, ttl: 8_000 },
  system: { fetch: getSystem, ttl: 4_000 },
  plex: { fetch: getPlex, ttl: 10_000 },
  weaver: { fetch: getWeaver, ttl: 5_000 },
  scryer: { fetch: getScryer, ttl: 15_000 },
  scryerwanted: { fetch: getScryerWanted, ttl: 4_000 },
  qbittorrent: { fetch: getQbittorrent, ttl: 5_000 },
  transmission: { fetch: getTransmission, ttl: 5_000 },
  generic: { fetch: getGeneric, ttl: 15_000 },
  prometheus: { fetch: getPrometheus, ttl: 15_000 },
  uptimekuma: { fetch: getUptimeKuma, ttl: 20_000 },
  pihole: { fetch: getPihole, ttl: 10_000 },
  adguard: { fetch: getAdguard, ttl: 10_000 },
  proxmox: { fetch: getProxmox, ttl: 10_000 },
  tailscale: { fetch: getTailscale, ttl: 30_000 },
  speedtest: { fetch: getSpeedtest, ttl: 60_000 },
  sonarr: { fetch: getSonarr, ttl: 15_000 },
  radarr: { fetch: getRadarr, ttl: 15_000 },
  jellyfin: { fetch: getJellyfin, ttl: 10_000 },
  seerr: { fetch: getSeerr, ttl: 20_000 },
  homeassistant: { fetch: getHomeAssistant, ttl: 5_000 },
  immich: { fetch: getImmich, ttl: 60_000 },
  tapo: { fetch: getTapo, ttl: 30_000 }, // real camera contact is rate-limited to 10 min inside the fetcher
  // integration pack (standard widget shape)
  prowlarr: { fetch: apps.getProwlarr, ttl: 30_000 },
  lidarr: { fetch: apps.getLidarr, ttl: 15_000 },
  readarr: { fetch: apps.getReadarr, ttl: 15_000 },
  bazarr: { fetch: apps.getBazarr, ttl: 60_000 },
  sabnzbd: { fetch: apps.getSabnzbd, ttl: 5_000 },
  nzbget: { fetch: apps.getNzbget, ttl: 5_000 },
  deluge: { fetch: apps.getDeluge, ttl: 5_000 },
  tautulli: { fetch: apps.getTautulli, ttl: 10_000 },
  portainer: { fetch: apps.getPortainer, ttl: 20_000 },
  truenas: { fetch: apps.getTruenas, ttl: 30_000 },
  nextcloud: { fetch: apps.getNextcloud, ttl: 60_000 },
  gotify: { fetch: apps.getGotify, ttl: 15_000 },
  grafana: { fetch: apps.getGrafana, ttl: 30_000 },
  traefik: { fetch: apps.getTraefik, ttl: 20_000 },
  npm: { fetch: apps.getNpm, ttl: 60_000 },
  paperless: { fetch: apps.getPaperless, ttl: 60_000 },
  syncthing: { fetch: apps.getSyncthing, ttl: 15_000 },
  glances: { fetch: apps.getGlances, ttl: 5_000 },
  scrutiny: { fetch: apps.getScrutiny, ttl: 5 * 60_000 },
  frigate: { fetch: apps.getFrigate, ttl: 10_000 },
  unifi: { fetch: apps.getUnifi, ttl: 30_000 },
  opnsense: { fetch: apps.getOpnsense, ttl: 30_000 },
  mikrotik: { fetch: apps.getMikrotik, ttl: 10_000 },
  miniflux: { fetch: apps.getMiniflux, ttl: 60_000 },
  gitea: { fetch: apps.getGitea, ttl: 60_000 },
  audiobookshelf: { fetch: apps.getAudiobookshelf, ttl: 5 * 60_000 },
  komga: { fetch: apps.getKomga, ttl: 5 * 60_000 },
  minecraft: { fetch: apps.getMinecraft, ttl: 60_000 },
  weather: { fetch: getWeather, ttl: 10 * 60_000 },
  link: { fetch: getLink, ttl: 20_000 }, // latency/up-down probe for bookmark tiles
  // clock is rendered purely client-side; no fetcher needed
};

export async function fetchWidgetData(widget) {
  const def = WIDGET_TYPES[widget.type];
  if (!def) throw new Error(`Unknown widget type "${widget.type}"`);
  const key = `widget:${widget.id}:${JSON.stringify(widget.config || {})}`;
  const data = await cached(key, def.ttl, () => def.fetch({ ...(widget.config || {}), __widgetId: widget.id }));
  // bookmark tiles also get their 24h ping history from the background monitor
  return widget.type === 'link' ? { ...data, uptime: uptimeSummary(widget.id) } : data;
}
