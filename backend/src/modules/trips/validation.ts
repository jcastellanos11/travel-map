import { HttpError } from '../../shared/http.ts';
import type { JsonObject } from '../../infrastructure/postgres.ts';

const invalid = () => new HttpError(400, 'VALIDATION_ERROR', 'Invalid request');
const isScalarText = (value: string) => [...value].every(character => {
  const point = character.codePointAt(0)!;
  return point !== 0 && !(point >= 0xd800 && point <= 0xdfff);
});

// Keep E1's project parser/limits unchanged. Trip descriptions need a separate,
// bounded body budget (2000 Unicode characters + a 200-character name).
export async function tripInput(request: Request, partial: boolean): Promise<JsonObject> {
  if (request.headers.get('Content-Type')?.split(';')[0]?.trim() !== 'application/json') throw invalid();
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        throw invalid();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let data: JsonObject;
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid();
    data = parsed as JsonObject;
  } catch {
    throw invalid();
  }
  const keys = Object.keys(data);
  if (keys.some(key => !['name', 'description'].includes(key)) || (partial && keys.length === 0)) throw invalid();
  if (!partial || Object.hasOwn(data, 'name')) {
    if (typeof data.name !== 'string' || !isScalarText(data.name)) throw invalid();
    const name = data.name.trim();
    if (!name || [...name].length > 200 || [...name].some(c => c.codePointAt(0)! < 32 || c.codePointAt(0) === 127)) throw invalid();
    data.name = name;
  }
  if (Object.hasOwn(data, 'description') && data.description !== null) {
    if (typeof data.description !== 'string' || [...data.description].length > 2000 || !isScalarText(data.description)) throw invalid();
  }
  return data;
}
