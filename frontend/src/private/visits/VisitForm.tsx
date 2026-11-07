import { useRef, useState } from 'react';
import type { Place, Visit } from '../../api/contracts.ts';
import type { VisitCreate } from '../../api/generated.ts';
import PlacePicker from './PlacePicker.tsx';
import type { CatalogActions } from './PlacePicker.tsx';
import type { CatalogState } from './types.ts';
import { visitForm } from './forms.ts';
import type { VisitErrors } from './forms.ts';

export default function VisitForm({ initial, catalog, actions, pending, onSave, onCancel }: {
  initial?: Visit; catalog: CatalogState; actions: CatalogActions; pending: boolean;
  onSave(input: VisitCreate): Promise<void>; onCancel(): void;
}) {
  const [place, setPlace] = useState<Place | null>(initial?.place ?? null);
  const [name, setName] = useState(initial?.name ?? '');
  const [mode, setMode] = useState<string>(initial?.date.mode ?? 'none');
  const [start, setStart] = useState(initial?.date.start ?? '');
  const [end, setEnd] = useState(initial?.date.end ?? '');
  const [errors, setErrors] = useState<VisitErrors>({});
  const form = useRef<HTMLFormElement>(null);
  return <form className="visit-form" ref={form} aria-label={initial ? 'Edit Visit' : 'Create Visit'} noValidate onSubmit={event => {
    event.preventDefault(); if (pending) return;
    const result = visitForm({ place, name, mode, start, end }); setErrors(result.errors);
    if (result.value) void onSave(result.value);
    else requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
  }}>
    <h4>{initial ? 'Edit Visit' : 'New Visit'}</h4>
    {initial && <p className="muted">Only the creator with current access or the Project Owner/Admin may save changes. The server checks permission.</p>}
    <PlacePicker selected={place} onSelect={setPlace} catalog={catalog} actions={actions} disabled={pending} error={errors.place} />
    <label htmlFor="visit-name">Visit name (optional)</label><input id="visit-name" value={name} onChange={e => setName(e.target.value)} autoComplete="off" disabled={pending} aria-invalid={Boolean(errors.name)} aria-describedby="visit-name-help" />
    <small id="visit-name-help" role={errors.name ? 'alert' : undefined}>{errors.name ?? 'Up to 200 characters. Leave blank for no name.'}</small>
    <fieldset disabled={pending} aria-describedby="visit-date-help"><legend>Calendar dates</legend>
      <label htmlFor="visit-date-mode">Date mode</label><select id="visit-date-mode" value={mode} onChange={e => setMode(e.target.value)}><option value="none">No date</option><option value="single">Single date</option><option value="range">Date range (inclusive)</option></select>
      {mode !== 'none' && <><label htmlFor="visit-date-start">{mode === 'single' ? 'Date' : 'Start date'}</label><input id="visit-date-start" type="date" min="0001-01-01" max="9999-12-31" value={start} onChange={e => setStart(e.target.value)} aria-invalid={Boolean(errors.date)} aria-describedby="visit-date-help" required /></>}
      {mode === 'range' && <><label htmlFor="visit-date-end">End date (inclusive)</label><input id="visit-date-end" type="date" min="0001-01-01" max="9999-12-31" value={end} onChange={e => setEnd(e.target.value)} aria-invalid={Boolean(errors.date)} aria-describedby="visit-date-help" required /></>}
      <small id="visit-date-help" role={errors.date ? 'alert' : undefined}>{errors.date ?? 'Calendar days only; no time, timezone or GPS is collected.'}</small>
    </fieldset>
    <div className="action-row"><button type="submit" disabled={pending}>{pending ? 'Saving…' : initial ? 'Save Visit changes' : 'Create Visit'}</button><button type="button" disabled={pending} onClick={onCancel}>Cancel</button></div>
  </form>;
}
