import type { IdentityRepository } from '../../infrastructure/postgres.ts';
import { HttpError } from '../../shared/http.ts';
import { paginationPage, paginationQuery, uuid } from '../../shared/pagination.ts';
import { tripInput } from './validation.ts';

// Authentication and mutation Origin/CSRF checks remain in the E1 composition
// boundary. Each RPC independently resolves current actor and ancestry in SQL.
export async function tripRoute(request: Request, repository: IdentityRepository, tokenDigest: string): Promise<Response | null> {
  const url = new URL(request.url);
  const collection = /^\/api\/v1\/projects\/([^/]+)\/trips$/.exec(url.pathname);
  const resource = /^\/api\/v1\/trips\/([^/]+)$/.exec(url.pathname);
  if (collection && ['GET', 'POST'].includes(request.method)) {
    const projectId = collection[1]!;
    if (!uuid.test(projectId)) throw new HttpError(404, 'RESOURCE_NOT_FOUND', 'Resource not available');
    if (request.method === 'GET') {
      const { data, limit } = paginationQuery(url);
      const result = await repository.call(tokenDigest, 'trips.list', { ...data, projectId });
      return Response.json(paginationPage(result, limit));
    }
    const input = await tripInput(request, false);
    const result = await repository.call(tokenDigest, 'trips.create', { ...input, projectId });
    return Response.json(result, { status: 201 });
  }
  if (resource && ['GET', 'PATCH'].includes(request.method)) {
    const id = resource[1]!;
    if (!uuid.test(id)) throw new HttpError(404, 'RESOURCE_NOT_FOUND', 'Resource not available');
    const action = request.method === 'GET' ? 'trips.get' : 'trips.update';
    const input = request.method === 'PATCH' ? await tripInput(request, true) : {};
    return Response.json(await repository.call(tokenDigest, action, { ...input, id }));
  }
  return null;
}
