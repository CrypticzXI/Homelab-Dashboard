import React, { useEffect, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { WIDGETS } from '../widgets/index.jsx';
import { CardStatusContext } from '../widgets/common.jsx';
import { Icon, ServiceIcon } from '../lib/icons.jsx';
import { hostOf } from '../lib/format.js';

/** "3s ago" style ticker for the header. */
function useAgo(at) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!at) return;
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [at]);
  if (!at) return '';
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 5 ? 'now' : s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
}

const compact = (n) => (n == null ? '—' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

/** Stars / issues / commits row for github.com bookmarks. */
function GithubStats({ g }) {
  if (!g) return null;
  if (g.error) return <div className="gh-stats err-line" title={g.error}>GitHub: {g.error}</div>;
  if (g.kind === 'user') {
    return (
      <div className="gh-stats">
        <span title="public repos">📦 {compact(g.repos)}</span>
        <span title="followers">👥 {compact(g.followers)}</span>
      </div>
    );
  }
  return (
    <div className="gh-stats" title={`${g.name}${g.language ? ` · ${g.language}` : ''}${g.pushed ? ` · pushed ${new Date(g.pushed).toLocaleDateString()}` : ''}`}>
      <span title="stars">★ {compact(g.stars)}</span>
      <span title="open issues">◎ {compact(g.issues)}</span>
      <span title="commits">⑂ {compact(g.commits)}</span>
      {g.archived ? <span className="tag warn">archived</span> : null}
    </div>
  );
}

/** 24h uptime strip (48 × 30-min buckets) shown under a bookmark tile. */
function UptimeBar({ u }) {
  if (!u || !u.samples) return null;
  return (
    <div className="uptime" title={`${u.uptime}% uptime · avg ${u.avgMs ?? '—'} ms · ${u.samples} checks in 24h`}>
      {u.buckets.map((b, i) => (
        <i key={i} className={b.ok == null ? 'none' : b.ok >= 0.999 ? 'up' : b.ok > 0 ? 'part' : 'down'} />
      ))}
      <b>{u.uptime != null ? `${u.uptime}%` : ''}</b>
    </div>
  );
}

function StatusBadge({ status, isLink }) {
  const ago = useAgo(status?.at);
  if (!status) return null;
  if (isLink) {
    const d = status.data;
    if (!status.ok || !d?.ping) return status.ok ? null : <span className="tag bad">down</span>;
    return (
      <>
        <span className="ms">{d.ms} ms</span>
        <span className={`tag ${d.ok ? 'ok' : 'bad'}`}>{d.ok ? 'up' : 'down'}</span>
      </>
    );
  }
  return (
    <>
      <span className="ms">{ago}</span>
      <i className={`dot ${status.ok ? 'ok' : 'bad'}`} title={status.error || 'OK'} />
    </>
  );
}

export default function WidgetCard({ widget, editing, column, onEdit, onDelete }) {
  const def = WIDGETS[widget.type];
  const [status, setStatus] = useState(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    disabled: !editing,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const isLink = widget.type === 'link';
  const href = isLink ? widget.config?.url : widget.url;
  const clickable = !!href && !editing;
  // Keep the same element type in and out of edit mode so the widget doesn't remount (and refetch).
  const Tag = href ? 'a' : 'div';
  const linkProps = href
    ? { href, target: widget.newTab === false ? '_self' : '_blank', rel: 'noreferrer', onClick: editing ? (e) => e.preventDefault() : undefined }
    : {};

  const w = column ? 1 : Math.min(4, Math.max(1, Number(widget.w) || def?.defaultW || 1));
  const cls = [
    'card',
    column ? 'col-card' : `w-${w}`,
    isLink ? 'tile' : '',
    clickable ? 'clickable' : '',
    editing ? 'editing' : '',
    isDragging ? 'dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const icon = widget.icon || (isLink ? widget.config?.icon : def?.icon);
  const subtitle = widget.subtitle || (isLink ? widget.config?.subtitle || hostOf(widget.config?.url) : '');

  const body = def ? (
    <def.component widget={widget} />
  ) : (
    <div className="card-body">
      <div className="err">Unknown widget type “{widget.type}”</div>
    </div>
  );

  return (
    <CardStatusContext.Provider value={setStatus}>
      <Tag ref={setNodeRef} style={style} className={cls} {...linkProps} {...(editing ? { ...attributes, ...listeners } : {})}>
        {editing ? (
          <div className="edit-tools" onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" title="Edit" onClick={() => onEdit(widget)}>
              <Icon name="edit" size={14} />
            </button>
            <button type="button" className="del" title="Remove" onClick={() => onDelete(widget)}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        ) : null}
        <div className="card-head">
          <div className="wicon">
            <ServiceIcon icon={icon} title={widget.title} size={22} />
          </div>
          <div className="ttl">
            <span className="t">{widget.title}</span>
            {subtitle ? <span className="st">{subtitle}</span> : null}
          </div>
          {!editing ? (
            <div className="card-status">
              <StatusBadge status={status} isLink={isLink} />
            </div>
          ) : null}
          {clickable && !isLink ? <Icon name="external" size={14} className="ext" /> : null}
        </div>
        {body}
        {isLink && !editing && status?.data?.github ? <GithubStats g={status.data.github} /> : null}
        {isLink && !editing && status?.data?.uptime ? <UptimeBar u={status.data.uptime} /> : null}
      </Tag>
    </CardStatusContext.Provider>
  );
}
