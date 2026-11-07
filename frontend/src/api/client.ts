import { decodeDto } from './contracts.ts';
import type { CurrentUser, PublicDto } from './contracts.ts';
import type { ApiDtos } from './generated.ts';
export type ErrorKind = 'unauthenticated' | 'forbidden' | 'not_found' | 'validation' | 'conflict' | 'rate_limited' | 'unavailable' | 'network' | 'protocol' | 'unexpected';
const kinds: Record<number, ErrorKind> = { 400: 'validation', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 413: 'validation', 415: 'validation', 422: 'validation', 429: 'rate_limited', 500: 'unavailable', 502: 'unavailable', 503: 'unavailable', 504: 'unavailable' };
const messages: Record<ErrorKind, string> = { unauthenticated: 'Sign in to continue.', forbidden: 'This action is not allowed.', not_found: 'Resource not available.', validation: 'Check the request values.', conflict: 'The operation conflicts with the current state.', rate_limited: 'Please try again later.', unavailable: 'The service is temporarily unavailable.', network: 'Could not reach the service.', protocol: 'The service returned an unexpected response.', unexpected: 'The request could not be completed.' };
export class ApiError extends Error {
  readonly kind: ErrorKind;
  readonly status: number | undefined;
  readonly code: string;
  readonly requestId: string | undefined;
  constructor(kind: ErrorKind, code: string, status?: number, requestId?: string) {
    super(messages[kind]); this.name = 'ApiError'; this.kind = kind; this.status = status; this.code = code; this.requestId = requestId;
  }
}
export interface RequestOptions { signal?: AbortSignal }
export type MutationMethod = 'POST' | 'PATCH' | 'DELETE' | 'PUT';
function apiPath(path: string): string {
  const url = new URL(path, 'https://same-origin.invalid');
  if (!path.startsWith('/api/v1/') || url.origin !== 'https://same-origin.invalid' || !url.pathname.startsWith('/api/v1/') || (/[\\#]/.test(path) || [...path].some(c => c.charCodeAt(0) <= 32))) throw new ApiError('validation', 'INVALID_API_PATH');
  return url.pathname + url.search;
}
export function paginatedPath(path: string, query: { limit?: number; cursor?: string | null } = {}): string {
  const url = new URL(apiPath(path), 'https://same-origin.invalid');
  if (query.limit !== undefined) {
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) throw new ApiError('validation', 'INVALID_PAGE_LIMIT');
    url.searchParams.set('limit', String(query.limit));
  }
  if (query.cursor) url.searchParams.set('cursor', query.cursor);
  return apiPath(url.pathname + url.search);
}
// No credential cache: each mutation obtains current-session CSRF and discards it.
// This also avoids stale tokens across logout/login in another tab. No auto retry.
export function createApiClient(transport: typeof fetch = (...args) => fetch(...args)) {
  async function send(path: string, method: string, options: RequestOptions, json?: unknown, csrf?: string): Promise<unknown> {
    options.signal?.throwIfAborted();
    const target = path === '/health' ? path : apiPath(path);
    const headers = new Headers({ Accept: 'application/json' });
    if (json !== undefined) headers.set('Content-Type', 'application/json');
    if (csrf) headers.set('X-CSRF-Token', csrf);
    let response: Response;
    try {
      response = await transport(target, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers, signal: options.signal, ...(json === undefined ? {} : { body: JSON.stringify(json) }) });
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new ApiError('network', 'NETWORK_ERROR');
    }
    options.signal?.throwIfAborted();
    if (response.status === 204 && response.ok) return undefined;
    if (response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApiError('protocol', 'INVALID_RESPONSE', response.status);
    let data: unknown;
    try { data = await response.json(); } catch {
      if (options.signal?.aborted) throw options.signal.reason;
      throw new ApiError('protocol', 'INVALID_RESPONSE', response.status);
    }
    options.signal?.throwIfAborted();
    if (!response.ok) {
      const envelope = data && typeof data === 'object' && 'error' in data ? data.error : null;
      if (!envelope || typeof envelope !== 'object' || !('code' in envelope) || typeof envelope.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(envelope.code)) throw new ApiError('protocol', 'INVALID_RESPONSE', response.status);
      const requestId = 'requestId' in envelope && typeof envelope.requestId === 'string' && /^[a-f\d-]{36}$/i.test(envelope.requestId) ? envelope.requestId : undefined;
      throw new ApiError(kinds[response.status] ?? 'unexpected', envelope.code, response.status, requestId);
    }
    return data;
  }
  async function currentUser(options: RequestOptions = {}): Promise<CurrentUser> {
    const me = await session(options);
    const { csrfToken: _csrf, ...user } = me; void _csrf;
    return user;
  }
  async function session(options: RequestOptions) {
    try { return decodeDto('Me', await send('/api/v1/me', 'GET', options)); }
    catch (e) { if (e instanceof ApiError || options.signal?.aborted || e instanceof Error && e.name === 'AbortError') throw e; throw new ApiError('protocol', 'INVALID_RESPONSE'); }
  }
  async function get<K extends PublicDto>(path: string, response: K, options: RequestOptions = {}): Promise<ApiDtos[K]> {
    apiPath(path);
    const value = await send(path, 'GET', options);
    try { return decodeDto(response, value); } catch { throw new ApiError('protocol', 'INVALID_RESPONSE'); }
  }
  async function mutate<K extends PublicDto>(method: MutationMethod, path: string, json: unknown, options: RequestOptions & { response: K }): Promise<ApiDtos[K]>;
  async function mutate(method: MutationMethod, path: string, json?: unknown, options?: RequestOptions): Promise<void>;
  async function mutate(method: MutationMethod, path: string, json?: unknown, options: RequestOptions & { response?: PublicDto } = {}): Promise<unknown> {
    apiPath(path);
    const me = await session(options);
    const result = await send(path, method, options, json, me.csrfToken);
    if (!options.response) {
      if (result !== undefined) throw new ApiError('protocol', 'EXPECTED_NO_CONTENT');
      return;
    }
    try { return decodeDto(options.response, result); } catch { throw new ApiError('protocol', 'INVALID_RESPONSE'); }
  }
  async function health(options: RequestOptions = {}): Promise<void> {
    const result = await send('/health', 'GET', options);
    if (!result || typeof result !== 'object' || !('status' in result) || result.status !== 'ok') throw new ApiError('protocol', 'INVALID_RESPONSE');
  }
  return { currentUser, get, mutate, health };
}
export const api = createApiClient();
