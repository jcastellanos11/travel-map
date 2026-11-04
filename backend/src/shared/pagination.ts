import { HttpError } from './http.ts';
import type { JsonObject } from '../infrastructure/postgres.ts';

export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = () => new HttpError(400, 'VALIDATION_ERROR', 'Invalid request');

export function paginationQuery(url: URL): {data: JsonObject; limit: number} {
  if ([...url.searchParams.keys()].some((key)=>!['limit','cursor'].includes(key) || url.searchParams.getAll(key).length!==1)) throw bad();
  const limit=Number(url.searchParams.get('limit')??25);
  if (!Number.isInteger(limit)||limit<1||limit>100) throw bad();
  const data: JsonObject={limit}; const cursor=url.searchParams.get('cursor');
  if (cursor) {
    try {
      if (cursor.length>512) throw bad();
      const parsed=JSON.parse(atob(cursor.replaceAll('-','+').replaceAll('_','/'))) as JsonObject;
      if (typeof parsed.id!=='string' || !uuid.test(parsed.id) || typeof parsed.time!=='string'
        || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(parsed.time)
        || !Number.isFinite(Date.parse(parsed.time)) || parsed.time.startsWith('0000')
        || new Date(parsed.time).toISOString().slice(0,19)!==parsed.time.slice(0,19)) throw bad();
      data.cursorTime=parsed.time; data.cursorId=parsed.id;
    } catch { throw bad(); }
  }
  return {data,limit};
}
export function paginationPage(result: JsonObject, limit: number): JsonObject {
  const items=result.items as JsonObject[]; const page=items.slice(0,limit); const last=page.at(-1);
  const nextCursor=items.length>limit && last
    ? btoa(JSON.stringify({time:last.createdAt,id:last.id})).replaceAll('+','-').replaceAll('/','_').replaceAll('=','') : null;
  return {items:page,nextCursor};
}
