import React from 'react';
import { DataWidget, Meter, Stat } from './common.jsx';

/**
 * Standard renderer for the integration pack: a stats row, optional meters,
 * a list of rows (with dot / progress / link), chips and a footnote.
 * Fetchers in api/src/integrations/apps.js produce this shape.
 */
export function StdWidget({ widget }) {
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={Number(widget.config?.poll) || 30_000}>
        {(d) => (
          <>
            {d.stats?.length ? (
              <div className="stats">
                {d.stats.map((s, i) => (
                  <Stat key={i} value={s.value} label={s.label} tone={s.tone} small />
                ))}
              </div>
            ) : null}
            {d.meters?.map((m, i) => (
              <Meter key={i} label={m.label} value={m.value} pct={m.pct} tone={m.tone} />
            ))}
            {d.rows?.length ? (
              <ul className="list compact">
                {d.rows.map((r, i) => (
                  <li key={i} className={r.pct != null ? 'with-bar' : ''}>
                    {r.dot !== undefined ? <i className={`dot ${r.dot}`} /> : null}
                    <span className="name" title={r.sub || r.name}>
                      {r.href ? (
                        <a href={r.href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                          {r.name}
                        </a>
                      ) : (
                        r.name
                      )}
                      {r.sub ? <small>{r.sub}</small> : null}
                      {r.pct != null ? (
                        <div className={`bar thin ${r.tone || ''}`} style={{ marginTop: 4 }}>
                          <i style={{ width: `${Math.min(100, Math.max(0, r.pct))}%` }} />
                        </div>
                      ) : null}
                    </span>
                    {r.tag ? <span className={`tag ${r.tone || ''}`}>{r.tag}</span> : null}
                    {r.value ? <span className="val">{r.value}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {d.chips?.length ? (
              <div className="chips">
                {d.chips.map((ch, i) => (
                  <span key={i} className={`tag ${ch.tone || ''}`} style={{ textTransform: 'none', letterSpacing: 0 }}>
                    {ch.text}
                  </span>
                ))}
              </div>
            ) : null}
            {d.note || d.version ? (
              <div className="meter">
                <div className="row">
                  <span>{d.note || ''}</span>
                  {d.version ? <b style={{ color: 'var(--dim)', fontWeight: 500 }}>{d.version}</b> : null}
                </div>
              </div>
            ) : null}
            {!d.stats?.length && !d.rows?.length && !d.meters?.length ? <div className="empty">Connected — nothing to show yet.</div> : null}
          </>
        )}
      </DataWidget>
    </div>
  );
}
