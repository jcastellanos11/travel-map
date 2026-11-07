import type { Place, VisitDate } from '../../api/contracts.ts';
import type { VisitCreate } from '../../api/generated.ts';

export interface VisitDraft { place: Place | null; name: string; mode: string; start: string; end: string }
export type VisitErrors = { place?: string; name?: string; date?: string };
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
export function calendar(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
export function canonicalDate(mode: string, start: string, end: string): VisitDate | undefined {
  if (mode === 'none') return { mode: 'none', start: null, end: null };
  if (!calendar(start)) return;
  if (mode === 'single') return { mode: 'single', start, end: start };
  if (mode === 'range' && calendar(end) && start <= end) return { mode: 'range', start, end };
}
export function dateLabel(date: VisitDate): string {
  // Calendar strings are intentionally never passed through Date/Intl/timezones.
  return date.mode === 'none' ? 'No date' : date.mode === 'single' ? date.start : `${date.start} – ${date.end} (inclusive)`;
}
export function placeLabel(place: Place): string {
  return `${place.city}${place.region ? ` · region ${place.region}` : ''} · ${place.countryName} (${place.countryCode})`;
}
export function visitForm(draft: VisitDraft): { value?: VisitCreate; errors: VisitErrors } {
  const errors: VisitErrors = {};
  if (!draft.place || !uuid.test(draft.place.id)) errors.place = 'Select an existing Place from the catalog results.';
  const name = draft.name.trim();
  if ([...name].length > 200 || [...draft.name].some(c => {
    const n = c.codePointAt(0)!;
    return n < 32 || n === 127 || n >= 0xd800 && n <= 0xdfff;
  })) errors.name = 'Use up to 200 characters without control characters.';
  const date = canonicalDate(draft.mode, draft.start, draft.end);
  if (!date) errors.date = 'Enter valid calendar dates from 0001–9999 with start on or before end.';
  return { errors, ...(!Object.keys(errors).length ? { value: { placeId: draft.place!.id, name: name || null, date: date! } } : {}) };
}
export function placeSearch(countryCode: string, query: string): boolean {
  return /^[A-Z]{3}$/.test(countryCode) && [...query].length <= 100 && [...query].every(c => {
    const n = c.codePointAt(0)!;
    return n >= 32 && n !== 127 && (n < 0xd800 || n > 0xdfff);
  });
}
