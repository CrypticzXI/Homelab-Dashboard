import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { relDate } from '../lib/format.js';
import { Icon } from '../lib/icons.jsx';
import { useIsSaved, useWidgetData, Skeleton, ErrorLine, Stat } from './common.jsx';

const TONE = { found: 'ok', skipped: 'warn', none: '', pending: 'accent', already: '' };
const WORD = { found: 'found', skipped: 'skipped', none: 'nothing', pending: 'pending', already: 'grabbed' };

function TitleRow({ t, open, onToggle }) {
  return (
    <li className={`wanted-title ${open ? 'open' : ''}`}>
      <button className="wanted-head" onClick={onToggle}>
        <Icon name={open ? 'down' : 'up'} size={12} className="chev" />
        <span className="name">
          {t.title}
          <small>
            {[t.facet ? t.facet.toLowerCase() : '', t.library && t.library.toLowerCase() !== (t.facet || '').toLowerCase() ? t.library : '']
              .filter(Boolean)
              .join(' · ')}
            {t.scryerMissing != null && t.scryerMissing !== t.missing ? ` · ${t.scryerMissing} monitored, ${t.scryerMissing - t.missing} not yet searchable` : ''}
          </small>
        </span>
        {t.found ? <span className="tag ok">{t.found} found</span> : null}
        {t.skipped ? <span className="tag warn">{t.skipped} skipped</span> : null}
        <span className="tag">{t.missing} missing</span>
      </button>
      {open ? (
        <ul className="wanted-items">
          {t.items.map((i) => (
            <li key={i.id} title={i.decision ? `${i.decision.code}${i.decision.release ? `\n${i.decision.release}` : ''}` : ''}>
              <span className="lbl">{i.label}</span>
              {i.outcome ? <span className={`tag ${TONE[i.outcome.kind]}`}>{WORD[i.outcome.kind]}</span> : <span className="tag">{i.status.toLowerCase()}</span>}
              <span className="detail">
                {i.outcome?.detail || (i.decision ? i.decision.code : i.lastSearch ? `searched ${relDate(i.lastSearch)}` : 'never searched')}
                {i.indexers ? ` · idx ${i.indexers}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ScryerWantedWidget({ widget }) {
  const isSaved = useIsSaved(widget);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const { loading, data, error } = useWidgetData(widget, 4_000, isSaved);

  const running = data?.job?.state === 'RUNNING';
  const act = async (op) => {
    setBusy(true);
    setErr('');
    try {
      await api.scryerSearch(widget.id, op);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  if (!isSaved) return <div className="card-body"><div className="empty">Save the dashboard to load live data.</div></div>;
  if (loading && !data) return <div className="card-body"><Skeleton /></div>;
  if (error && !data) return <div className="card-body"><ErrorLine error={error} /></div>;

  const job = data.job;
  const max = Number(widget.config?.show) || 8;
  const titles = showAll ? data.titles : data.titles.slice(0, max);

  // the card may be an <a> (Open-on-click URL); keep button clicks inside the widget
  const swallow = (e) => {
    if (e.target.closest('button')) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div className="card-body" onClick={swallow} onPointerDown={(e) => e.target.closest('button') && e.stopPropagation()}>
      <div className="wanted-top">
        <div className="stats">
          <Stat value={data.titles.length} label="Titles" small />
          <Stat value={data.totalItems} label="Missing" tone={data.totalItems ? 'warn' : 'ok'} small />
          {job ? <Stat value={job.grabbed} label="Grabbed" tone={job.grabbed ? 'ok' : ''} small /> : null}
          {job ? <Stat value={job.outcomes.skipped} label="Skipped" tone={job.outcomes.skipped ? 'warn' : ''} small /> : null}
        </div>
        <div className="wanted-actions" onPointerDown={(e) => e.stopPropagation()}>
          {running ? (
            <button className="btn sm danger" disabled={busy} onClick={() => act('cancel')}>
              <Icon name="stop" size={13} /> Cancel
            </button>
          ) : (
            <button className="btn sm primary" disabled={busy || !data.totalItems} onClick={() => act('start')} title="Search every missing item">
              <Icon name="search" size={13} /> {job ? 'Search again' : 'Search all missing'}
            </button>
          )}
          {job && !running ? (
            <button className="btn sm ghost" onClick={() => act('clear')} title="Clear report">
              <Icon name="x" size={13} />
            </button>
          ) : null}
        </div>
      </div>

      {job ? (
        <div className="meter job">
          <div className="row">
            <span>
              {running ? <i className="dot ok pulse" style={{ display: 'inline-block', marginRight: 6 }} /> : null}
              {running ? `Searching · ${job.current || '…'}` : job.state === 'COMPLETED' ? 'Search complete' : job.state === 'CANCELLED' ? 'Search cancelled' : job.state === 'FAILED' ? 'Search failed' : job.state.toLowerCase()}
            </span>
            <b>
              {job.processed}/{job.total}
              {job.failed ? <span style={{ color: 'var(--bad)' }}> · {job.failed} errors</span> : null}
            </b>
          </div>
          <div className={`bar ${running ? '' : job.state === 'COMPLETED' ? 'ok' : 'warn'}`}>
            <i style={{ width: `${job.total ? (job.processed / job.total) * 100 : running ? 5 : 100}%` }} />
          </div>
          <div className="row" style={{ fontSize: 11 }}>
            <span>
              <span style={{ color: 'var(--ok)' }}>{job.outcomes.found} found</span> · <span style={{ color: 'var(--warn)' }}>{job.outcomes.skipped} skipped</span> · {job.outcomes.none} nothing
              {running ? ` · ${job.outcomes.pending} waiting` : ''}
            </span>
            <span>{job.finishedAt ? `finished ${new Date(job.finishedAt).toLocaleTimeString()}` : `started ${new Date(job.startedAt).toLocaleTimeString()}`}</span>
          </div>
        </div>
      ) : null}
      {err ? <div className="err">{err}</div> : null}

      {data.titles.length ? (
        <ul className="list wanted">
          {titles.map((t) => (
            <TitleRow key={t.titleId} t={t} open={open.has(t.titleId)} onToggle={() => toggle(t.titleId)} />
          ))}
        </ul>
      ) : (
        <div className="empty">Nothing missing — library is complete.</div>
      )}
      {data.titles.length > max ? (
        <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${data.titles.length} titles`}
        </button>
      ) : null}
      {data.hasMore ? <div className="warn-line">Showing the first {data.shownItems} of {data.totalItems} missing items — raise the limit in the widget settings to see more.</div> : null}
      {error ? <div className="warn-line">Last refresh failed: {error}</div> : null}
    </div>
  );
}
