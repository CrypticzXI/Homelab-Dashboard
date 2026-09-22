import React, { useEffect, useState } from 'react';
import { DataWidget, Stat, useIsSaved, useWidgetData } from './common.jsx';

/* ---------- Bookmark ----------
 * The tile is entirely the card header (icon / title / subtitle / ping);
 * this component only drives the ping poll. */
export function LinkWidget({ widget }) {
  const c = widget.config || {};
  const isSaved = useIsSaved(widget);
  useWidgetData(widget, 30_000, isSaved && c.ping !== false);
  return null;
}

/* ---------- Clock ---------- */
export function ClockWidget({ widget }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const tz = widget.config?.timezone || undefined;
  const h24 = widget.config?.h24 !== false;
  let time, date;
  try {
    time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: !h24, timeZone: tz });
    date = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz });
  } catch {
    time = now.toLocaleTimeString();
    date = 'Invalid timezone';
  }
  return (
    <div className="card-body center">
      <div className="big-time">{time}</div>
      <div className="big-date">{date}</div>
    </div>
  );
}

/* ---------- Weather ---------- */
export function WeatherWidget({ widget }) {
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={10 * 60_000}>
        {(d) => (
          <>
            <div className="weather-main">
              <div className="ico">{d.icon}</div>
              <div>
                <div className="temp">
                  {d.temp}
                  {d.unit}
                </div>
                <div className="cond">
                  {d.condition} · feels {d.feels}° · {d.humidity}% · {d.wind} km/h
                </div>
              </div>
            </div>
            <div className="weather-days">
              {d.daily.map((day) => (
                <div key={day.day}>
                  {day.day}
                  <span>{day.icon}</span>
                  <b>{day.max}°</b> {day.min}°
                </div>
              ))}
            </div>
          </>
        )}
      </DataWidget>
    </div>
  );
}

/* ---------- Generic JSON ---------- */
export function GenericWidget({ widget }) {
  return (
    <div className="card-body">
      <DataWidget widget={widget} poll={30_000}>
        {(d) =>
          d.fields.length ? (
            <div className="stats">
              {d.fields.map((f, i) => (
                <Stat key={i} value={`${f.value}${f.suffix}`} label={f.label} small />
              ))}
            </div>
          ) : (
            <div className="empty">No fields configured — edit this widget and add JSON paths.</div>
          )
        }
      </DataWidget>
    </div>
  );
}
