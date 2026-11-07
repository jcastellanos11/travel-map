import { schemas } from './generated.ts';
import type { ApiDtos } from './generated.ts';
export type { Project, Trip, Visit, Place, MapMarker, VisitDate } from './generated.ts';
export type { Error as ApiErrorResponse } from './generated.ts';
export type CurrentUser = Omit<ApiDtos['Me'], 'csrfToken'>;
export interface Page<T> { readonly items: ReadonlyArray<T>; readonly nextCursor: string | null }
export type PublicDto = Exclude<keyof ApiDtos, 'Me'>;
interface Schema {
  $ref?: string; const?: unknown; enum?: readonly unknown[];
  anyOf?: readonly Schema[]; oneOf?: readonly Schema[]; type?: string;
  properties?: Readonly<Record<string, Schema>>; required?: readonly string[];
  additionalProperties?: boolean; items?: Schema; format?: string;
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number; pattern?: string;
}
// Small reader for the exact schema subset used by the approved DTOs, not a new
// business validator. Backend remains authoritative for dates, roles and access.
function matches(schema: Schema, value: unknown): boolean {
  if (schema.$ref) return matches((schemas as Record<string, Schema>)[schema.$ref.split('/').at(-1)!], value);
  if ('const' in schema) return value === schema.const;
  if (schema.enum) return schema.enum.includes(value);
  if (schema.anyOf) return schema.anyOf.some(s => matches(s, value));
  if (schema.oneOf) return schema.oneOf.filter(s => matches(s, value)).length === 1;
  switch (schema.type) {
    case 'null': return value === null;
    case 'boolean': return typeof value === 'boolean';
    case 'number': case 'integer': return typeof value === 'number' && Number.isFinite(value)
      && (schema.type !== 'integer' || Number.isInteger(value))
      && (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
    case 'string': return typeof value === 'string'
      && (schema.minLength === undefined || [...value].length >= schema.minLength)
      && (schema.maxLength === undefined || [...value].length <= schema.maxLength)
      && (!schema.pattern || new RegExp(schema.pattern).test(value))
      && (schema.format !== 'uuid' || /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value))
      && (schema.format !== 'date-time' || /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)))
      && (schema.format !== 'date' || /^\d{4}-\d{2}-\d{2}$/.test(value));
    case 'array': return Array.isArray(value) && value.every(v => matches(schema.items!, v));
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const data = value as Record<string, unknown>, props = schema.properties ?? {};
      return (schema.required ?? []).every(k => Object.hasOwn(data, k))
        && Object.keys(data).every(k => props[k] ? matches(props[k], data[k]) : schema.additionalProperties !== false);
    }
    default: return false;
  }
}
export function decodeDto<K extends keyof ApiDtos>(name: K, data: unknown): ApiDtos[K] {
  if (!matches(schemas[name] as Schema, data)) throw new Error('API DTO does not match the approved contract');
  return data as ApiDtos[K];
}
