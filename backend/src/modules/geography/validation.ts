import { HttpError } from '../../shared/http.ts';
import { paginationQuery, uuid } from '../../shared/pagination.ts';
import type { JsonObject } from '../../infrastructure/postgres.ts';
const invalid = () => new HttpError(400, 'VALIDATION_ERROR', 'Invalid request');
export const calendar = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!;
};
export function visitDate(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const date = value as JsonObject;
  if (Object.keys(date).length !== 3 || !['mode', 'start', 'end'].every(k => Object.hasOwn(date, k))) return false;
  if (date.mode === 'none') return date.start === null && date.end === null;
  return calendar(date.start) && calendar(date.end) &&
    (date.mode === 'single' ? date.start === date.end : date.mode === 'range' && date.start <= date.end);
}
const text = (value: string) => [...value].every(c => { const n = c.codePointAt(0)!; return n >= 32 && n !== 127 && !(n >= 0xd800 && n <= 0xdfff); });
export async function visitInput(request: Request, partial: boolean): Promise<JsonObject> {
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim() !== 'application/json') throw invalid();
  const reader = request.body?.getReader(); if (!reader) throw invalid();
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > 16_384) { await reader.cancel(); throw invalid(); } chunks.push(value);
  } } finally { reader.releaseLock(); }
  let data: JsonObject;
  try {
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(); data = value as JsonObject;
  } catch { throw invalid(); }
  if (Object.keys(data).some(k => !['placeId', 'name', 'date', 'confirmedCoordinates'].includes(k)) || (partial && !Object.keys(data).length)) throw invalid();
  if (!partial || Object.hasOwn(data, 'placeId')) { if (typeof data.placeId !== 'string' || !uuid.test(data.placeId)) throw invalid(); }
  if (Object.hasOwn(data, 'name') && data.name !== null) {
    if (typeof data.name !== 'string' || !text(data.name) || !data.name.trim() || [...data.name.trim()].length > 200) throw invalid(); data.name = data.name.trim();
  }
  if (Object.hasOwn(data, 'date') && !visitDate(data.date)) throw invalid();
  if (Object.hasOwn(data, 'confirmedCoordinates') && data.confirmedCoordinates !== null) throw invalid();
  return data;
}
export function geographyQuery(url: URL, kind: 'places' | 'projectMap' | 'tripMap' | 'visits'): { data: JsonObject; limit: number } {
  const extras = kind === 'places' ? ['countryCode', 'query'] : kind === 'visits' ? [] : ['countryCode', 'from', 'to', ...(kind === 'projectMap' ? ['tripId'] : [])];
  if ([...url.searchParams.keys()].some(k => !['limit', 'cursor', ...extras].includes(k) || url.searchParams.getAll(k).length !== 1)) throw invalid();
  const pageUrl = new URL(url); for (const key of extras) pageUrl.searchParams.delete(key);
  const result = paginationQuery(pageUrl);
  for (const key of extras) if (url.searchParams.has(key)) result.data[key] = url.searchParams.get(key)!;
  if ((kind === 'places' || Object.hasOwn(result.data, 'countryCode')) &&
    (typeof result.data.countryCode !== 'string' || !/^[A-Z]{3}$/.test(result.data.countryCode))) throw invalid();
  if (Object.hasOwn(result.data, 'query') && (typeof result.data.query !== 'string' || [...result.data.query].length > 100 || !text(result.data.query))) throw invalid();
  if (Object.hasOwn(result.data, 'tripId') && (typeof result.data.tripId !== 'string' || !uuid.test(result.data.tripId))) throw invalid();
  for (const key of ['from', 'to']) if (Object.hasOwn(result.data, key) && !calendar(result.data[key])) throw invalid();
  if (typeof result.data.from === 'string' && typeof result.data.to === 'string' && result.data.from > result.data.to) throw invalid();
  return result;
}
