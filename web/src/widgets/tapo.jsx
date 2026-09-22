import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../lib/icons.jsx';
import { DataWidget } from './common.jsx';

/* ---------- helpers ---------- */
const TYPE = {
  ring: { icon: '🔔', label: 'Doorbell ring' },
  person: { icon: '🧍', label: 'Person' },
  vehicle: { icon: '🚗', label: 'Vehicle' },
  pet: { icon: '🐾', label: 'Pet' },
  package: { icon: '📦', label: 'Package' },
  baby: { icon: '👶', label: 'Baby cry' },
  tamper: { icon: '⚠️', label: 'Tamper' },
  linecrossing: { icon: '⛔', label: 'Line crossing' },
  intrusion: { icon: '🚧', label: 'Area intrusion' },
  bark: { icon: '🐶', label: 'Barking' },
  meow: { icon: '🐱', label: 'Meowing' },
  glassbreak: { icon: '🪟', label: 'Glass break' },
  smoke: { icon: '🔥', label: 'Smoke alarm' },
  package_taken: { icon: '📤', label: 'Package taken' },
  face: { icon: '🙂', label: 'Face' },
  loitering: { icon: '🕵️', label: 'Loitering' },
  motion: { icon: '👁', label: 'Motion' },
};
const clock = (unix) => new Date(unix * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const dur = (s) => (s < 60 ? `${Math.max(1, Math.round(s))}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`);
const rel = (unix) => {
  const s = Math.round(Date.now() / 1000 - unix);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const dayLabel = (unix) => {
  const d = new Date(unix * 1000);
  const t = new Date();
  const y = new Date(Date.now() - 86400_000);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
};
const ago = (ms) => {
  if (!ms) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};
const stop = (e) => {
  e.preventDefault();
  e.stopPropagation();
};

/* ---------- live player ---------- */
function Live({ stream, muted, onError }) {
  const ref = useRef();
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.src = `/go2rtc/api/stream.mp4?src=${encodeURIComponent(stream)}`;
    v.play().catch(() => {});
    return () => {
      v.pause();
      v.removeAttribute('src');
      v.load(); // closes the connection so go2rtc lets the camera sleep
    };
  }, [stream]);
  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
  }, [muted]);
  return <video ref={ref} muted={muted} playsInline autoPlay onError={onError} />;
}

/* ---------- lightbox for a stored event photo ---------- */
function Lightbox({ src, title, sub, onClose }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return createPortal(
    <div className="modal-bg lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onClick={(e) => e.stopPropagation()}>
      <figure>
        <img src={src} alt="" />
        <figcaption>
          <b>{title}</b>
          <span>{sub}</span>
          <button className="btn icon ghost" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </figcaption>
      </figure>
    </div>,
    document.body,
  );
}

