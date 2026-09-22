'use client';
import { useState } from 'react';
import { DynamicForm, type UiField } from './DynamicForm';

export type UiAction = { key: string; label: string; help: string; fields: UiField[]; danger?: boolean };

/** Lists the actions available to the current user for one sale/expense and opens the matching form. */
export function ActionPanel({ actions, onSubmit }: { actions: UiAction[]; onSubmit: (key: string, input: Record<string, unknown>) => Promise<{ error?: string; ok?: boolean; id?: string }> }) {
  const [open, setOpen] = useState<string | null>(actions.length === 1 ? actions[0].key : null);
  if (!actions.length) return <div className="empty">No action is available to your role at this stage.</div>;
  return (
    <div>
      {actions.map(a => (
        <div className="actioncard" key={a.key}>
          <h4>{a.label} {a.danger && <span className="tag danger">Irreversible</span>}</h4>
          <p className="muted small" style={{ marginTop: 0 }}>{a.help}</p>
          {open === a.key ? (
            <DynamicForm fields={a.fields} submitLabel={a.label} danger={a.danger}
              confirmText={`${a.label}? This cannot be undone.`}
              onSubmit={input => onSubmit(a.key, input)} />
          ) : (
            <button className="btn light" onClick={() => setOpen(a.key)}>{a.fields.length ? 'Open form' : `${a.label}`}</button>
          )}
        </div>
      ))}
    </div>
  );
}
