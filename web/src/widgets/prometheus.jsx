import React from 'react';
import { DataWidget, Stat } from './common.jsx';

/** Shows chosen metrics from any Prometheus /metrics endpoint as stat tiles. */
export function PrometheusWidget({ widget }) {
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={30_000}>
        {(d) =>
          d.fields.length ? (
            <div className="stats">
              {d.fields.map((f, i) => (
                <Stat key={i} value={f.value} label={f.label} small />
              ))}
            </div>
          ) : (
            <div className="empty">Connected ({d.families} metric families). Edit this widget and add metrics to show.</div>
          )
        }
      </DataWidget>
    </div>
  );
}
