import type { JsonObject } from '../../infrastructure/postgres.ts';
import { HttpError } from '../../shared/http.ts';
const invalid = () => new HttpError(400, 'VALIDATION_ERROR', 'Invalid request');

// Separate from E1 project creation: partial settings must never supply defaults.
// Dedicated action endpoints accept no body or {}, not caller-chosen roles/actors.
export async function collaborationInput(request: Request, settings: boolean): Promise<JsonObject> {
  if (!request.body) { if (settings) throw invalid(); return {}; }
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw invalid(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  // workerd can represent an empty POST as a non-null, zero-byte stream.
  if (size === 0 && !settings) return {};
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim() !== 'application/json') throw invalid();
  try {
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid();
    const input = data as JsonObject, keys = Object.keys(input);
    if (!settings) { if (keys.length) throw invalid(); return {}; }
    if (!keys.length || keys.some(key => !['name', 'tripCreationPolicy'].includes(key))) throw invalid();
    const result: JsonObject = {};
    if ('name' in input) {
      if (typeof input.name !== 'string' || !input.name.trim() || [...input.name.trim()].length > 200
        || [...input.name].some(c => { const n = c.codePointAt(0)!; return n < 32 || n === 127 || (n >= 0xd800 && n <= 0xdfff); })) throw invalid();
      result.name = input.name.trim();
    }
    if ('tripCreationPolicy' in input) {
      if (typeof input.tripCreationPolicy !== 'string' || !['admins_only', 'all_project_members'].includes(input.tripCreationPolicy)) throw invalid();
      result.tripCreationPolicy = input.tripCreationPolicy;
    }
    return result;
  } catch { throw invalid(); }
}
