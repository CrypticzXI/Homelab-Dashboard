import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './lib/api.js';
import { Icon } from './lib/icons.jsx';
import { uid } from './lib/format.js';
import Login from './components/Login.jsx';
import Section, { widgetMatches } from './components/Section.jsx';
import TopBar from './components/TopBar.jsx';
import WidgetEditor from './components/WidgetEditor.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import { SavedWidgetsContext } from './widgets/common.jsx';
import { applyTheme } from './lib/themes.js';
import { api as apiClient } from './lib/api.js';

/** Apply background + accent to the document as CSS variables. */
function Background({ config }) {
  const bg = config.background || {};
  const [bingUrl, setBingUrl] = useState('');
  useEffect(() => {
    if (bg.type === 'bing' && !bg.url) apiClient.bingWallpapers().then((r) => setBingUrl(r.images?.[0]?.url || '')).catch(() => {});
  }, [bg.type, bg.url]);
  let image = '';
  if (bg.type === 'bing') image = bg.url || bingUrl;
  else if (bg.type === 'random') image = `https://picsum.photos/seed/${encodeURIComponent(bg.seed || 'homelab')}/1920/1080${bg.grayscale ? '?grayscale' : ''}`;
  else if (bg.type !== 'gradient') image = bg.url || '';
  const hasImage = !!image;
  useEffect(() => {
    applyTheme(config.theme || 'aurora', config.accent, config.glass || {});
    const r = document.documentElement.style;
    r.setProperty('--bg-dim', hasImage ? String((bg.dim ?? 45) / 100) : '0');
    r.setProperty('--bg-blur', `${bg.blur ?? 0}px`);
    r.setProperty('--bg-image', hasImage ? `url("${image}")` : 'none');
    document.title = config.title || 'Homelab';
  }, [config.theme, config.accent, config.title, image, bg.dim, bg.blur, hasImage, JSON.stringify(config.glass || {})]);
  return (
    <>
      <div className={`bg ${hasImage ? 'has-image' : 'aurora'}`} />
      <div className="bg-dim" />
      <div className="grain" />
    </>
  );
}

