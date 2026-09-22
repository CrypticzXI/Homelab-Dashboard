import { baseUrl, graphql } from './http.js';

/**
 * Scryer "missing" widget: lists titles with missing items, can kick off a
 * mass acquisition search for all of them, and reports live progress plus a
 * per-item outcome (found / skipped / nothing found) derived by comparing each
 * wanted item's status & latest decision against a snapshot taken when the
 * job started.
 */

const WANTED_QUERY = `
  query Wanted($kind: WantedKindValue!, $facet: MediaFacetValue, $limit: Int!, $offset: Int!) {
    wantedItems(wantedKind: $kind, facet: $facet, limit: $limit, offset: $offset) {
      totalCount
      hasMore
      items {
        id titleId titleName titleFacet libraryName episodeId seasonNumber episodeNumber mediaType
        status lastSearchAt convergenceState indexersCovered indexersRouted
        latestReleaseDecision { id decisionCode releaseTitle candidateScore createdAt }
      }
    }
  }
`;
const JOB_QUERY = `
  query Job($id: ID!) {
    acquisitionSearchJob(id: $id) {
      id state total processed grabbedCount failedCount currentTitle startedAt finishedAt
    }
  }
`;
const TRIGGER = `
  mutation Trigger($input: TriggerAcquisitionSearchInput!) {
    triggerAcquisitionSearch(input: $input) { id state total processed startedAt }
  }
`;
const CANCEL = `
  mutation Cancel($id: ID!) {
    cancelAcquisitionSearch(id: $id) { __typename }
  }
`;

/**
 * ONLY MONITORED ITEMS COUNT. Scryer's wanted list can include episodes whose
 * own monitor flag is off (e.g. specials), so we look up each title's
 * monitored state at title / season / episode level and drop the rest.
 * Cached per title for a minute.
 */
const MONITOR_TTL = 60_000;
const monitorCache = new Map(); // titleId -> { at, titleMonitored, episodes: Map(episodeId -> bool) }

async function monitorState(config, titleIds) {
  const now = Date.now();
  const missing = titleIds.filter((id) => !(monitorCache.get(id)?.at > now - MONITOR_TTL));
  for (let i = 0; i < missing.length; i += 25) {
    const chunk = missing.slice(i, i + 25);
    const q = `query Mon(${chunk.map((_, j) => `$i${j}: ID!`).join(', ')}) {
      ${chunk.map((_, j) => `t${j}: title(id: $i${j}) { id monitored monitorSpecials episodesOwned episodesMonitored collections { monitored collectionType episodes { id monitored seasonNumber } } }`).join(' ')}
    }`;
    const vars = Object.fromEntries(chunk.map((id, j) => [`i${j}`, id]));
    const { data } = await graphql(gql(config), q, vars, headers(config));
    chunk.forEach((id, j) => {
      const t = data?.[`t${j}`];
      const episodes = new Map();
      const specialsOn = t?.monitorSpecials === true;
      for (const c of t?.collections || []) {
        for (const e of c.episodes || []) {
          // Scryer's title counters ignore season 0 unless "monitor specials" is on,
          // even though the per-episode flag may still read true — mirror that.
          const isSpecial = String(e.seasonNumber) === '0';
          episodes.set(e.id, !!e.monitored && c.monitored !== false && (!isSpecial || specialsOn));
        }
      }
      monitorCache.set(id, {
        at: now,
        titleMonitored: t ? !!t.monitored : true,
        specialsOn,
        expectedMissing: t && t.episodesMonitored != null && t.episodesOwned != null ? Math.max(0, t.episodesMonitored - t.episodesOwned) : null,
        episodes,
        known: !!t,
      });
    });
  }
  return monitorCache;
}

/** Keep only wanted items that are monitored at every level. */
async function onlyMonitored(config, items) {
  const ids = [...new Set(items.map((i) => i.titleId))];
  const state = await monitorState(config, ids);
  return items.filter((i) => {
    const st = state.get(i.titleId);
    if (!st || !st.known) return true; // couldn't look it up — keep rather than hide
    if (!st.titleMonitored) return false;
    if (i.episodeId != null) {
      const m = st.episodes.get(i.episodeId);
      if (m === false) return false;
      if (m === undefined && String(i.seasonNumber) === '0' && !st.specialsOn) return false; // special we couldn't map
      return true;
    }
    return true;
  });
}

