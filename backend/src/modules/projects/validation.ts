import { HttpError } from '../../shared/http.ts';
import type { JsonObject } from '../../infrastructure/postgres.ts';
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = () => new HttpError(400,'VALIDATION_ERROR','Invalid request');
export async function projectInput(request: Request): Promise<JsonObject> {
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim() !== 'application/json') throw bad();
  const reader=request.body?.getReader(); if (!reader) throw bad();
  let bytes=0; const parts: Uint8Array[]=[];
  try {
    for (;;) {
      const {value,done}=await reader.read(); if (done) break;
      bytes+=value.byteLength;
      if (bytes>4096) { await reader.cancel(); throw new HttpError(413,'VALIDATION_ERROR','Request body too large'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const all=new Uint8Array(bytes); let offset=0;
    for (const part of parts) { all.set(part,offset); offset+=part.byteLength; }
    const input: unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(all));
    if (!input || typeof input!=='object' || Array.isArray(input)) throw bad();
    const data=input as JsonObject;
    if (Object.keys(data).some((key)=>!['name','tripCreationPolicy'].includes(key))
      || typeof data.name!=='string' || !data.name.trim() || [...data.name.trim()].length>200
      || [...data.name].some((character)=>character.charCodeAt(0)<32 || character.charCodeAt(0)===127)
      || (data.tripCreationPolicy!==undefined && (typeof data.tripCreationPolicy!=='string'
        || !['admins_only','all_project_members'].includes(data.tripCreationPolicy)))) throw bad();
    return {name:data.name.trim(),tripCreationPolicy:data.tripCreationPolicy??'admins_only'};
  } catch { throw bad(); }
}
export function projectQuery(url: URL): {data: JsonObject; limit: number} {
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
export function projectPage(result: JsonObject, limit: number): JsonObject {
  const items=result.items as JsonObject[]; const page=items.slice(0,limit); const last=page.at(-1);
  const nextCursor=items.length>limit && last
    ? btoa(JSON.stringify({time:last.createdAt,id:last.id})).replaceAll('+','-').replaceAll('/','_').replaceAll('=','') : null;
  return {items:page,nextCursor};
}