export default function App() {
  const [auth, setAuth] = useState('checking'); // checking | out | in
  const [saved, setSaved] = useState(null); // config as on server
  const [config, setConfig] = useState(null); // working copy
  const [editing, setEditing] = useState(false);
  const [editor, setEditor] = useState(null); // { widget?, sectionId }
  const [settings, setSettings] = useState(false);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [down, setDown] = useState([]);

  // poll the uptime monitor for anything currently down
  useEffect(() => {
    if (auth !== 'in') return;
    let alive = true;
    const tick = () => apiClient.down().then((r) => alive && setDown(r.down || [])).catch(() => {});
    tick();
    const t = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [auth]);

  const showToast = (msg, bad = false) => {
    setToast({ msg, bad });
    setTimeout(() => setToast(null), 2500);
  };

  const load = useCallback(async () => {
    const cfg = await api.getConfig();
    setSaved(cfg);
    setConfig(cfg);
  }, []);

  useEffect(() => {
    api
      .me()
      .then(() => setAuth('in'))
      .catch(() => setAuth('out'));
  }, []);
  useEffect(() => {
    if (auth === 'in') load().catch((e) => showToast(e.message, true));
  }, [auth, load]);

  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(config), [saved, config]);

  // id -> {type, config} as stored on the server, so unsaved widgets don't poll for data that isn't there yet
  const savedWidgets = useMemo(() => {
    const m = new Map();
    for (const s of saved?.sections || []) for (const w of s.widgets || []) m.set(w.id, JSON.stringify({ type: w.type, config: w.config || {} }));
    return m;
  }, [saved]);

  // warn before leaving with unsaved edits
  useEffect(() => {
    if (!dirty) return;
    const h = (e) => (e.preventDefault(), (e.returnValue = ''));
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const save = async () => {
    setSaving(true);
    try {
      const cfg = await api.saveConfig(config);
      setSaved(cfg);
      setConfig(cfg);
      setEditing(false);
      showToast('Saved');
    } catch (e) {
      showToast(e.message, true);
    } finally {
      setSaving(false);
    }
  };
  const discard = () => {
    setConfig(saved);
    setEditing(false);
  };

  const logout = async () => {
    await api.logout();
    setAuth('out');
    setConfig(null);
    setSaved(null);
  };

  /* ---- section helpers ---- */
  const updateSection = (idx, next) =>
    setConfig((c) => ({ ...c, sections: c.sections.map((s, i) => (i === idx ? next : s)) }));
  const deleteSection = (idx) => {
    const s = config.sections[idx];
    if (s.widgets.length && !window.confirm(`Delete "${s.title}" and its ${s.widgets.length} widget(s)?`)) return;
    setConfig((c) => ({ ...c, sections: c.sections.filter((_, i) => i !== idx) }));
  };
  const moveSection = (idx, dir) =>
    setConfig((c) => {
      const s = [...c.sections];
      const [item] = s.splice(idx, 1);
      s.splice(idx + dir, 0, item);
      return { ...c, sections: s };
    });
  const addSection = () => setConfig((c) => ({ ...c, sections: [...c.sections, { id: uid('sec'), title: 'New section', layout: 'column', widgets: [] }] }));

  /* ---- widget save from editor ---- */
  const saveWidget = (widget, targetSectionId) => {
    setConfig((c) => {
      const sections = c.sections.map((s) => ({ ...s, widgets: s.widgets.filter((w) => w.id !== widget.id) }));
      const target = sections.find((s) => s.id === targetSectionId) || sections[0];
      // keep original position when editing in place
      const origSection = c.sections.find((s) => s.widgets.some((w) => w.id === widget.id));
      if (origSection && origSection.id === target.id) {
        const idx = origSection.widgets.findIndex((w) => w.id === widget.id);
        target.widgets.splice(idx, 0, widget);
      } else {
        target.widgets.push(widget);
      }
      return { ...c, sections };
    });
    setEditor(null);
  };

  const openFirstMatch = () => {
    if (!config || !query) return;
    for (const s of config.sections) {
      for (const w of s.widgets) {
        const href = w.type === 'link' ? w.config?.url : w.url;
        if (href && widgetMatches(w, query)) {
          window.open(href, w.newTab === false ? '_self' : '_blank', 'noreferrer');
          setQuery('');
          return;
        }
      }
    }
  };

  /** Consecutive column sections render side by side; grid sections take the full width. */
  const groups = useMemo(() => {
    const out = [];
    (config?.sections || []).forEach((section, idx) => {
      const isCol = section.layout === 'column';
      const last = out[out.length - 1];
      if (isCol && last?.type === 'columns') last.items.push({ section, idx });
      else out.push({ type: isCol ? 'columns' : 'grid', items: [{ section, idx }] });
    });
    return out;
  }, [config]);

  if (auth === 'checking') return <div className="loading-screen">Loading…</div>;
  if (auth === 'out')
    return (
      <>
        <div className="bg" />
        <Login onLogin={() => setAuth('in')} />
      </>
    );
  if (!config) return <div className="loading-screen">Loading dashboard…</div>;

  return (
    <SavedWidgetsContext.Provider value={savedWidgets}>
      <Background config={config} />
      <div className="app">
        {editing ? (
          <div className="edit-banner">
            <Icon name="edit" size={16} />
            <span>Edit mode — drag cards to reorder, click ✎ to configure.</span>
            {dirty ? <span className="unsaved">Unsaved changes</span> : null}
            <span className="spacer" />
            <button className="btn sm" onClick={addSection}>
              <Icon name="plus" size={14} /> Section
            </button>
            <button className="btn sm" onClick={() => setSettings(true)}>
              <Icon name="image" size={14} /> Background & theme
            </button>
            <button className="btn sm ghost" onClick={discard}>
              Discard
            </button>
            <button className="btn sm primary" onClick={save} disabled={saving || !dirty}>
              <Icon name="check" size={14} /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : null}

        {down.length && !editing ? (
          <div className="alert-banner">
            <Icon name="bell" size={16} />
            <b>{down.length === 1 ? '1 service is down' : `${down.length} services are down`}:</b>
            {down.map((d) => (
              <a key={d.id} href={d.url} target="_blank" rel="noreferrer" className="tag bad" title={`since ${new Date(d.since).toLocaleTimeString()}`}>
                {d.title}
              </a>
            ))}
          </div>
        ) : null}
        <TopBar
          config={config}
          query={query}
          onQuery={setQuery}
          onEnter={openFirstMatch}
          editing={editing}
          onEdit={() => setEditing(true)}
          onLogout={logout}
        />

        {!editing && config.sections.filter((s) => s.widgets.some((w) => widgetMatches(w, query))).length > 1 ? (
          <nav className="section-nav" aria-label="Sections">
            {config.sections
              .filter((s) => s.widgets.some((w) => widgetMatches(w, query)))
              .map((s) => (
                <a key={s.id} href={`#sec-${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`sec-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                  {s.title}
                </a>
              ))}
          </nav>
        ) : null}
        {groups.map((g, gi) => (
          <div key={gi} className={g.type === 'columns' ? 'columns' : undefined}>
            {g.items.map(({ section, idx }) => (
              <Section
                key={section.id}
                section={section}
                editing={editing}
                query={query}
                onChange={(next) => updateSection(idx, next)}
                onDelete={() => deleteSection(idx)}
                onMove={(dir) => moveSection(idx, dir)}
                canMoveUp={idx > 0}
                canMoveDown={idx < config.sections.length - 1}
                onAdd={() => setEditor({ sectionId: section.id })}
                onEditWidget={(w) => setEditor({ widget: w, sectionId: section.id })}
              />
            ))}
          </div>
        ))}

        {!editing && config.sections.every((s) => !s.widgets.some((w) => widgetMatches(w, query))) ? (
          <div className="loading-screen" style={{ minHeight: '40vh' }}>
            {query ? `No services match “${query}”.` : 'Nothing here yet — hit Edit (desktop) to add widgets.'}
          </div>
        ) : null}
      </div>

      {editor ? (
        <WidgetEditor
          widget={editor.widget}
          sectionId={editor.sectionId}
          sections={config.sections}
          onSave={saveWidget}
          onClose={() => setEditor(null)}
        />
      ) : null}
      {settings ? <SettingsModal config={config} onChange={setConfig} onClose={() => setSettings(false)} /> : null}
      {toast ? <div className={`toast ${toast.bad ? 'bad' : ''}`}>{toast.msg}</div> : null}
    </SavedWidgetsContext.Provider>
  );
}
