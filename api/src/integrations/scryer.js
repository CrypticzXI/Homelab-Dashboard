import { baseUrl, graphql } from './http.js';
import { scrapeCached, select, byLabel, aggregate } from './prometheus.js';

// Scryer (https://github.com/scryer-media/scryer) exposes GraphQL at /graphql.
// API keys (prefix `ska`) are presented as a Bearer token. Each field is
// requested independently so a key without a given permission still yields
// whatever it *is* allowed to see.
const QUERY = `
  query Dashboard($start: Date!, $end: Date!) {
    scryerVersion
    systemHealth {
      serviceReady totalTitles monitoredTitles titlesMovie titlesSeries titlesAnime
    }
    dashboardActivityStats(windowHours: 24) {
      current { grabbed upgraded imported importFailed downloadFailed }
    }
    navigationBadgeCounts {
      pendingImportCounts { movie series anime }
      pendingMediaRequestCounts { movie series anime }
    }
    downloadQueuePage(limit: 6, offset: 0) {
      totalCount
      items {
        id titleName facet displayState progressPercent sizeBytes remainingSeconds clientName attentionRequired
      }
    }
    calendarEpisodes(startDate: $start, endDate: $end) {
      id titleName seasonNumber episodeNumber episodeTitle airDate monitored
    }
  }
`;

const isoDate = (d) => d.toISOString().slice(0, 10);

/**
 * Optional extras from Scryer's Prometheus endpoint (needs SCRYER_METRICS=1 and a key
 * from a user with system-settings permission). Any failure just yields an error string.
 */
async function scryerMetrics(base, apiKey) {
  try {
    const p = await scrapeCached(`${base}/metrics`, { authorization: `Bearer ${apiKey}` }, 20_000);
    const free = byLabel(p, 'scryer_root_folder_free_bytes', 'path');
    const total = byLabel(p, 'scryer_root_folder_total_bytes', 'path');
    const storage = total.map((t) => {
      const f = free.find((x) => JSON.stringify(x.labels) === JSON.stringify(t.labels));
      const name = t.labels.path || t.labels.root || t.labels.library || t.key;
      return { name, total: t.value, free: f?.value ?? null, used: f ? t.value - f.value : null };
    });
    const clients = byLabel(p, 'scryer_download_client_up', 'client').map((c) => ({ name: c.labels.client || c.labels.name || c.key, up: c.value >= 1 }));
    const indexers = byLabel(p, 'scryer_indexer_backoff_active', 'indexer').map((i) => ({ name: i.labels.indexer || i.key, backoff: i.value >= 1 }));
    const start = aggregate(select(p, 'scryer_process_start_time_seconds'), 'first');
    const build = select(p, 'scryer_build_info')[0]?.labels || {};
    return {
      storage,
      clients,
      indexers,
      wsConnections: aggregate(select(p, 'scryer_ws_connections'), 'sum'),
      uptime: start ? Math.max(0, Math.floor(Date.now() / 1000 - start)) : null,
      version: build.version || null,
      counters: {
        grabs: aggregate(select(p, 'scryer_grabs_total')),
        imports: aggregate(select(p, 'scryer_imports_total')),
        downloadsFailed: aggregate(select(p, 'scryer_downloads_failed_total')),
        indexerErrors: aggregate(select(p, 'scryer_indexer_errors_total')),
        subtitles: aggregate(select(p, 'scryer_subtitles_downloaded_total')),
      },
    };
  } catch (e) {
    return { error: e.message };
  }
}

export async function getScryer(config) {
  if (!config.apiKey) throw new Error('Scryer API key is not configured');
  const base = baseUrl(config.url);
  const url = `${base}/graphql`;
  const start = new Date();
  const end = new Date(Date.now() + 7 * 86400_000);
  const [{ data, errors }, metrics] = await Promise.all([
    graphql(url, QUERY, { start: isoDate(start), end: isoDate(end) }, { authorization: `Bearer ${config.apiKey}` }),
    config.metrics === false ? null : scryerMetrics(base, config.apiKey),
  ]);
  if (!data || Object.keys(data).length === 0) {
    throw new Error(errors[0]?.message || 'No data from Scryer');
  }
  const stats = data.dashboardActivityStats?.current || null;
  const badges = data.navigationBadgeCounts;
  const sum = (o) => (o ? Object.values(o).reduce((a, b) => a + (b || 0), 0) : 0);
  return {
    version: data.scryerVersion || null,
    health: data.systemHealth || null,
    activity: stats,
    pendingImports: sum(badges?.pendingImportCounts),
    pendingRequests: sum(badges?.pendingMediaRequestCounts),
    queueTotal: data.downloadQueuePage?.totalCount ?? null,
    queue: (data.downloadQueuePage?.items || []).map((q) => ({
      id: q.id,
      title: q.titleName,
      facet: q.facet,
      state: q.displayState,
      progress: q.progressPercent,
      size: q.sizeBytes != null && q.sizeBytes >= 0 ? q.sizeBytes : null,
      eta: q.remainingSeconds != null && q.remainingSeconds > 0 && q.remainingSeconds < 8_640_000 ? q.remainingSeconds : null,
      client: q.clientName,
      attention: q.attentionRequired,
    })),
    upcoming: (data.calendarEpisodes || [])
      .filter((e) => e.airDate)
      .sort((a, b) => (a.airDate < b.airDate ? -1 : 1))
      .slice(0, 8)
      .map((e) => ({
        id: e.id,
        title: e.titleName,
        episode:
          e.seasonNumber != null && e.episodeNumber != null
            ? `S${String(e.seasonNumber).padStart(2, '0')}E${String(e.episodeNumber).padStart(2, '0')}`
            : '',
        name: e.episodeTitle,
        airDate: e.airDate,
      })),
    metrics: metrics && !metrics.error ? metrics : null,
    metricsError: metrics?.error || null,
    warnings: errors.map((e) => e.message),
  };
}
