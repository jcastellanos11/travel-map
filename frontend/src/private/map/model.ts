import type { LatLngTuple } from 'leaflet';
import { decodeDto } from '../../api/contracts.ts';
import type { VisitDate } from '../../api/contracts.ts';
import { calendar } from '../visits/forms.ts';

// Presentation models intentionally omit confirmed GPS, photos, profiles and API
// implementation fields. All positions are approximate public catalog references.
export interface MapVisit {
  visitId: string; tripId: string; placeId: string;
  city: string; region: string | null; countryCode: string; countryName: string;
  date: VisitDate; position: LatLngTuple | null;
}
export interface MapGroup { key: string; position: LatLngTuple; visits: ReadonlyArray<MapVisit> }
export interface MapScope { kind: 'project' | 'trip'; id: string }
export interface MapFilters { countryCode: string; tripId: string; from: string; to: string }
export const emptyFilters: MapFilters = { countryCode: '', tripId: '', from: '', to: '' };
export type FilterErrors = Partial<Record<keyof MapFilters, string>>;
export function validateFilters(input: MapFilters, kind: MapScope['kind']): { value?: MapFilters; errors: FilterErrors } {
  const value = { countryCode: input.countryCode.trim().toUpperCase(), tripId: input.tripId, from: input.from, to: input.to };
  const errors: FilterErrors = {};
  if (value.countryCode && !/^[A-Z]{3}$/.test(value.countryCode)) errors.countryCode = 'Use a three-letter country code, for example COL.';
  if (value.tripId && (kind !== 'project' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value.tripId))) errors.tripId = 'Choose a Trip within this Project.';
  if (value.from && !calendar(value.from)) errors.from = 'Enter a valid calendar start date.';
  if (value.to && !calendar(value.to)) errors.to = 'Enter a valid calendar end date.';
  if (value.from && value.to && value.from > value.to) errors.to = 'End must be on or after start.';
  return { errors, ...(!Object.keys(errors).length ? { value } : {}) };
}
export function adaptMarker(data: unknown): MapVisit {
  const marker = decodeDto('MapMarker', data);
  const date = marker.date;
  if (date.mode !== 'none' && (!calendar(date.start) || !calendar(date.end)
    || date.start > date.end || date.mode === 'single' && date.start !== date.end)) throw new Error('Invalid map calendar');
  const point = marker.place.approximateCoordinates;
  // decodeDto checks finite/range/pair constraints, including rejecting exact GPS.
  return { visitId: marker.visitId, tripId: marker.tripId, placeId: marker.place.id,
    city: marker.place.city, region: marker.place.region, countryCode: marker.place.countryCode,
    countryName: marker.place.countryName, date,
    position: point ? [Object.is(point.lat, -0) ? 0 : point.lat, Object.is(point.lng, -0) ? 0 : point.lng] : null };
}
// Defensive protocol assertion, not client-side security filtering. Every filter
// goes to SQL; a contradictory response is rejected as a whole, never hidden locally.
export function matchesProjection(visit: MapVisit, scope: MapScope, filters: MapFilters): boolean {
  return (scope.kind !== 'trip' || visit.tripId === scope.id)
    && (!filters.tripId || visit.tripId === filters.tripId)
    && (!filters.countryCode || visit.countryCode === filters.countryCode)
    && (!filters.from && !filters.to || visit.date.mode !== 'none'
      && (!filters.from || visit.date.end >= filters.from) && (!filters.to || visit.date.start <= filters.to));
}
export function mergeMapVisits(previous: ReadonlyArray<MapVisit>, page: ReadonlyArray<MapVisit>): MapVisit[] {
  const items = new Map(previous.map(visit => [visit.visitId, visit]));
  for (const visit of page) {
    const old = items.get(visit.visitId);
    if (old && old.tripId !== visit.tripId) throw new Error('Conflicting map identity');
    items.set(visit.visitId, visit);
  }
  return [...items.values()];
}
// Deterministic screen-space grouping with an actual member's catalog coordinate
// as anchor. No centroid, jitter, guessed point, name merge or clustering package.
export function groupVisits(visits: ReadonlyArray<MapVisit>, project: (point: LatLngTuple) => { x: number; y: number }, worldWidth = Infinity, radius = 32): MapGroup[] {
  const groups: (MapGroup & { pixel: { x: number; y: number }; mutable: MapVisit[] })[] = [];
  for (const visit of [...visits].sort((a, b) => a.visitId < b.visitId ? -1 : a.visitId > b.visitId ? 1 : 0)) {
    if (!visit.position) continue;
    const pixel = project(visit.position);
    const found = groups.find(group => {
      const direct = Math.abs(pixel.x - group.pixel.x);
      const dx = Number.isFinite(worldWidth) ? Math.min(direct, Math.abs(worldWidth - direct)) : direct;
      return Math.hypot(dx, pixel.y - group.pixel.y) <= radius;
    });
    if (found) found.mutable.push(visit);
    else { const mutable = [visit]; groups.push({ key: visit.visitId, position: visit.position, visits: mutable, mutable, pixel }); }
  }
  return groups.map(({ key, position, visits: members }) => ({ key, position, visits: members }));
}
export interface MapCamera { sequence: number; kind: 'point' | 'fit'; position?: LatLngTuple }
export type MapState = { status: 'idle' }
  | { status: 'loading' | 'error'; scope: MapScope; filters: MapFilters; message?: string }
  | { status: 'ready'; scope: MapScope; filters: MapFilters; visits: ReadonlyArray<MapVisit>;
      nextCursor: string | null; loadingMore: boolean; groupIds: ReadonlyArray<string>;
      selectedVisitId: string | null; camera?: MapCamera };
