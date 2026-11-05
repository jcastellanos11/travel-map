import type { IdentityRepository, JsonObject } from '../../infrastructure/postgres.ts';
import { HttpError } from '../../shared/http.ts';
import { paginationPage, paginationQuery, uuid } from '../../shared/pagination.ts';
import { collaborationInput } from './validation.ts';

// Composed ONLY after the unchanged E1 authentication and Origin/CSRF boundary.
export async function collaborationRoute(request: Request, repository: IdentityRepository, token: string): Promise<Response | null> {
  const url = new URL(request.url);
  const match = /^\/api\/v1\/(projects|trips)\/([^/]+)(?:\/(members|leave|archive)(?:\/([^/]+)(?:\/(promote-admin|remove-admin))?)?)?$/.exec(url.pathname);
  if (!match) return null;
  const [, kind, id, operation, userId, roleAction] = match;
  let action: string | undefined;
  if (kind === 'projects') {
    if (!operation && request.method === 'PATCH') action = 'settings';
    if (operation === 'members' && !userId && request.method === 'GET') action = 'members';
    if (operation === 'members' && userId) {
      if (!roleAction && request.method === 'DELETE') action = 'remove';
      if (request.method === 'POST' && roleAction) action = roleAction === 'promote-admin' ? 'promote' : 'demote';
    }
    if (!userId && request.method === 'POST' && ['leave', 'archive'].includes(operation ?? '')) action = operation;
  } else {
    if (operation === 'members' && userId && !roleAction && request.method === 'DELETE') action = 'guest_remove';
    if (operation === 'leave' && !userId && request.method === 'POST') action = 'guest_leave';
  }
  if (!action) return null;
  if (!id || !uuid.test(id) || (userId && !uuid.test(userId))) throw new HttpError(404, 'RESOURCE_NOT_FOUND', 'Resource not available');
  if (action === 'members') {
    const { data, limit } = paginationQuery(url);
    const result = await repository.call(token, 'collaboration.members', { ...data, id });
    // Existing cursor convention, using stable user identity; no email projection.
    const page = paginationPage({ items: (result.items as JsonObject[]).map(item => ({ ...item, id: item.userId })) }, limit);
    return Response.json({ ...page, items: (page.items as JsonObject[]).map(item => { const value = { ...item }; delete value.id; return value; }) });
  }
  if (url.search) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request');
  const data = await collaborationInput(request, action === 'settings');
  const result = await repository.call(token, `collaboration.${action}`, { ...data, id, ...(userId ? { userId } : {}) });
  return action === 'settings' ? Response.json(result) : new Response(null, { status: 204 });
}
