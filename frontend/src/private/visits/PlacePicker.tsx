import { useEffect, useState } from 'react';
import type { Place } from '../../api/contracts.ts';
import type { AppController } from '../controller.ts';
import type { CatalogState } from './types.ts';
import { placeLabel } from './forms.ts';
export type CatalogActions = Pick<AppController, 'searchPlaces' | 'clearPlaces' | 'cancelPlaces'>;
export default function PlacePicker({ selected, onSelect, catalog, actions, disabled, error }: {
  selected: Place | null; onSelect(place: Place | null): void; catalog: CatalogState; actions: CatalogActions; disabled: boolean; error?: string;
}) {
  const [country, setCountry] = useState(selected?.countryCode ?? '');
  const [query, setQuery] = useState('');
  const search = actions.searchPlaces, cancel = actions.cancelPlaces;
  useEffect(() => {
    if (!country || disabled) return;
    const timer = setTimeout(() => void search(country, query), 250);
    return () => { clearTimeout(timer); cancel(); };
  }, [country, query, search, cancel, disabled]);
  function change() { onSelect(null); actions.clearPlaces(); }
  return <fieldset className="place-picker" disabled={disabled} aria-describedby="visit-place-help">
    <legend>Place (required)</legend>
    <p id="visit-place-help" className="muted">Limited catalog: six Places in COL, TUR and USA. Missing locations cannot be added here. Region labels are source codes.</p>
    <label htmlFor="visit-country">Country</label>
    <select id="visit-country" value={country} onChange={e => { change(); setCountry(e.target.value); }} aria-invalid={Boolean(error)} aria-describedby="visit-place-error">
      <option value="">Choose a catalog country</option><option value="COL">Colombia (COL)</option><option value="TUR">Türkiye (TUR)</option><option value="USA">United States (USA)</option>
    </select>
    <label htmlFor="visit-place-query">City search (optional)</label>
    <input id="visit-place-query" value={query} onChange={e => { change(); setQuery(e.target.value); }} disabled={disabled || !country} autoComplete="off" aria-describedby="visit-query-help" />
    <small id="visit-query-help">Up to 100 characters. Choose a result, not just a city name.</small>
    {catalog.status === 'loading' && <p role="status">Searching catalog…</p>}
    {catalog.status === 'error' && <><p role="alert">{catalog.message}</p><button type="button" onClick={() => void search(country, query)}>Retry catalog search</button></>}
    {catalog.status === 'ready' && <>
      {!catalog.results.page.items.length && <p role="status">No catalog matches. Try another search or choose a different country.</p>}
      <ul className="place-results">{catalog.results.page.items.map(place => <li key={place.id}><label className="place-choice"><input type="radio" name="catalog-place" value={place.id} checked={selected?.id === place.id} onChange={() => onSelect(place)} />{placeLabel(place)}</label></li>)}</ul>
      {catalog.results.page.nextCursor && <button type="button" disabled={catalog.results.loadingMore || disabled} onClick={() => void search(country, query, true)}>{catalog.results.loadingMore ? 'Loading…' : 'More Places'}</button>}
    </>}
    {selected && <p className="selected-place">Selected: {placeLabel(selected)}</p>}
    <small id="visit-place-error" role={error ? 'alert' : undefined}>{error ?? 'Choose a catalog result to use this location.'}</small>
    <small>Catalog attribution: <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">GeoNames</a>, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>.</small>
  </fieldset>;
}
