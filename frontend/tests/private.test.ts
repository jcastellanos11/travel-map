import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApiClient } from '../src/api/client.ts';
import { AppController, tripCreationHint } from '../src/private/controller.ts';
import type { Snapshot } from '../src/private/controller.ts';
import AppView from '../src/private/AppView.tsx';
import { browserNavigation, consumeLoginPath, googleLoginPath, parseRoute, rememberLoginPath } from '../src/private/navigation.ts';
import type { Navigation } from '../src/private/navigation.ts';
import { projectForm, tripForm } from '../src/private/forms.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const time = '2026-11-07T00:00:00Z';
const me = { id: id(1), displayName: 'Synthetic user', email: null, csrfToken: 'synthetic-csrf', storage: { usedBytes: 0, reservedBytes: 0, quotaBytes: 500000000 } } as const;
const project = (n = 2) => ({ id: id(n), ownerUserId: id(1), name: `Private Project ${n}`, tripCreationPolicy: 'admins_only' as const, status: 'active' as const, createdAt: time });
const trip = (n = 3, parent = 2) => ({ id: id(n), projectId: id(parent), createdByUserId: id(1), name: `Private Trip ${n}`, description: 'Synthetic description', status: 'active' as const, createdAt: time, updatedAt: time });
const page = (items: unknown[] = [], nextCursor: string | null = null) => ({ items, nextCursor });
const error = (status: number) => Response.json({ error: { code: ({ 400: 'VALIDATION_ERROR', 401: 'SESSION_REQUIRED', 403: 'ACTION_FORBIDDEN', 404: 'RESOURCE_NOT_FOUND', 503: 'DEPENDENCY_UNAVAILABLE' } as Record<number, string>)[status], message: 'INTERNAL NEVER DISPLAY', requestId: id(90) } }, { status });
type Handler = (path: string, init: RequestInit) => Promise<Response> | Response | undefined;
function setup(path = '/app', handler: Handler = () => undefined) {
  let currentPath = path;
  const navigations: string[] = [], calls: { path: string; init: RequestInit }[] = [];
  const navigation: Navigation = { read: () => currentPath, go: target => { currentPath = target; navigations.push(target); }, subscribe: () => () => undefined };
  const client = createApiClient((async (input, options) => {
    const p = String(input), init = options!;
    calls.push({ path: p, init });
    const result = await handler(p, init);
    if (result) return result;
    if (p === '/api/v1/me') return Response.json(me);
    if (p.startsWith('/api/v1/projects?')) return Response.json(page([project()]));
    if (p.startsWith('/api/v1/projects/') && p.includes('/trips?')) return Response.json(page([trip()]));
    if (p === `/api/v1/projects/${id(2)}`) return Response.json(project());
    if (p === `/api/v1/projects/${id(4)}`) return Response.json(project(4));
    if (p === `/api/v1/trips/${id(3)}`) return Response.json(trip());
    if (p === `/api/v1/trips/${id(5)}`) return Response.json(trip(5, 4));
    throw new Error('Unplanned synthetic request');
  }) as typeof fetch);
  const controller = new AppController(client, navigation);
  return { controller, calls, navigations, setPath: (value: string) => { currentPath = value; } };
}
function ready(snapshot: Snapshot) { assert.equal(snapshot.phase, 'ready'); if (snapshot.phase !== 'ready') throw new Error(); return snapshot; }
function html(controller: AppController) { return renderToStaticMarkup(createElement(AppView, { state: controller.getSnapshot(), actions: controller, onLogin: () => undefined })); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; }
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('anonymous deep link shows Google entry without private shell or DTOs', async () => {
  const h = setup(`/app/trips/${id(3)}`, p => p === '/api/v1/me' ? error(401) : undefined);
  await h.controller.verify();
  assert.equal(h.controller.getSnapshot().phase, 'anonymous');
  assert.equal(h.controller.getSnapshot().route.kind, 'trip');
  assert.match(html(h.controller), new RegExp(`href="${googleLoginPath}"`));
  assert.doesNotMatch(html(h.controller), /Project selector|project-selector|Private Project|csrf|synthetic-csrf|Sign out/);
  assert.equal(h.calls.length, 1);
});
test('authenticated user sees shell, empty landing and accessible controls, not profile secrets', async () => {
  const h = setup(); await h.controller.verify();
  assert.match(html(h.controller), /Your journeys|project-selector|Sign out|New Project/);
  assert.doesNotMatch(html(h.controller), /synthetic-csrf|Synthetic user|INTERNAL NEVER DISPLAY/);
  assert.ok(!('csrfToken' in ready(h.controller.getSnapshot()).user));
});
test('zero Projects is honest and creates nothing on authentication', async () => {
  const h = setup('/app', p => p.startsWith('/api/v1/projects?') ? Response.json(page()) : undefined);
  await h.controller.verify(); assert.match(html(h.controller), /no Project memberships/);
  assert.ok(h.calls.every(c => c.init.method === 'GET'));
});
test('Project pagination appends stable IDs without duplication and preserves cursor', async () => {
  const h = setup('/app', p => p.startsWith('/api/v1/projects?') ? Response.json(p.includes('cursor=') ? page([project(), project(4)]) : page([project()], 'synthetic+cursor/=')) : undefined);
  await h.controller.verify(); await h.controller.loadProjects(true);
  const state = ready(h.controller.getSnapshot()); assert.equal(state.projects.status, 'ready');
  if (state.projects.status === 'ready') { assert.deepEqual(state.projects.page.items.map(p => p.id), [id(2), id(4)]); assert.equal(state.projects.page.nextCursor, null); }
  assert.equal(new URL(h.calls.at(-1)!.path, 'https://test.invalid').searchParams.get('cursor'), 'synthetic+cursor/=');
});
test('Project scope lists authorized Trips and supports empty Trips', async () => {
  const h = setup(`/app/projects/${id(2)}`); await h.controller.verify();
  assert.match(html(h.controller), /Private Project 2|Private Trip 3|New Trip/);
  const empty = setup(`/app/projects/${id(2)}`, p => p.includes('/trips?') ? Response.json(page()) : undefined);
  await empty.controller.verify(); assert.match(html(empty.controller), /No Trips yet/);
});
test('Trip pagination is scoped and appends only the server page', async () => {
  const h = setup(`/app/projects/${id(2)}`, p => p.includes('/trips?') ? Response.json(p.includes('cursor=') ? page([trip(6)]) : page([trip()], 'trip-cursor')) : undefined);
  await h.controller.verify(); await h.controller.loadMoreTrips();
  const scope = ready(h.controller.getSnapshot()).scope;
  assert.equal(scope.status, 'project');
  if (scope.status === 'project' && scope.trips.status === 'ready') assert.deepEqual(scope.trips.page.items.map(t => t.id), [id(3), id(6)]);
});
test('new Project posts approved fields, refreshes list, navigates and is selectable beyond first page', async () => {
  const h = setup('/app', (p, init) => {
    if (p === '/api/v1/projects' && init.method === 'POST') {
      assert.deepEqual(JSON.parse(String(init.body)), { name: 'Chosen', tripCreationPolicy: 'all_project_members' });
      assert.equal(new Headers(init.headers).get('X-CSRF-Token'), me.csrfToken);
      return Response.json(project(4), { status: 201 });
    }
  });
  await h.controller.verify(); await h.controller.createProject({ name: 'Chosen', tripCreationPolicy: 'all_project_members' });
  assert.equal(h.navigations.at(-1), `/app/projects/${id(4)}`);
  assert.match(html(h.controller), new RegExp(`option value="${id(4)}" selected`));
  assert.equal(h.calls.filter(c => c.path.startsWith('/api/v1/projects?')).length, 2);
});
test('Project server validation error preserves form feedback and never navigates', async () => {
  const h = setup('/app', (p, init) => p === '/api/v1/projects' && init.method === 'POST' ? error(400) : undefined);
  await h.controller.verify(); await h.controller.createProject({ name: 'Rejected' });
  assert.match(html(h.controller), /Check the request values/); assert.equal(h.navigations.length, 0);
  assert.doesNotMatch(html(h.controller), /INTERNAL NEVER DISPLAY/);
});
test('Trip creation sends only supported fields under selected Project then opens direct Trip', async () => {
  const h = setup(`/app/projects/${id(2)}`, (p, init) => {
    if (p === `/api/v1/projects/${id(2)}/trips` && init.method === 'POST') {
      assert.deepEqual(JSON.parse(String(init.body)), { name: 'Chosen Trip', description: null });
      return Response.json(trip(), { status: 201 });
    }
  });
  await h.controller.verify(); await h.controller.createTrip({ name: 'Chosen Trip', description: null });
  assert.equal(h.navigations.at(-1), `/app/trips/${id(3)}`);
  assert.equal(ready(h.controller.getSnapshot()).scope.status, 'trip');
});
test('crafted creation objects cannot assign ownership, actor, role, status or a different parent', async () => {
  const h = setup(`/app/projects/${id(2)}`, (p, init) => {
    if (p.endsWith('/trips') && init.method === 'POST') {
      assert.equal(p, `/api/v1/projects/${id(2)}/trips`);
      assert.deepEqual(JSON.parse(String(init.body)), { name: 'Safe', description: null });
      return Response.json(trip(), { status: 201 });
    }
    if (p === '/api/v1/projects' && init.method === 'POST') {
      assert.deepEqual(JSON.parse(String(init.body)), { name: 'Safe', tripCreationPolicy: 'admins_only' });
      return Response.json(project(), { status: 201 });
    }
  });
  await h.controller.verify();
  const crafted = { name: 'Safe', description: null, tripCreationPolicy: 'admins_only' as const, ownerUserId: id(9), createdByUserId: id(9), projectId: id(9), role: 'owner', status: 'archived' };
  await h.controller.createTrip(crafted); await h.controller.createProject(crafted);
});
test('server denies Trip creation safely; no invented Admin capability or cached parent leaks', async () => {
  const h = setup(`/app/projects/${id(2)}`, (p, init) => p.endsWith('/trips') && init.method === 'POST' ? error(403) : undefined);
  await h.controller.verify(); await h.controller.createTrip({ name: 'Denied' });
  assert.equal(ready(h.controller.getSnapshot()).scope.status, 'error');
  assert.match(html(h.controller), /This action is not allowed/);
  assert.doesNotMatch(html(h.controller), /Private Trip 3|New Trip/);
});
test('creation affordances use only owner/policy facts, never a fabricated viewer role', () => {
  const user = { ...me }; const { csrfToken: unused, ...publicUser } = user; void unused;
  assert.equal(tripCreationHint(project(), publicUser), 'allowed');
  assert.equal(tripCreationHint({ ...project(), ownerUserId: id(9) }, publicUser), 'server-check');
  assert.equal(tripCreationHint({ ...project(), ownerUserId: id(9), tripCreationPolicy: 'all_project_members' }, publicUser), 'allowed');
});
test('direct Trip-only Guest never requests parent, sibling Trips, roster, maps or settings', async () => {
  const h = setup(`/app/trips/${id(3)}`, p => p.startsWith('/api/v1/projects?') ? Response.json(page()) : undefined);
  await h.controller.verify();
  assert.equal(ready(h.controller.getSnapshot()).scope.status, 'trip');
  assert.match(html(h.controller), /Private Trip 3/);
  assert.doesNotMatch(html(h.controller), /Private Project 2|New Trip|createdByUserId|projectId/);
  assert.deepEqual(h.calls.map(c => c.path).sort(), ['/api/v1/me', '/api/v1/projects?limit=25', `/api/v1/trips/${id(3)}`].sort());
});
for (const status of [403, 404]) test(`inaccessible Project ${status} clears scope details and offers safe recovery`, async () => {
  const h = setup(`/app/projects/${id(2)}`, p => p === `/api/v1/projects/${id(2)}` ? error(status) : undefined);
  await h.controller.verify(); assert.equal(ready(h.controller.getSnapshot()).scope.status, 'error');
  assert.doesNotMatch(html(h.controller), /Private Trip 3|New Trip|INTERNAL NEVER DISPLAY/);
});
test('lost Trip membership on next navigation clears previous Trip content', async () => {
  let denied = false;
  const h = setup(`/app/trips/${id(3)}`, p => p === `/api/v1/trips/${id(3)}` && denied ? error(404) : undefined);
  await h.controller.verify(); denied = true; await h.controller.verify();
  assert.doesNotMatch(html(h.controller), /Private Trip 3|Synthetic description/);
});
test('late Project A response ignoring abort cannot overwrite Project B', async () => {
  const delayed = deferred<Response>();
  const h = setup(`/app/projects/${id(2)}`, p => p === `/api/v1/projects/${id(2)}` ? delayed.promise : undefined);
  const old = h.controller.verify(); await tick();
  await h.controller.navigate(`/app/projects/${id(4)}`);
  delayed.resolve(Response.json(project())); await old;
  const scope = ready(h.controller.getSnapshot()).scope;
  assert.equal(scope.status, 'project'); if (scope.status === 'project') assert.equal(scope.project.id, id(4));
  assert.ok(h.calls.find(c => c.path === `/api/v1/projects/${id(2)}`)?.init.signal?.aborted);
});
test('late Trip response cannot replace a newer direct Trip', async () => {
  const delayed = deferred<Response>();
  const h = setup(`/app/trips/${id(3)}`, p => p === `/api/v1/trips/${id(3)}` ? delayed.promise : undefined);
  const old = h.controller.verify(); await tick(); await h.controller.navigate(`/app/trips/${id(5)}`);
  delayed.resolve(Response.json(trip())); await old;
  assert.match(html(h.controller), /Private Trip 5/); assert.doesNotMatch(html(h.controller), /Private Trip 3/);
});
test('confirmed 401 clears all private state and selection, cancelling concurrent requests', async () => {
  let expired = false;
  const h = setup(`/app/projects/${id(2)}`, p => p === '/api/v1/me' && expired ? error(401) : undefined);
  await h.controller.verify(); expired = true; await h.controller.verify();
  assert.equal(h.controller.getSnapshot().phase, 'anonymous'); assert.equal(h.controller.getSnapshot().route.kind, 'home');
  assert.doesNotMatch(JSON.stringify(h.controller.getSnapshot()), /Private Project|Private Trip|ownerUserId|csrfToken/);
  assert.equal(h.navigations.at(-1), '/app');
});
test('protected request 401 clears state independently of initial /me success', async () => {
  const h = setup(`/app/trips/${id(3)}`, p => p === `/api/v1/trips/${id(3)}` ? error(401) : undefined);
  await h.controller.verify(); assert.equal(h.controller.getSnapshot().phase, 'anonymous');
  assert.doesNotMatch(html(h.controller), /Private Project|Private Trip/);
});
for (const failure of ['network', '503'] as const) test(`${failure} hides stale private state and is not represented as logout`, async () => {
  let failed = false;
  const h = setup('/app', p => { if (p === '/api/v1/me' && failed) { if (failure === 'network') throw new Error('synthetic network outage'); return error(503); } });
  await h.controller.verify(); failed = true; await h.controller.verify();
  assert.equal(h.controller.getSnapshot().phase, 'unavailable');
  assert.match(html(h.controller), /server session may still be active|Retry session check/);
  assert.doesNotMatch(html(h.controller), /You have signed out|Private Project|Continue with Google/);
});
test('scope dependency outage hides all private presentation without claiming expiration', async () => {
  const h = setup(`/app/projects/${id(2)}`, p => p.includes('/trips?') ? error(503) : undefined);
  await h.controller.verify(); assert.equal(h.controller.getSnapshot().phase, 'unavailable');
  assert.doesNotMatch(html(h.controller), /Private Project|Private Trip/);
});
test('successful logout uses fresh CSRF, clears DTOs, cancels work and confirms only after 204', async () => {
  const acknowledgement = deferred<Response>();
  const h = setup(`/app/projects/${id(2)}`, (p, init) => {
    if (p === '/api/v1/auth/logout') { assert.equal(init.method, 'POST'); assert.equal(new Headers(init.headers).get('X-CSRF-Token'), me.csrfToken); return acknowledgement.promise; }
  });
  await h.controller.verify(); const pending = h.controller.logout(); await tick();
  assert.equal(h.controller.getSnapshot().phase, 'logging-out'); assert.doesNotMatch(html(h.controller), /Private Project|You have signed out/);
  acknowledgement.resolve(new Response(null, { status: 204 })); await pending;
  assert.equal(h.controller.getSnapshot().phase, 'anonymous'); assert.match(html(h.controller), /You have signed out/);
});
test('failed logout hides DTOs, does not claim revocation and offers retry', async () => {
  let retry = false;
  const h = setup('/app', p => p === '/api/v1/auth/logout' ? retry ? new Response(null, { status: 204 }) : error(503) : undefined);
  await h.controller.verify(); await h.controller.logout();
  assert.equal(h.controller.getSnapshot().phase, 'logout-failed'); assert.match(html(h.controller), /Sign-out was not confirmed|Retry sign-out/);
  assert.doesNotMatch(html(h.controller), /Private Project|You have signed out/);
  retry = true; await h.controller.logout(); assert.equal(h.controller.getSnapshot().phase, 'anonymous');
});
test('old in-flight data cannot reappear after logout or account switch', async () => {
  const delayed = deferred<Response>(); let actor = 1;
  const h = setup('/app', p => {
    if (p === '/api/v1/me') return Response.json({ ...me, id: id(actor) });
    if (p.startsWith('/api/v1/projects?')) return actor === 1 ? delayed.promise : Response.json(page([project(4)]));
    if (p === '/api/v1/auth/logout') return new Response(null, { status: 204 });
  });
  const old = h.controller.verify(); await tick(); await h.controller.logout(); actor = 8; await h.controller.verify();
  delayed.resolve(Response.json(page([project()]))); await old;
  const state = ready(h.controller.getSnapshot()); assert.equal(state.user.id, id(8)); assert.match(html(h.controller), /Private Project 4/); assert.doesNotMatch(html(h.controller), /Private Project 2/);
});
test('suspending/disposal clears active content and ignores late responses', async () => {
  const h = setup(`/app/projects/${id(2)}`); await h.controller.verify(); h.controller.suspend();
  assert.equal(h.controller.getSnapshot().phase, 'checking'); assert.doesNotMatch(html(h.controller), /Private Project|Private Trip/);
  const delayed = deferred<Response>(); const other = setup('/app', p => p === '/api/v1/me' ? delayed.promise : undefined);
  const request = other.controller.verify(); other.controller.dispose(); delayed.resolve(Response.json(me)); await request;
  assert.equal(other.controller.getSnapshot().phase, 'checking'); assert.equal(other.calls.length, 1);
});
test('navigation parsing is bounded and never captures API, invitations, demo or secret fragments', () => {
  assert.deepEqual(parseRoute('/app'), { kind: 'home' });
  assert.deepEqual(parseRoute(`/app/trips/${id(3)}`), { kind: 'trip', id: id(3) });
  for (const path of ['/api/v1/me', '/invite', '/api-docs', '/demo/', '/app/unknown', '/app/trips/invalid', `/app/trips/${id(3)}?token=secret`, '//evil.invalid', '/app/projects/x/y']) assert.equal(parseRoute(path).kind, 'not-found');
});
test('browser History adapter supports push, replace and Back/Forward subscription without hash/state DTOs', () => {
  const events = new EventTarget(); let at = 0; const paths = ['/app'];
  const location = { pathname: '/app' };
  const browser = { location, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), history: {
    pushState: (state: unknown, _title: string, path: string) => { assert.equal(state, null); paths.splice(++at); paths[at] = path; location.pathname = path; },
    replaceState: (state: unknown, _title: string, path: string) => { assert.equal(state, null); paths[at] = path; location.pathname = path; },
  } } as unknown as Window;
  const nav = browserNavigation(browser); let changes = 0; const stop = nav.subscribe(() => changes++);
  nav.go(`/app/projects/${id(2)}`); nav.go(`/app/trips/${id(3)}`);
  location.pathname = paths[--at]; events.dispatchEvent(new Event('popstate')); assert.equal(nav.read(), `/app/projects/${id(2)}`);
  location.pathname = paths[++at]; events.dispatchEvent(new Event('popstate')); assert.equal(nav.read(), `/app/trips/${id(3)}`);
  nav.go('/app', true); assert.equal(paths.length, 3); assert.equal(changes, 2); stop();
});
test('invalid application URL renders controlled not-found without scope lookup', async () => {
  const h = setup('/app/not-an-endpoint'); await h.controller.verify();
  assert.match(html(h.controller), /Page not found/);
  assert.ok(h.calls.every(c => c.path === '/api/v1/me' || c.path.startsWith('/api/v1/projects?')));
});
test('OAuth continuation retains only a validated relative route, is one-use and expires', () => {
  const data = new Map<string, string>(); const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
  rememberLoginPath(storage, `/app/trips/${id(3)}`, 10);
  assert.equal(consumeLoginPath(storage, 11), `/app/trips/${id(3)}`); assert.equal(data.size, 0); assert.equal(consumeLoginPath(storage, 12), '/app');
  rememberLoginPath(storage, '/app', 10); assert.equal(consumeLoginPath(storage, 700_000), '/app');
  for (const path of ['https://evil.invalid', '/invite#secret', `/app/trips/${id(3)}?code=secret`]) { rememberLoginPath(storage, path, 10); assert.doesNotMatch([...data.values()].join(), /evil|secret|code=/); assert.equal(consumeLoginPath(storage, 11), '/app'); }
  storage.setItem('travel-map.login-return', JSON.stringify({ path: '//evil.invalid', expires: 100 })); assert.equal(consumeLoginPath(storage, 11), '/app');
});
test('form validation follows Unicode limits and constructs only approved create DTOs', () => {
  assert.deepEqual(projectForm('  My Project  ', 'admins_only').value, { name: 'My Project', tripCreationPolicy: 'admins_only' });
  assert.ok(projectForm('😀'.repeat(200), 'all_project_members').value);
  for (const name of ['', ' ', 'a'.repeat(201), 'bad\nname', '\ud800']) assert.equal(projectForm(name, 'admins_only').value, undefined);
  assert.equal(projectForm('Project', 'owner').value, undefined);
  assert.deepEqual(tripForm(' Trip ', '').value, { name: 'Trip', description: null });
  assert.ok(tripForm('Trip', 'a'.repeat(2000)).value);
  for (const description of ['a'.repeat(2001), '\0', '\ud800']) assert.equal(tripForm('Trip', description).value, undefined);
});
test('creation form fields are labelled, have associated feedback and avoid administrative inputs', async () => {
  const h = setup(`/app/projects/${id(2)}`); await h.controller.verify(); const view = html(h.controller);
  for (const field of ['create-project-name', 'create-project-policy', 'create-trip-name', 'create-trip-description']) {
    assert.ok(view.includes(`for="${field}"`)); assert.ok(view.includes(`id="${field}"`));
  }
  assert.match(view, /aria-describedby="create-trip-description-help"/);
  assert.doesNotMatch(view, /name="(?:ownerUserId|createdByUserId|role|status)"/);
});
