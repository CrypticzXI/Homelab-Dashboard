import React from 'react';
import { DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable';
import WidgetCard from './WidgetCard.jsx';
import { Icon } from '../lib/icons.jsx';

export function widgetMatches(w, q) {
  if (!q) return true;
  const hay = [w.title, w.subtitle, w.config?.subtitle, w.config?.url, w.url, w.type].filter(Boolean).join(' ').toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

export default function Section({ section, editing, query, onChange, onDelete, onAdd, onEditWidget, onMove, canMoveUp, canMoveDown }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );
  const column = section.layout === 'column';

  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const ids = section.widgets.map((w) => w.id);
    onChange({ ...section, widgets: arrayMove(section.widgets, ids.indexOf(active.id), ids.indexOf(over.id)) });
  };
  const removeWidget = (w) => onChange({ ...section, widgets: section.widgets.filter((x) => x.id !== w.id) });

  const visible = editing ? section.widgets : section.widgets.filter((w) => widgetMatches(w, query));
  if (!editing && visible.length === 0) return null;

  return (
    <section id={`sec-${section.id}`} className={`section ${column ? 'section-col' : ''}`}>
      <div className="section-head">
        {editing ? (
          <input className="title-input" value={section.title} onChange={(e) => onChange({ ...section, title: e.target.value })} />
        ) : (
          <h2>{section.title}</h2>
        )}
        <span className="count">{visible.length}</span>
        <div className="line" />
        {editing ? (
          <>
            <button
              className="btn sm ghost"
              title="Toggle layout"
              onClick={() => onChange({ ...section, layout: column ? 'grid' : 'column' })}
            >
              {column ? 'Column' : 'Grid'}
            </button>
            <button className="btn icon sm ghost" title="Move up" disabled={!canMoveUp} onClick={() => onMove(-1)}>
              <Icon name="up" size={14} />
            </button>
            <button className="btn icon sm ghost" title="Move down" disabled={!canMoveDown} onClick={() => onMove(1)}>
              <Icon name="down" size={14} />
            </button>
            <button className="btn icon sm ghost danger" title="Delete section" onClick={onDelete}>
              <Icon name="trash" size={14} />
            </button>
          </>
        ) : null}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={section.widgets.map((w) => w.id)} strategy={column ? verticalListSortingStrategy : rectSortingStrategy}>
          <div className={column ? 'stack' : 'grid'}>
            {visible.map((w) => (
              <WidgetCard key={w.id} widget={w} editing={editing} column={column} onEdit={onEditWidget} onDelete={removeWidget} />
            ))}
            {editing ? (
              <button className={`add-card ${column ? '' : 'w-1'}`} onClick={onAdd}>
                <span>
                  <Icon name="plus" size={16} /> Add widget
                </span>
              </button>
            ) : null}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}