/** Scryer's own per-title "monitored minus owned" figure, for sanity/validation. */
export function expectedMissingFor(titleId) {
  return monitorCache.get(titleId)?.expectedMissing ?? null;
}

/** widgetId -> { id, startedAt, before: Map(itemId -> {status, decisionId}), finished: payload|null } */
const jobs = new Map();

const headers = (c) => ({ authorization: `Bearer ${c.apiKey}` });

/** Scryer caps a page at 500; walk pages until `max` items or the end. */
async function fetchWanted(config, facet, max) {
  const items = [];
  let totalCount = 0, hasMore = false, offset = 0, errors = [];
  while (items.length < max) {
    const page = Math.min(500, max - items.length);
    const { data, errors: errs } = await graphql(gql(config), WANTED_QUERY, { kind: 'MISSING', facet, limit: page, offset }, headers(config));
    errors = errs;
    const w = data.wantedItems;
    if (!w) throw new Error(errs[0]?.message || 'No data from Scryer');
    items.push(...w.items);
    totalCount = w.totalCount;
    hasMore = w.hasMore;
    if (!w.hasMore || w.items.length === 0) break;
    offset += w.items.length;
  }
  const monitored = await onlyMonitored(config, items);
  return {
    items: monitored,
    totalCount: totalCount - (items.length - monitored.length),
    unmonitored: items.length - monitored.length,
    hasMore: hasMore && items.length >= max,
    errors,
  };
}
const gql = (c) => `${baseUrl(c.url)}/graphql`;

const label = (i) => {
  const se =
    i.seasonNumber != null && i.episodeNumber != null
      ? `S${String(i.seasonNumber).padStart(2, '0')}E${String(i.episodeNumber).padStart(2, '0')}`
      : i.seasonNumber != null
        ? `S${String(i.seasonNumber).padStart(2, '0')}`
        : '';
  return se || (i.mediaType === 'MOVIE' ? 'movie' : i.mediaType.toLowerCase());
};

const humanCode = (code) => (code || '').replace(/_/g, ' ');

/** Classify one wanted item relative to the job snapshot. */
function outcome(item, job) {
  if (!job) return null;
  const before = job.before.get(item.id);
  const searchedSince = item.lastSearchAt && new Date(item.lastSearchAt).getTime() >= job.startedAt - 5000;
  if (item.status === 'GRABBED' && (!before || before.status !== 'GRABBED')) return { kind: 'found', detail: item.latestReleaseDecision?.releaseTitle || 'grabbed' };
  if (item.status === 'GRABBED') return { kind: 'already', detail: 'already grabbed' };
  const d = item.latestReleaseDecision;
  const newDecision = d && (!before || before.decisionId !== d.id);
  if (newDecision) return { kind: 'skipped', detail: `${humanCode(d.decisionCode)}${d.releaseTitle ? ` — ${d.releaseTitle}` : ''}` };
  if (searchedSince) return { kind: 'none', detail: 'no release found' };
  if (job.finished) return { kind: 'none', detail: 'not searched' };
  return { kind: 'pending', detail: 'waiting' };
}

