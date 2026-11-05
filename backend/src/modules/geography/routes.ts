import type { IdentityRepository, JsonObject } from '../../infrastructure/postgres.ts';
import { HttpError } from '../../shared/http.ts';
import { paginationPage, uuid } from '../../shared/pagination.ts';
import { geographyQuery, visitInput } from './validation.ts';
export async function geographyRoute(request: Request, repository: IdentityRepository, token: string): Promise<Response | null> {
  const url = new URL(request.url);
  const collection = /^\/api\/v1\/trips\/([^/]+)\/visits$/.exec(url.pathname);
  const resource = /^\/api\/v1\/visits\/([^/]+)$/.exec(url.pathname);
  const map = /^\/api\/v1\/(projects|trips)\/([^/]+)\/map$/.exec(url.pathname);
  const id = collection?.[1] ?? resource?.[1] ?? map?.[2];
  if (id && !uuid.test(id)) throw new HttpError(404, 'RESOURCE_NOT_FOUND', 'Resource not available');
  if ((url.pathname === '/api/v1/places' || map || collection) && request.method === 'GET') {
    const kind = map ? map[1] === 'projects' ? 'projectMap' : 'tripMap' : collection ? 'visits' : 'places';
    const { data, limit } = geographyQuery(url, kind);
    const action = map ? map[1] === 'projects' ? 'maps.project' : 'maps.trip' : collection ? 'visits.list' : 'places.list';
    const scope = map ? { [map[1] === 'projects' ? 'projectId' : 'tripId']: id } : collection ? { tripId: id } : {};
    const result = await repository.call(token, action, { ...data, ...scope });
    if (map) {
      // Map DTO identifies a marker as visitId; retain the same cursor algorithm.
      const items = (result.items as JsonObject[]).map(item => ({ ...item, id: item.visitId }));
      const page = paginationPage({ items }, limit);
      page.items = (page.items as JsonObject[]).map(item => { const { id: _id, ...dto } = item; void _id; return dto; });
      return Response.json(page);
    }
    return Response.json(paginationPage(result, limit));
  }
  if (collection && request.method === 'POST') return Response.json(await repository.call(token, 'visits.create', { ...await visitInput(request, false), tripId: id }), { status: 201 });
  if (resource && request.method === 'GET') return Response.json(await repository.call(token, 'visits.get', { id }));
  if (resource && request.method === 'PATCH') return Response.json(await repository.call(token, 'visits.update', { ...await visitInput(request, true), id }));
  return null;
}
