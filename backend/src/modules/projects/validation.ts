import { HttpError } from '../../shared/http.ts';
import type { JsonObject } from '../../infrastructure/postgres.ts';
export { uuid, paginationQuery as projectQuery, paginationPage as projectPage } from '../../shared/pagination.ts';
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
