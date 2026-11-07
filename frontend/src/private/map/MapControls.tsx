import { useEffect, useRef, useState } from 'react';
import type { AppController } from '../controller.ts';
import type { Trip } from '../../api/contracts.ts';
import { dateLabel } from '../visits/forms.ts';
import { emptyFilters, validateFilters } from './model.ts';
import type { FilterErrors, MapFilters, MapState, MapVisit } from './model.ts';
export type MapActions = Pick<AppController, 'loadMap' | 'showMapGroup' | 'fitMap' | 'openMapVisit'>;
function visitLabel(visit: MapVisit) { return `${visit.city}${visit.region ? ` · ${visit.region}` : ''} (${visit.countryCode}) · ${dateLabel(visit.date)} · ${visit.visitId.slice(-8)}`; }
export default function MapControls({ state, actions, trips, pending }: { state: MapState; actions: MapActions; trips: ReadonlyArray<Trip>; pending: boolean }) {
  const chooser = useRef<HTMLHeadingElement>(null);
  const groupKey = state.status === 'ready' ? state.groupIds.join('|') : '';
  useEffect(() => { if (groupKey) chooser.current?.focus(); }, [groupKey]);
  if (state.status === 'idle') return null;
  const filtersKey = `${state.scope.kind}:${state.scope.id}:${JSON.stringify(state.filters)}`;
  const selected = state.status === 'ready' ? state.visits.filter(visit => state.groupIds.includes(visit.visitId)) : [];
  return <section className="map-controls" aria-labelledby="map-controls-title"><h2 id="map-controls-title">{state.scope.kind === 'project' ? 'Project map' : 'Trip map'}</h2>
    <p className="muted">Approximate catalog locations, not exact Visit GPS. Counts include loaded Visits only.</p>
    <FilterForm key={filtersKey} initial={state.filters} kind={state.scope.kind} trips={trips} pending={pending} apply={filters => void actions.loadMap(false, filters)} />
    {state.status === 'loading' && <p role="status">Loading authorized map…</p>}
    {state.status === 'error' && <><p role="alert">{state.message}</p><button disabled={pending} onClick={() => void actions.loadMap()}>Retry map</button></>}
    {state.status === 'ready' && <>
      <p role="status">{state.visits.length ? `${state.visits.length} Visit(s) loaded. ${state.visits.filter(v => !v.position).length} without catalog coordinates.` : 'No matching Visits.'} {state.nextCursor ? 'More results remain unloaded; marker groups may be incomplete.' : 'No more results.'}</p>
      <div className="action-row"><button disabled={pending || !state.visits.some(v => v.position)} onClick={actions.fitMap}>Fit loaded Visits</button><button disabled={pending} onClick={() => void actions.loadMap()}>Refresh map</button>
        {state.nextCursor && <button disabled={pending || state.loadingMore} onClick={() => void actions.loadMap(true)}>{state.loadingMore ? 'Loading…' : 'Load more map Visits'}</button>}</div>
      {state.selectedVisitId && !state.visits.some(visit => visit.visitId === state.selectedVisitId) && <p role="status">The selected Visit is outside the loaded map results. Load more or adjust filters to locate its marker.</p>}
      {selected.length > 0 && <div className="map-chooser"><h3 ref={chooser} tabIndex={-1}>Choose a Visit — {selected.length} selected</h3><ul>{selected.map(visit => <li key={visit.visitId}><button disabled={pending} aria-label={`Open Visit ${visit.visitId} in Trip ${visit.tripId}`} onClick={() => void actions.openMapVisit(visit.visitId)}>{visitLabel(visit)}</button></li>)}</ul></div>}
      <details className="map-visit-alternative"><summary>Browse loaded map Visits ({state.visits.length})</summary><p className="muted">Keyboard alternative to map markers. Labels use Place, date and a Visit ID suffix; the projection does not include Visit names.</p><ul>{state.visits.map(visit => <li key={visit.visitId}><button disabled={pending} aria-pressed={state.selectedVisitId === visit.visitId} aria-label={`Open Visit ${visit.visitId} in Trip ${visit.tripId}`} onClick={() => void actions.openMapVisit(visit.visitId)}>{visitLabel(visit)}{!visit.position && ' · coordinates unavailable'}</button></li>)}</ul></details>
    </>}
  </section>;
}
function FilterForm({ initial, kind, trips, pending, apply }: { initial: MapFilters; kind: 'project' | 'trip'; trips: ReadonlyArray<Trip>; pending: boolean; apply(value: MapFilters): void }) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<FilterErrors>({});
  const form = useRef<HTMLFormElement>(null);
  return <details className="map-filters"><summary>Map filters</summary><form ref={form} noValidate aria-label="Map filters" onSubmit={event => {
    event.preventDefault(); if (pending) return;
    const result = validateFilters(draft, kind); setErrors(result.errors);
    if (result.value) apply(result.value);
    else requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
  }}>
    <label htmlFor="map-country">Country code (optional)</label><input id="map-country" value={draft.countryCode} onChange={e => setDraft({ ...draft, countryCode: e.target.value })} placeholder="COL, TUR or USA" autoComplete="off" disabled={pending} aria-invalid={Boolean(errors.countryCode)} aria-describedby="map-country-help" />
    <small id="map-country-help" role={errors.countryCode ? 'alert' : undefined}>{errors.countryCode ?? 'Three-letter catalog country code. Blank includes all authorized countries.'}</small>
    {kind === 'project' && <><label htmlFor="map-trip">Trip filter</label><select id="map-trip" value={draft.tripId} onChange={e => setDraft({ ...draft, tripId: e.target.value })} disabled={pending} aria-invalid={Boolean(errors.tripId)} aria-describedby="map-trip-help"><option value="">All authorized Project Trips</option>{trips.map(trip => <option key={trip.id} value={trip.id}>{trip.name}</option>)}</select><small id="map-trip-help">{errors.tripId ?? 'Choices use the loaded Project Trip pages. Load more Trips below for additional choices.'}</small></>}
    <label htmlFor="map-from">From (optional)</label><input id="map-from" type="date" min="0001-01-01" max="9999-12-31" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} disabled={pending} aria-invalid={Boolean(errors.from)} aria-describedby="map-from-help" /><small id="map-from-help" role={errors.from ? 'alert' : undefined}>{errors.from ?? 'Inclusive calendar start bound.'}</small>
    <label htmlFor="map-to">To (optional)</label><input id="map-to" type="date" min="0001-01-01" max="9999-12-31" value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} disabled={pending} aria-invalid={Boolean(errors.to)} aria-describedby="map-to-help" /><small id="map-to-help" role={errors.to ? 'alert' : undefined}>{errors.to ?? 'Inclusive calendar end bound.'}</small>
    <p className="muted">Dates match overlapping Visits; an active date bound excludes undated Visits. Changes apply only after submission.</p>
    {Object.keys(errors).length > 0 && <p role="alert">Filters were not applied. Previous applied results remain in effect.</p>}
    <div className="action-row"><button disabled={pending} type="submit">Apply map filters</button><button disabled={pending} type="button" onClick={() => { setDraft(emptyFilters); setErrors({}); apply(emptyFilters); }}>Reset map filters</button></div>
  </form></details>;
}
