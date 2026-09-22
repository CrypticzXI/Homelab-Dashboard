import React, { useState } from 'react';
import { WIDGETS, CATEGORIES } from '../widgets/index.jsx';
import { api } from '../lib/api.js';
import { uid } from '../lib/format.js';

const SECRET = '__SECRET__';

function defaultsFor(type) {
  const cfg = {};
  for (const f of WIDGETS[type].fields) if (f.default !== undefined) cfg[f.key] = structuredClone(f.default);
  return cfg;
}

/** Renders one config field based on its `kind`. */
function Field({ field, value, onChange }) {
  const { key, label, kind, placeholder, hint, options, required } = field;
  const lbl = (
    <label>
      {label}
      {required ? ' *' : ''} {hint ? <small>— {hint}</small> : null}
    </label>
  );

  if (kind === 'checkbox') {
    return (
      <div className="field">
        <label className="check">
          <input type="checkbox" checked={value !== false && value != null ? !!value : !!field.default} onChange={(e) => onChange(e.target.checked)} />
          {label}
        </label>
      </div>
    );
  }
  if (kind === 'select') {
    return (
      <div className="field">
        {lbl}
        <select value={value ?? field.default ?? ''} onChange={(e) => onChange(e.target.value)}>
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (kind === 'secret' || kind === 'secret-textarea') {
    const isSet = value === SECRET;
    const Input = kind === 'secret' ? 'input' : 'textarea';
    return (
      <div className="field">
        {lbl}
        <Input
          type={kind === 'secret' ? 'password' : undefined}
          autoComplete="off"
          placeholder={isSet ? '•••••••• (saved — leave blank to keep)' : placeholder}
          value={isSet ? '' : value || ''}
          onChange={(e) => onChange(e.target.value === '' && isSet ? SECRET : e.target.value)}
          onFocus={(e) => {
            if (isSet) e.target.placeholder = 'Type a new value to replace the saved one';
          }}
          onBlur={(e) => {
            if (e.target.value === '' && value !== SECRET && isSet) onChange(SECRET);
          }}
        />
        {isSet ? (
          <small style={{ color: 'var(--dim)', fontSize: 11 }}>
            A value is saved on the server.{' '}
            <a href="#" style={{ color: 'var(--accent)' }} onClick={(e) => (e.preventDefault(), onChange(''))}>
              Clear it
            </a>
          </small>
        ) : null}
      </div>
    );
  }
  if (kind === 'list') {
    return (
      <div className="field">
        {lbl}
        <input
          placeholder={placeholder}
          value={Array.isArray(value) ? value.join(', ') : value || ''}
          onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
        />
      </div>
    );
  }
  if (kind === 'metrics') {
    const rows = Array.isArray(value) ? value : [];
    const set = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    const FORMATS = [['number', '123'], ['bytes', 'GB'], ['percent', '%'], ['seconds', '1h 2m'], ['ago', 'x ago'], ['until', 'in x'], ['bool', 'yes/no'], ['raw', 'raw']];
    return (
      <div className="field">
        {lbl}
        {rows.map((r, i) => (
          <div key={i} className="metric-row">
            <input placeholder="Label" value={r.label || ''} onChange={(e) => set(i, 'label', e.target.value)} />
            <input placeholder="metric_name" list="metric-names" value={r.name || ''} onChange={(e) => set(i, 'name', e.target.value)} />
            <input placeholder='labels, e.g. path="/mnt"' value={r.match || ''} onChange={(e) => set(i, 'match', e.target.value)} />
            <select value={r.agg || 'sum'} onChange={(e) => set(i, 'agg', e.target.value)}>
              {['sum', 'max', 'min', 'avg', 'count', 'first'].map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select value={r.format || 'number'} onChange={(e) => set(i, 'format', e.target.value)}>
              {FORMATS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <button type="button" className="btn icon sm" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn sm"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => onChange([...rows, { label: '', name: '', match: '', agg: 'sum', format: 'number' }])}
        >
          + Add metric
        </button>
      </div>
    );
  }
  if (kind === 'fields') {
    const rows = Array.isArray(value) ? value : [];
    const set = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    return (
      <div className="field">
        {lbl}
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 60px 32px', gap: 6 }}>
            <input placeholder="Label" value={r.label || ''} onChange={(e) => set(i, 'label', e.target.value)} />
            <input placeholder="path.to.value" value={r.path || ''} onChange={(e) => set(i, 'path', e.target.value)} />
            <input placeholder="unit" value={r.suffix || ''} onChange={(e) => set(i, 'suffix', e.target.value)} />
            <button type="button" className="btn icon sm" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        ))}
        <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...rows, { label: '', path: '', suffix: '' }])}>
          + Add field
        </button>
      </div>
    );
  }
  return (
    <div className="field">
      {lbl}
      <input
        type={kind === 'number' ? 'number' : kind === 'url' ? 'url' : 'text'}
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(e) => onChange(kind === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
      />
    </div>
  );
}

export default function WidgetEditor({ widget, sections, sectionId, onSave, onClose }) {
  const isNew = !widget;
  const [type, setType] = useState(widget?.type || null);
  const [draft, setDraft] = useState(
    widget
      ? structuredClone(widget)
      : { id: uid(), type: null, title: '', w: 1, url: '', newTab: true, config: {} },
  );
  const [target, setTarget] = useState(sectionId);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const [filter, setFilter] = useState('');
  const matches = (t) => !filter || `${WIDGETS[t].name} ${WIDGETS[t].description}`.toLowerCase().includes(filter.toLowerCase());

  const chooseType = (t) => {
    setType(t);
    setDraft((d) => ({ ...d, type: t, title: d.title || WIDGETS[t].defaultTitle, w: WIDGETS[t].defaultW, config: defaultsFor(t) }));
    setTest(null);
  };
  const setCfg = (k, v) => setDraft((d) => ({ ...d, config: { ...d.config, [k]: v } }));

  const def = type ? WIDGETS[type] : null;
  const missing = def ? def.fields.filter((f) => f.required && (draft.config[f.key] === '' || draft.config[f.key] == null)) : [];
  const canSave = def && draft.title.trim() && missing.length === 0;

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const r = await api.testWidget({ id: isNew ? undefined : draft.id, type, config: draft.config });
      setTest(r);
    } catch (e) {
      setTest({ ok: false, error: e.message });
    } finally {
      setTesting(false);
    }
  };

  const hasFetcher = def && !['link', 'clock'].includes(type);

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>{isNew ? 'Add widget' : `Edit ${def?.name || 'widget'}`}</h3>
        <p className="hint">
          {isNew && !type ? 'Pick a widget type.' : def?.description}
          {def && def.fields.some((f) => f.kind.startsWith('secret')) ? ' Secrets are stored on the server and never sent to the browser.' : ''}
        </p>

        {isNew ? (
          <div className="type-picker">
            <div className="field" style={{ marginBottom: 4 }}>
              <input autoFocus placeholder="Search widgets… (e.g. proxmox, subtitles, torrent)" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            {CATEGORIES.filter((cat) => cat.types.some(matches)).map((cat) => (
              <div key={cat.id} className="type-cat">
                <h4>{cat.name}</h4>
                <div className="type-grid">
                  {cat.types.filter(matches).map((t) => (
                    <button key={t} type="button" className={type === t ? 'active' : ''} onClick={() => chooseType(t)}>
                      <b>{WIDGETS[t].name}</b>
                      <span>{WIDGETS[t].description}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {def ? (
          <>
            <div className="field-row">
              <div className="field">
                <label>Title *</label>
                <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </div>
              <div className="field">
                <label>Width <small>— grid sections only</small></label>
                <select value={draft.w} onChange={(e) => setDraft({ ...draft, w: Number(e.target.value) })}>
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n} / 4
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {type !== 'link' ? (
              <div className="field-row">
                <div className="field">
                  <label>Subtitle <small>— shown under the title</small></label>
                  <input value={draft.subtitle || ''} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} />
                </div>
                <div className="field">
                  <label>Icon <small>— dashboard-icons name, emoji or URL</small></label>
                  <input value={draft.icon || ''} placeholder={def.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} />
                </div>
              </div>
            ) : null}
            {def.fields.map((f) => (
              <Field key={f.key} field={f} value={draft.config[f.key]} onChange={(v) => setCfg(f.key, v)} />
            ))}

            {type !== 'link' ? (
              <div className="field">
                <label>
                  Open on click <small>— optional URL, e.g. the service's web UI</small>
                </label>
                <input type="url" placeholder="https://…" value={draft.url || ''} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
              </div>
            ) : null}

            <div className="field-row">
              <div className="field">
                <label>Section</label>
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="check" style={{ marginTop: 26 }}>
                  <input type="checkbox" checked={draft.newTab !== false} onChange={(e) => setDraft({ ...draft, newTab: e.target.checked })} />
                  Open links in a new tab
                </label>
              </div>
            </div>

            {test?.ok && Array.isArray(test.data?.sampleNames) ? (
              <datalist id="metric-names">
                {test.data.sampleNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            ) : null}
            {test ? (
              <div className={`test-result ${test.ok ? 'ok' : 'bad'}`}>
                {test.ok ? '✓ Connected' : `✗ ${test.error}`}
                {test.ok && test.data?.sampleNames ? (
                  <pre>{`${test.data.families} metric families. Names include:\n${test.data.sampleNames.join('\n')}`}</pre>
                ) : test.ok ? (
                  <pre>{JSON.stringify(test.data, null, 1).slice(0, 1200)}</pre>
                ) : null}
              </div>
            ) : null}

            <div className="actions">
              {hasFetcher ? (
                <button type="button" className="btn left" onClick={runTest} disabled={testing || missing.length > 0}>
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
              ) : null}
              <button type="button" className="btn ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn primary" disabled={!canSave} onClick={() => onSave(draft, target)}>
                {isNew ? 'Add widget' : 'Save'}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
