import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { THEMES, THEME_ORDER, glassDefaults } from '../lib/themes.js';

const SWATCHES = ['#7c5cff', '#ff5cab', '#22d3ee', '#34d399', '#fbbf24', '#f87171', '#60a5fa', '#a78bfa', '#00e5ff', '#fe8019'];
const TABS = ['Look', 'Background', 'Alerts'];

export default function SettingsModal({ config, onChange, onClose }) {
  const bg = config.background || {};
  const alerts = config.alerts || {};
  const fileRef = useRef();
  const [tab, setTab] = useState('Look');
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const [bing, setBing] = useState(null);
  const [testMsg, setTestMsg] = useState('');

  const setBg = (patch) => onChange({ ...config, background: { ...bg, ...patch } });
  const glass = config.glass || {};
  const gd = glassDefaults(config.theme || 'aurora');
  const setGlass = (patch) => onChange({ ...config, glass: { ...glass, ...patch } });
  const setAlerts = (patch) => onChange({ ...config, alerts: { ...alerts, ...patch } });

  useEffect(() => {
    if (tab === 'Background' && bing === null) api.bingWallpapers().then((r) => setBing(r.images || [])).catch(() => setBing([]));
  }, [tab, bing]);

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    setErr('');
    try {
      const r = await api.uploadBackground(file);
      setBg({ type: 'upload', url: r.url });
    } catch (e) {
      setErr(e.message);
    } finally {
      setUploading(false);
    }
  };

  const testAlert = async () => {
    setTestMsg('Sending…');
    const r = await api.testAlert(alerts).catch((e) => ({ ok: false, error: e.message }));
    setTestMsg(r.ok ? '✓ Sent — check your channel' : `✗ ${r.error}`);
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>Dashboard settings</h3>
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>

        {tab === 'Look' ? (
          <>
            <div className="field-row">
              <div className="field">
                <label>Title</label>
                <input value={config.title || ''} onChange={(e) => onChange({ ...config, title: e.target.value })} />
              </div>
              <div className="field">
                <label>Subtitle</label>
                <input value={config.subtitle || ''} onChange={(e) => onChange({ ...config, subtitle: e.target.value })} />
              </div>
            </div>
            <div className="field">
              <label>Theme</label>
              <div className="theme-grid">
                {THEME_ORDER.map((id) => {
                  const t = THEMES[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      className={(config.theme || 'aurora') === id ? 'active' : ''}
                      style={{ background: t.vars['--bg'], color: t.vars['--text'] }}
                      onClick={() => onChange({ ...config, theme: id, accent: '', glass: {} })}
                    >
                      <span className="sw" style={{ background: `linear-gradient(135deg, ${t.vars['--accent']}, ${t.vars['--accent-2']})` }} />
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="field">
              <label>
                Accent override <small>— blank uses the theme's own</small>
              </label>
              <div className="swatches">
                {SWATCHES.map((c) => (
                  <button key={c} type="button" className={config.accent === c ? 'active' : ''} style={{ background: c }} onClick={() => onChange({ ...config, accent: c })} />
                ))}
                <input type="color" value={config.accent || THEMES[config.theme || 'aurora'].vars['--accent']} onChange={(e) => onChange({ ...config, accent: e.target.value })} />
                {config.accent ? (
                  <button type="button" className="btn sm ghost" onClick={() => onChange({ ...config, accent: '' })}>
                    Reset
                  </button>
                ) : null}
              </div>
            </div>
            <div className="field">
              <label>
                Glass tint <small>— colour that sits inside the glass; blank follows the accent</small>
              </label>
              <div className="swatches">
                {SWATCHES.map((c) => (
                  <button key={c} type="button" className={glass.tint === c ? 'active' : ''} style={{ background: c }} onClick={() => setGlass({ tint: c })} />
                ))}
                <input type="color" value={glass.tint || config.accent || THEMES[config.theme || 'aurora'].vars['--accent']} onChange={(e) => setGlass({ tint: e.target.value })} />
                {glass.tint ? (
                  <button type="button" className="btn sm ghost" onClick={() => setGlass({ tint: '' })}>
                    Follow accent
                  </button>
                ) : null}
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Tint strength</label>
                <div className="range">
                  <input type="range" min="0" max="40" value={glass.amount ?? gd.amount} onChange={(e) => setGlass({ amount: Number(e.target.value) })} />
                  <span>{glass.amount ?? gd.amount}%</span>
                </div>
              </div>
              <div className="field">
                <label>Glass blur</label>
                <div className="range">
                  <input type="range" min="6" max="60" value={glass.blur ?? gd.blur} onChange={(e) => setGlass({ blur: Number(e.target.value) })} />
                  <span>{glass.blur ?? gd.blur}px</span>
                </div>
              </div>
            </div>
            <div className="field">
              <label className="check">
                <input type="checkbox" checked={config.topbar?.showSystem !== false} onChange={(e) => onChange({ ...config, topbar: { ...(config.topbar || {}), showSystem: e.target.checked } })} />
                Show host stats in the top bar
              </label>
            </div>
          </>
        ) : null}

        {tab === 'Background' ? (
          <>
            <div className="field">
              <label>Source</label>
              <select value={bg.type || 'gradient'} onChange={(e) => setBg({ type: e.target.value })}>
                <option value="gradient">Animated aurora (theme colours)</option>
                <option value="bing">Bing image of the day</option>
                <option value="random">Random photo (picsum.photos)</option>
                <option value="url">Image from URL</option>
                <option value="upload">Uploaded image</option>
              </select>
            </div>
            {bg.type === 'bing' ? (
              <div className="field">
                <label>Pick one <small>— or leave unset to always show today's</small></label>
                <div className="wall-grid">
                  {(bing || []).map((i) => (
                    <button key={i.url} type="button" className={bg.url === i.url ? 'active' : ''} title={i.title} onClick={() => setBg({ url: bg.url === i.url ? '' : i.url })}>
                      <img src={i.thumb} alt="" loading="lazy" />
                    </button>
                  ))}
                  {bing === null ? <small>Loading…</small> : null}
                </div>
              </div>
            ) : null}
            {bg.type === 'random' ? (
              <div className="field-row">
                <div className="field">
                  <label>Seed <small>— change it to get a different photo</small></label>
                  <input value={bg.seed || ''} placeholder="homelab" onChange={(e) => setBg({ seed: e.target.value })} />
                </div>
                <div className="field">
                  <label className="check" style={{ marginTop: 26 }}>
                    <input type="checkbox" checked={!!bg.grayscale} onChange={(e) => setBg({ grayscale: e.target.checked })} />
                    Black & white
                  </label>
                </div>
              </div>
            ) : null}
            {bg.type === 'url' ? (
              <div className="field">
                <label>Image URL</label>
                <input type="url" placeholder="https://…/wallpaper.jpg" value={bg.url || ''} onChange={(e) => setBg({ url: e.target.value })} />
              </div>
            ) : null}
            {bg.type === 'upload' ? (
              <div className="field">
                <label>Upload <small>— jpeg / png / webp / gif / avif, up to 25 MB</small></label>
                <input ref={fileRef} type="file" accept="image/*" onChange={(e) => upload(e.target.files?.[0])} />
                {uploading ? <small style={{ color: 'var(--muted)' }}>Uploading…</small> : null}
                {bg.url && bg.url.startsWith('/api/background/') ? <small style={{ color: 'var(--ok)' }}>Image uploaded ✓</small> : null}
                {err ? <small style={{ color: 'var(--bad)' }}>{err}</small> : null}
              </div>
            ) : null}
            {bg.type !== 'gradient' ? (
              <div className="field-row">
                <div className="field">
                  <label>Dim</label>
                  <div className="range">
                    <input type="range" min="0" max="90" value={bg.dim ?? 45} onChange={(e) => setBg({ dim: Number(e.target.value) })} />
                    <span>{bg.dim ?? 45}%</span>
                  </div>
                </div>
                <div className="field">
                  <label>Blur</label>
                  <div className="range">
                    <input type="range" min="0" max="30" value={bg.blur ?? 0} onChange={(e) => setBg({ blur: Number(e.target.value) })} />
                    <span>{bg.blur ?? 0}px</span>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {tab === 'Alerts' ? (
          <>
            <p className="hint">
              Bookmark tiles are pinged every minute in the background. When one fails twice in a row you get a notification, and another when it recovers. A red banner also appears at the top of the dashboard.
            </p>
            <div className="field">
              <label className="check">
                <input type="checkbox" checked={!!alerts.enabled} onChange={(e) => setAlerts({ enabled: e.target.checked })} />
                Send notifications
              </label>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Service</label>
                <select value={alerts.type || 'auto'} onChange={(e) => setAlerts({ type: e.target.value })}>
                  <option value="auto">Detect from URL</option>
                  <option value="discord">Discord webhook</option>
                  <option value="slack">Slack webhook</option>
                  <option value="ntfy">ntfy topic URL</option>
                  <option value="telegram">Telegram bot</option>
                  <option value="generic">Generic JSON webhook</option>
                </select>
              </div>
              <div className="field">
                <label>Webhook URL <small>— stored server-side</small></label>
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={alerts.webhookUrl === '__SECRET__' ? '•••••••• (saved)' : alerts.type === 'telegram' ? 'https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>' : 'https://…'}
                  value={alerts.webhookUrl === '__SECRET__' ? '' : alerts.webhookUrl || ''}
                  onChange={(e) => setAlerts({ webhookUrl: e.target.value })}
                />
              </div>
            </div>
            <div className="actions" style={{ justifyContent: 'flex-start', marginTop: 0 }}>
              <button type="button" className="btn sm" onClick={testAlert} disabled={!alerts.webhookUrl}>
                Send test
              </button>
              <span style={{ fontSize: 12, color: testMsg.startsWith('✓') ? 'var(--ok)' : 'var(--muted)' }}>{testMsg}</span>
            </div>
          </>
        ) : null}

        <div className="actions">
          <span className="hint" style={{ marginRight: 'auto', marginBottom: 0 }}>Changes apply live — hit Save in the edit bar to keep them.</span>
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
