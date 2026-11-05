import type { IdentityRepository } from '../../infrastructure/postgres.ts';
import { HttpError } from '../../shared/http.ts';
import { paginationPage, paginationQuery, uuid } from '../../shared/pagination.ts';
import { collaborationInput } from '../collaboration/validation.ts';
import { digest, randomToken, tokenPattern } from '../identity/security.ts';

export async function invitationRoute(request: Request, repo: IdentityRepository, session: string): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/api/v1/invitations/redeem' && request.method === 'POST') {
    if (url.search || request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request');
    const reader = request.body?.getReader(); if (!reader) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request');
    let text = ''; let size = 0; const decoder = new TextDecoder();
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 1024) { await reader.cancel(); throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request'); } text += decoder.decode(value, { stream: true }); } text += decoder.decode(); } finally { reader.releaseLock(); }
    let token: string;
    try { const data = JSON.parse(text) as Record<string, unknown>; if (!data || Object.keys(data).length !== 1 || typeof data.token !== 'string' || !tokenPattern.test(data.token)) throw new Error(); token = data.token; } catch { throw new HttpError(400, 'INVITATION_INVALID', 'Invitation not available'); }
    return Response.json(await repo.call(session, 'invitations.redeem', { tokenDigest: await digest(token) }));
  }
  const match = /^\/api\/v1\/(projects|trips)\/([^/]+)\/invitations(?:\/([^/]+)\/revoke)?$/.exec(url.pathname);
  if (!match || !['GET', 'POST'].includes(request.method)) return null;
  const [, kind, id, invitationId] = match;
  if (!id || !uuid.test(id) || (invitationId && !uuid.test(invitationId))) throw new HttpError(404, 'RESOURCE_NOT_FOUND', 'Resource not available');
  const scope = kind === 'projects' ? { projectId: id } : { tripId: id };
  if (request.method === 'GET' && !invitationId) {
    const { data, limit } = paginationQuery(url);
    return Response.json(paginationPage(await repo.call(session, 'invitations.list', { ...scope, ...data }), limit));
  }
  if (request.method !== 'POST') return null;
  if (url.search) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request');
  await collaborationInput(request, false);
  if (invitationId) { await repo.call(session, 'invitations.revoke', { ...scope, id: invitationId }); return new Response(null, { status: 204 }); }
  const token = randomToken();
  const result = await repo.call(session, 'invitations.create', { ...scope, tokenDigest: await digest(token) });
  return Response.json({ ...result, invitationUrl: `${url.origin}/invite#${token}` }, { status: 201 });
}