export async function getScryerWanted(config) {
  if (!config.apiKey) throw new Error('Scryer API key is not configured');
  const widgetId = config.__widgetId;
  const facet = config.facet && config.facet !== 'ALL' ? config.facet : null;
  const limit = Math.min(5000, Number(config.limit) || 2000);

  const [list, jobPayload] = await Promise.all([fetchWanted(config, facet, limit), pollJob(config, widgetId)]);
  const errors = list.errors;

  const job = jobs.get(widgetId) || null;
  const byTitle = new Map();
  const totals = { found: 0, skipped: 0, none: 0, pending: 0, already: 0 };
  for (const it of list.items) {
    const o = outcome(it, job);
    if (o) totals[o.kind]++;
    const t = byTitle.get(it.titleId) || { titleId: it.titleId, title: it.titleName || it.titleId, facet: it.titleFacet, library: it.libraryName, items: [] };
    t.items.push({
      id: it.id,
      label: label(it),
      status: it.status,
      lastSearch: it.lastSearchAt,
      convergence: it.convergenceState,
      indexers: it.indexersRouted ? `${it.indexersCovered}/${it.indexersRouted}` : null,
      decision: it.latestReleaseDecision ? { code: humanCode(it.latestReleaseDecision.decisionCode), release: it.latestReleaseDecision.releaseTitle } : null,
      outcome: o,
    });
    byTitle.set(it.titleId, t);
  }
  const titles = [...byTitle.values()].map((t) => ({
    ...t,
    missing: t.items.length,
    scryerMissing: expectedMissingFor(t.titleId),
    found: t.items.filter((i) => i.outcome?.kind === 'found').length,
    skipped: t.items.filter((i) => i.outcome?.kind === 'skipped').length,
  }));
  // titles with activity first, then most-missing
  titles.sort((a, b) => b.found - a.found || b.skipped - a.skipped || b.missing - a.missing || a.title.localeCompare(b.title));

  return {
    totalItems: list.totalCount,
    shownItems: list.items.length,
    unmonitored: list.unmonitored,
    hasMore: list.hasMore,
    titles,
    job: jobPayload
      ? {
          id: jobPayload.id,
          state: jobPayload.state,
          total: jobPayload.total,
          processed: jobPayload.processed,
          grabbed: jobPayload.grabbedCount,
          failed: jobPayload.failedCount,
          current: jobPayload.currentTitle,
          startedAt: jobPayload.startedAt,
          finishedAt: jobPayload.finishedAt,
          outcomes: totals,
        }
      : null,
    warnings: errors.map((e) => e.message),
  };
}

async function pollJob(config, widgetId) {
  const job = jobs.get(widgetId);
  if (!job) return null;
  if (job.finished) return job.finished;
  try {
    const { data } = await graphql(gql(config), JOB_QUERY, { id: job.id }, headers(config));
    const p = data.acquisitionSearchJob;
    if (!p) return job.finished || null;
    if (p.state !== 'RUNNING') job.finished = p;
    return p;
  } catch (e) {
    return { id: job.id, state: 'UNKNOWN', total: 0, processed: 0, grabbedCount: 0, failedCount: 0, currentTitle: e.message, startedAt: new Date(job.startedAt).toISOString() };
  }
}

/** Start a mass search for everything currently missing (respecting the widget's facet filter). */
export async function startScryerSearch(widgetId, config) {
  if (!config.apiKey) throw new Error('Scryer API key is not configured');
  const existing = jobs.get(widgetId);
  if (existing && !existing.finished) {
    const p = await pollJob(config, widgetId);
    if (p && p.state === 'RUNNING') throw new Error('A search is already running');
  }
  const facet = config.facet && config.facet !== 'ALL' ? config.facet : null;
  // snapshot so we can tell what changed because of this job
  const before = await fetchWanted(config, facet, 5000);
  const snap = new Map();
  for (const it of before.items) snap.set(it.id, { status: it.status, decisionId: it.latestReleaseDecision?.id || null });

  // no `intent`: AUTOMATIC is the single-title mode and rejects wanted filters
  const input = { wantedKind: 'MISSING' };
  if (facet) input.facet = facet;
  const { data, errors } = await graphql(gql(config), TRIGGER, { input }, headers(config));
  const p = data.triggerAcquisitionSearch;
  if (!p) throw new Error(errors[0]?.message || 'Scryer did not start a search');
  jobs.set(widgetId, { id: p.id, startedAt: Date.now(), before: snap, finished: null });
  return { id: p.id, total: p.total };
}

export async function cancelScryerSearch(widgetId, config) {
  const job = jobs.get(widgetId);
  if (!job) throw new Error('No search running');
  await graphql(gql(config), CANCEL, { id: job.id }, headers(config));
  return { ok: true };
}

/** Forget a finished job so the report resets. */
export function clearScryerSearch(widgetId) {
  jobs.delete(widgetId);
  return { ok: true };
}