/* ---------- one camera ---------- */
function Camera({ widget, cam, snapshots, playing, onPlay, onStop, single }) {
  const viewRef = useRef();
  const [imgFailed, setImgFailed] = useState(false);
  const [muted, setMuted] = useState(true);
  const [err, setErr] = useState('');
  const [fs, setFs] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [box, setBox] = useState(null);
  const photoUrl = (start) => `/api/widgets/${encodeURIComponent(widget.id)}/tapo/${encodeURIComponent(cam.id)}/event/${start}.jpg`;

  useEffect(() => {
    const h = () => setFs(document.fullscreenElement === viewRef.current);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);
  const toggleFs = (e) => {
    stop(e);
    if (document.fullscreenElement) document.exitFullscreen?.();
    else viewRef.current?.requestFullscreen?.();
  };

  const battLow = cam.battery != null && cam.battery <= 20;
  const snapUrl = `/api/widgets/${encodeURIComponent(widget.id)}/tapo/${encodeURIComponent(cam.id)}/snapshot`;
  const canPlay = cam.online !== false && !cam.streamError;
  const last = cam.events[0];

  const groups = useMemo(() => {
    const list = showAll ? cam.events : cam.events.slice(0, single ? 8 : 4);
    const out = [];
    for (const e of list) {
      const day = dayLabel(e.start);
      const g = out[out.length - 1];
      if (g && g.day === day) g.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [cam.events, showAll, single]);

  return (
    <div className={`cam ${single ? 'single' : ''}`}>
      <div className={`view ${playing ? 'is-live' : ''}`} ref={viewRef}>
        {playing ? (
          <Live stream={cam.stream} muted={muted} onError={() => setErr('Stream failed — go2rtc could not reach the camera')} />
        ) : snapshots && cam.snapshot && !imgFailed && cam.online !== false ? (
          <img src={snapUrl} alt="" loading="lazy" onError={() => setImgFailed(true)} />
        ) : cam.latestPhoto ? (
          <img src={photoUrl(cam.latestPhoto)} alt="" loading="lazy" className="last-event" />
        ) : (
          <div className="idle">
            <div className="lens" />
          </div>
        )}

        {/* overlays */}
        <div className="ov top">
          <span className="chip name">
            {cam.name}
            {cam.model ? <small>{cam.model}</small> : null}
          </span>
          <span className="spacer" />
          {cam.online === false ? <span className="chip bad">offline</span> : null}
          {cam.battery != null ? (
            <span className={`chip batt ${battLow ? 'bad' : ''}`} title={cam.charging ? 'charging' : 'battery'}>
              <i style={{ '--p': cam.battery }} />
              {cam.battery}%{cam.charging ? ' ⚡' : ''}
            </span>
          ) : null}
        </div>

        {playing ? <span className="live-badge">● LIVE</span> : null}

        {!playing && canPlay ? (
          <button className="play" onClick={onPlay} title="Start live view (wakes the camera)">
            <span>
              <Icon name="play" size={22} />
            </span>
            <em>{cam.battery != null ? 'Tap to wake & watch' : 'Live view'}</em>
          </button>
        ) : null}
        {!playing && !canPlay ? <div className="unavail">{cam.online === false ? 'Camera offline' : cam.streamError}</div> : null}
        {err ? <div className="unavail">{err}</div> : null}

        <div className="ov bottom">
          {!playing && last ? (
            <span className="chip">
              {TYPE[last.type]?.icon || '👁'} {rel(last.start)}
              {cam.latestPhoto && !(snapshots && cam.snapshot && !imgFailed) ? <small>· last event photo</small> : null}
            </span>
          ) : null}
          <span className="spacer" />
          <div className="ctrls" onPointerDown={(e) => e.stopPropagation()}>
            {playing ? (
              <>
                <button onClick={(e) => (stop(e), setMuted((m) => !m))} title={muted ? 'Unmute' : 'Mute'}>
                  <Icon name={muted ? 'muted' : 'sound'} size={15} />
                </button>
                <button onClick={onStop} title="Stop (lets the camera sleep)">
                  <Icon name="stop" size={15} />
                </button>
              </>
            ) : null}
            <button onClick={toggleFs} title={fs ? 'Exit fullscreen' : 'Fullscreen'}>
              <Icon name={fs ? 'shrink' : 'expand'} size={15} />
            </button>
          </div>
        </div>
      </div>

      <div className="timeline">
        <div className="tl-head">
          <span>Recent events</span>
          <span className="count">{cam.eventTotal ?? cam.events.length}</span>
        </div>
        {cam.eventsError ? <div className="tl-empty">{cam.eventsError}</div> : null}
        {!cam.eventsError && !cam.events.length ? <div className="tl-empty">Nothing in the last {widget.config?.hours || 24}h</div> : null}
        {groups.map((g) => (
          <div key={g.day} className="tl-day">
            <h5>{g.day}</h5>
            {g.items.map((e, i) => {
              const t = TYPE[e.type] || TYPE.motion;
              return (
                <div key={i} className={`ev ev-${e.type} ${e.photo ? 'has-photo' : ''}`} title={JSON.stringify(e.raw)} onClick={e.photo ? (ev) => (stop(ev), setBox(e)) : undefined}>
                  {e.photo ? <img className="thumb" src={photoUrl(e.photo)} alt="" loading="lazy" /> : <span className="ico">{t.icon}</span>}
                  <span className="txt">
                    <b>{t.label}</b>
                    <small>{rel(e.start)}</small>
                  </span>
                  <span className="when">
                    {clock(e.start)}
                    {e.end && e.start ? <small>{dur(e.end - e.start)}</small> : null}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {cam.photoError ? <div className="tl-empty" title={cam.photoError}>Photo capture failed last time</div> : null}
        {cam.events.length > (single ? 8 : 4) ? (
          <button className="tl-more" onClick={(e) => (stop(e), setShowAll((v) => !v))}>
            {showAll ? 'Show fewer' : `Show all ${cam.events.length}`}
          </button>
        ) : null}
      </div>
      {box ? <Lightbox src={photoUrl(box.photo)} title={`${cam.name} — ${(TYPE[box.type] || TYPE.motion).label}`} sub={`${dayLabel(box.start)} ${clock(box.start)} · ${rel(box.start)}`} onClose={() => setBox(null)} /> : null}
    </div>
  );
}

/* ---------- widget ---------- */
export function TapoWidget({ widget }) {
  const [playing, setPlaying] = useState(null);
  return (
    <div
      className="card-body tapo"
      onClick={(e) => e.target.closest('button, video, .ctrls') && stop(e)}
      onPointerDown={(e) => e.target.closest('button, video, .ctrls') && e.stopPropagation()}
    >
      {/* the server refuses to contact cameras more often than every 10 minutes; poll at that cadence */}
      <DataWidget widget={widget} poll={10 * 60_000}>
        {(d) => (
          <>
            {!d.go2rtc ? <div className="warn-line">go2rtc isn't reachable — live view and snapshots are unavailable until the go2rtc service is up.</div> : null}
            <div className={`cams ${d.cameras.length === 1 ? 'one' : ''}`}>
              {d.cameras.map((cam) => (
                <Camera
                  key={cam.id}
                  widget={widget}
                  cam={cam}
                  single={d.cameras.length === 1}
                  snapshots={d.snapshotPolicy !== 'off' && d.go2rtc}
                  playing={playing === cam.id}
                  onPlay={(e) => (stop(e), setPlaying(cam.id))}
                  onStop={(e) => (stop(e), setPlaying(null))}
                />
              ))}
              {!d.cameras.length ? <div className="empty">No cameras found behind {widget.config?.host}.</div> : null}
            </div>
            <div className="cam-foot">
              <span>
                {d.host?.name && d.host?.hub ? `${d.host.name} · ` : ''}
                updated {ago(d.fetchedAt)} · refreshes at most every 10 min
              </span>
              <span>▶ wakes the camera only while you watch</span>
            </div>
          </>
        )}
      </DataWidget>
    </div>
  );
}
