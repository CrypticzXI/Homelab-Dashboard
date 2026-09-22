import { baseUrl, graphql } from './http.js';
import { scrapeCached, select, byLabel, aggregate } from './prometheus.js';

// Weaver (https://github.com/scryer-media/weaver) exposes GraphQL at /graphql
// and authenticates API keys via the `x-api-key` header.
const QUERY = `
  query Dashboard {
    systemStatus {
      version
      globalState { isPaused speedLimitBytesPerSec }
      summary {
        totalItems queuedItems activeItems pausedItems failedItems
        totalBytes downloadedBytes currentDownloadSpeed
        verifyingItems repairingItems extractingItems
      }
    }
    queueItems(first: 6) {
      id displayTitle state progressPercent totalBytes downloadedBytes category health
    }
  }
`;

/** Optional extras from Weaver's /metrics (Bearer = API key). Failure yields an error string. */
async function weaverMetrics(base, apiKey) {
  try {
    const p = await scrapeCached(`${base}/metrics`, { authorization: `Bearer ${apiKey}` }, 20_000);
    const total = byLabel(p, 'weaver_disk_total_bytes', 'path');
    const avail = byLabel(p, 'weaver_disk_available_bytes', 'path');
    const disks = total.map((t) => {
      const a = avail.find((x) => JSON.stringify(x.labels) === JSON.stringify(t.labels));
      return { name: t.labels.path || t.labels.dir || t.key, total: t.value, free: a?.value ?? null };
    });
    const capEnabled = aggregate(select(p, 'weaver_bandwidth_cap_enabled'), 'max');
    const build = select(p, 'weaver_build_info')[0]?.labels || {};
    return {
      disks,
      cap: capEnabled
        ? {
            limit: aggregate(select(p, 'weaver_bandwidth_cap_limit_bytes'), 'max'),
            used: aggregate(select(p, 'weaver_bandwidth_cap_used_bytes'), 'max'),
            remaining: aggregate(select(p, 'weaver_bandwidth_cap_remaining_bytes'), 'max'),
            windowEnd: aggregate(select(p, 'weaver_bandwidth_cap_window_end_seconds'), 'max'),
          }
        : null,
      articlesPerSec: aggregate(select(p, 'weaver_pipeline_articles_per_second'), 'max'),
      version: build.version || null,
    };
  } catch (e) {
    return { error: e.message };
  }
}

export async function getWeaver(config) {
  if (!config.apiKey) throw new Error('Weaver API key is not configured');
  const base = baseUrl(config.url);
  const url = `${base}/graphql`;
  const [{ data, errors }, metrics] = await Promise.all([
    graphql(url, QUERY, {}, { 'x-api-key': config.apiKey }),
    config.metrics === false ? null : weaverMetrics(base, config.apiKey),
  ]);
  const s = data.systemStatus;
  if (!s) throw new Error(errors[0]?.message || 'No data from Weaver');
  return {
    version: s.version,
    paused: s.globalState.isPaused,
    speedLimit: s.globalState.speedLimitBytesPerSec,
    summary: s.summary,
    queue: (data.queueItems || []).map((q) => ({
      id: q.id,
      title: q.displayTitle,
      state: q.state,
      progress: q.progressPercent,
      total: q.totalBytes,
      downloaded: q.downloadedBytes,
      category: q.category,
      health: q.health,
    })),
    metrics: metrics && !metrics.error ? metrics : null,
    metricsError: metrics?.error || null,
    warnings: errors.map((e) => e.message),
  };
}
