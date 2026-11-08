import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createApiClient } from '../src/api/client.ts';
import { AppController } from '../src/private/controller.ts';
import AppView from '../src/private/AppView.tsx';
import { CollaborationController, invitationLink, memberActions } from '../src/private/collaboration/controller.ts';
import { InvitationList, ManagementView } from '../src/private/collaboration/Collaboration.tsx';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const time = '2026-11-08T00:00:00Z', expires = '2026-11-15T00:00:00Z';
const secret = 'Z'.repeat(43), origin = 'https://127.0.0.1:8789', link = `${origin}/invite#${secret}`;
const me = (actor = 1) => ({ id: id(actor), displayName: 'Synthetic collaborator', email: null, csrfToken: 'synthetic-collaboration-csrf', storage: { usedBytes: 0, reservedBytes: 0, quotaBytes: 500000000 } });
const project = { id: id(2), ownerUserId: id(1), name: 'Synthetic shared Project', tripCreationPolicy: 'all_project_members', status: 'active', createdAt: time };
const trip = (n = 3) => ({ id: id(n), projectId: id(2), createdByUserId: id(1), name: `Synthetic Trip ${n}`, description: null, status: 'active', createdAt: time, updatedAt: time });
const row = (n: number, role: 'owner' | 'admin' | 'member') => ({ userId: id(n), displayName: `Collaborator ${n}`, role, createdAt: time });
const roster = [row(1, 'owner'), row(5, 'admin'), row(6, 'member')];
const invite = (n = 20, kind: 'project' | 'trip' = 'project') => ({ id: id(n), scopeType: kind, scopeId: id(kind === 'project' ? 2 : 3), createdAt: time, expiresAt: expires, status: 'pending' });
const page = (items: unknown[] = [], nextCursor: string | null = null) => ({ items, nextCursor });
const place = { id: id(100), city: 'Synthetic city', region: null, countryCode: 'COL', countryName: 'Colombia', createdAt: time, approximateCoordinates: { lat: 4, lng: -74 }, source: { provider: null, id: null, url: null } };
const date = { mode: 'none', start: null, end: null };
const marker = { visitId: id(8), tripId: id(3), place, date, confirmedCoordinates: null, photoCount: 0, previewPhotoId: null, createdAt: time };
const visit = { id: id(8), tripId: id(3), placeId: place.id, place, date, name: 'Synthetic contribution', status: 'active', createdByUserId: id(6), confirmedCoordinates: null, photoCount: 0, previewPhotoId: null, createdAt: time, updatedAt: time };
const failure = (status: number) => Response.json({ error: { code: ({ 400: 'VALIDATION_ERROR', 401: 'SESSION_REQUIRED', 403: 'ACTION_FORBIDDEN', 404: 'RESOURCE_NOT_FOUND', 409: 'OPERATION_CONFLICT', 429: 'RATE_LIMITED', 503: 'DEPENDENCY_UNAVAILABLE' } as Record<number, string>)[status], message: `DO NOT DISPLAY ${secret}`, requestId: id(99) } }, { status });
type Handler = (path: string, init: RequestInit) => Response | undefined | Promise<Response | undefined>;
function setup(handler: Handler = () => undefined, actor = 1, initial = `/app/projects/${id(2)}`) {
  let path = initial, account = actor;
  const calls: { path: string; init: RequestInit }[] = [];
  const client = createApiClient((async (input, options) => {
    const p = String(input), init = options!; calls.push({ path: p, init });
    const result = await handler(p, init); if (result) return result;
    if (p === '/api/v1/me') return Response.json(me(account));
    if (p.startsWith('/api/v1/projects?')) return Response.json(page(account === 9 ? [] : [project]));
    if (p === `/api/v1/projects/${id(2)}`) return Response.json(project);
    if (p.startsWith(`/api/v1/projects/${id(2)}/trips?`)) return Response.json(page([trip(), trip(4)]));
    if (/\/map\?/.test(p)) return Response.json(page([marker]));
    if (/\/visits\?/.test(p)) return Response.json(page([visit]));
    if (p === `/api/v1/visits/${id(8)}`) return Response.json(visit);
    if (/^\/api\/v1\/trips\/[^/]+$/.test(p)) return Response.json(trip(Number(p.slice(-12))));
    if (/\/members\?/.test(p)) return Response.json(page(roster));
    if (/\/invitations\?/.test(p)) return Response.json(page([invite(20, p.includes('/trips/') ? 'trip' : 'project')]));
    if (/\/invitations$/.test(p) && init.method === 'POST') return Response.json({ ...invite(21, p.includes('/trips/') ? 'trip' : 'project'), invitationUrl: link }, { status: 201 });
    if (init.method !== 'GET') return new Response(null, { status: 204 });
    throw Error('Unexpected synthetic request');
  }) as typeof fetch);
  const app = new AppController(client, { read: () => path, go: target => { path = target; }, subscribe: () => () => undefined });
  function panel() {
    const state = ready(app); app.showCollaboration(true);
    return new CollaborationController(client, { actorId: state.user.id, ownerUserId: id(1), projectId: id(2), tripIds: [id(3), id(4)] }, {
      current: () => app.collaborationCurrent(state.user.id, id(2), state.formVersion),
      failure: app.collaborationFailure, refresh: app.refreshCollaboration,
    });
  }
  return { app, calls, panel, setActor: (n: number) => { account = n; }, setPath: (value: string) => { path = value; } };
}
function ready(app: AppController) { const state = app.getSnapshot(); if (state.phase !== 'ready') throw Error('Not ready'); return state; }
function html(app: AppController) { return renderToStaticMarkup(createElement(AppView, { state: app.getSnapshot(), actions: app, onLogin: () => undefined })); }
function management(panel: CollaborationController, actor = 1) { return renderToStaticMarkup(createElement(ManagementView, { state: panel.getSnapshot(), owner: actor === 1, actorId: id(actor), request: () => undefined, refresh: () => undefined, loadMembers: () => undefined })); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise<void>(done => setImmediate(done));

test('Project navigation does not probe management rosters or invitations', async () => {
  const h = setup(); await h.app.verify(); assert.match(html(h.app), /Manage members &amp; invitations|Collaboration/);
  assert.ok(!h.calls.some(c => /members|invitations/.test(c.path)));
  assert.doesNotMatch(html(h.app), /Leave Project<\/button>|Copy invitation link/);
});
test('explicit management loads paginated roster then safe invitation metadata using same-origin GET', async () => {
  const h = setup(); await h.app.verify(); const p = h.panel(); await p.loadMembers();
  assert.equal(p.getSnapshot().members.status, 'ready'); assert.equal(p.getSnapshot().invitations.status, 'ready');
  const reads = h.calls.filter(c => /members|invitations/.test(c.path));
  assert.deepEqual(reads.map(c => c.path), [`/api/v1/projects/${id(2)}/members?limit=25`, `/api/v1/projects/${id(2)}/invitations?limit=25`]);
  assert.ok(reads.every(c => c.init.credentials === 'same-origin' && c.init.cache === 'no-store'));
});
test('member cursor is opaque, explicit, deduplicated by userId and never auto-exhausted', async () => {
  const h = setup(p => p.includes('/members?') ? Response.json(p.includes('cursor=') ? page([roster[2], row(7, 'member')]) : page(roster, 'opaque+members/=')) : undefined);
  await h.app.verify(); const p = h.panel(); await p.loadMembers(); assert.equal(h.calls.filter(c => c.path.includes('/members?')).length, 1);
  await p.loadMembers(true); const state = p.getSnapshot(); assert.ok(state.members.status === 'ready' && state.members.page.items.length === 4);
  assert.equal(new URL(h.calls.findLast(c => c.path.includes('cursor='))!.path, origin).searchParams.get('cursor'), 'opaque+members/=');
});
test('Owner management shows promotion/demotion; Admin can remove ordinary Members only', async () => {
  const h = setup(); await h.app.verify(); const p = h.panel(); await p.loadMembers();
  assert.match(management(p), /Appoint Admin: Collaborator 6/); assert.match(management(p), /Demote to Member: Collaborator 5/);
  assert.doesNotMatch(management(p, 5), /Appoint Admin|Demote to Member|Remove participant: Collaborator 1|Remove participant: Collaborator 5/);
  assert.match(management(p, 5), /Remove participant: Collaborator 6/);
  assert.deepEqual(memberActions(true, id(1), roster[0]), []);
});
for (const action of ['promote', 'demote', 'remove'] as const) test(`Owner ${action} uses a dedicated endpoint, current CSRF and no caller role/actor body`, async () => {
  const h = setup(); await h.app.verify(); const p = h.panel(); await p.loadMembers();
  await p.changeMember(action, id(action === 'demote' ? 5 : 6));
  const mutation = h.calls.find(c => /\/members\//.test(c.path) && c.init.method !== 'GET')!;
  assert.ok(mutation); assert.equal(mutation.init.method, action === 'remove' ? 'DELETE' : 'POST');
  assert.ok(mutation.path.endsWith(action === 'remove' ? id(6) : action === 'promote' ? 'promote-admin' : 'remove-admin'));
  assert.equal(mutation.init.body, undefined); assert.equal(new Headers(mutation.init.headers).get('X-CSRF-Token'), me().csrfToken);
  assert.ok(ready(h.app).collaborationOpen); assert.match(ready(h.app).collaborationNotice ?? '', /confirmed/);
  const fresh = h.panel(); await fresh.loadMembers(); assert.equal(h.calls.filter(c => c.path.includes('/members?')).length, 2);
});
test('a successful promotion displays the refreshed server role, not the previous roster snapshot', async () => {
  let role: 'member' | 'admin' = 'member';
  const h = setup((path, init) => {
    if (path.endsWith('/promote-admin') && init.method === 'POST') { role = 'admin'; return new Response(null, { status: 204 }); }
    if (path.includes('/members?')) return Response.json(page([row(1, 'owner'), row(6, role)]));
  });
  await h.app.verify(); const previous = h.panel(); await previous.loadMembers(); assert.match(management(previous), /Appoint Admin: Collaborator 6/);
  await previous.changeMember('promote', id(6)); const fresh = h.panel(); await fresh.loadMembers();
  assert.match(management(fresh), /Demote to Member: Collaborator 6/); assert.doesNotMatch(management(fresh), /Appoint Admin: Collaborator 6/);
});
test('Admin role/Owner changes and unknown target IDs produce no crafted requests', async () => {
  const h = setup(undefined, 5); await h.app.verify(); const p = h.panel(); await p.loadMembers(); const before = h.calls.length;
  await p.changeMember('promote', id(6)); await p.changeMember('demote', id(5)); await p.changeMember('remove', id(1)); await p.changeMember('remove', id(999));
  assert.equal(h.calls.length, before);
});
test('known-ID Trip Guest removal requires managed Trip context and never changes inheritance', async () => {
  const h = setup(undefined, 5); await h.app.verify(); const p = h.panel(); await p.loadMembers(); const before = h.calls.length;
  await p.removeGuest(id(9)); assert.equal(h.calls.length, before);
  await p.chooseScope({ kind: 'trip', id: id(3) }); await p.removeGuest('not-an-id');
  await p.removeGuest(id(9));
  const mutation = h.calls.find(c => c.path === `/api/v1/trips/${id(3)}/members/${id(9)}`)!;
  assert.ok(mutation); assert.equal(mutation.init.method, 'DELETE'); assert.equal(mutation.init.body, undefined);
  assert.equal(new Headers(mutation.init.headers).get('X-CSRF-Token'), me(5).csrfToken);
  assert.ok(!h.calls.some(c => /\/projects\/[^/]+\/members\//.test(c.path)));
});
test('server denial wins over stale Owner affordances and clears map/collaboration context', async () => {
  const h = setup((p, init) => p.includes('/promote-admin') && init.method === 'POST' ? failure(403) : undefined);
  await h.app.verify(); const p = h.panel(); await p.loadMembers(); await p.changeMember('promote', id(6));
  assert.equal(ready(h.app).route.kind, 'home'); assert.equal(ready(h.app).scope.status, 'error'); assert.equal(ready(h.app).map.status, 'idle');
  // The independent fresh /projects list may still contain this authorized
  // Project: denied administration is not proof of lost ordinary membership.
  assert.doesNotMatch(html(h.app), /Synthetic city|Collaborator 6|DO NOT DISPLAY|project-management/);
});
test('Member management denial does not probe invitations or claim logout', async () => {
  const h = setup(p => p.includes('/members?') ? failure(403) : undefined, 6); await h.app.verify(); const p = h.panel(); await p.loadMembers();
  assert.ok(!h.calls.some(c => c.path.includes('/invitations'))); assert.equal(h.app.getSnapshot().phase, 'ready');
  assert.doesNotMatch(html(h.app), /signed out|membership revoked/i);
});
test('duplicate membership submission is suppressed while the explicit mutation is in flight', async () => {
  const waiting = deferred<Response>(); const h = setup(p => p.includes('/promote-admin') ? waiting.promise : undefined);
  await h.app.verify(); const p = h.panel(); await p.loadMembers(); const pending = p.changeMember('promote', id(6)); await tick();
  await p.changeMember('promote', id(6)); waiting.resolve(new Response(null, { status: 204 })); await pending;
  assert.equal(h.calls.filter(c => c.path.includes('/promote-admin')).length, 1);
});
for (const kind of ['project', 'trip'] as const) for (const actor of [1, 5]) test(`${actor === 1 ? 'Owner' : 'Admin'} ${kind} invitation issuance returns a one-time URL only to the immediate caller`, async () => {
  const h = setup(undefined, actor); await h.app.verify(); const p = h.panel(); await p.loadMembers();
  if (kind === 'trip') await p.chooseScope({ kind, id: id(3) });
  const issued = await p.issue(); assert.ok(issued); assert.equal(invitationLink(issued.invitationUrl, origin), link);
  assert.equal(Date.parse(issued.expiresAt) - Date.parse(issued.createdAt), 7 * 86400000);
  const mutation = h.calls.find(c => /\/invitations$/.test(c.path) && c.init.method === 'POST')!;
  assert.equal(mutation.path, `/api/v1/${kind === 'project' ? 'projects' : 'trips'}/${id(kind === 'project' ? 2 : 3)}/invitations`);
  assert.equal(mutation.init.body, undefined); assert.equal(new Headers(mutation.init.headers).get('X-CSRF-Token'), me().csrfToken);
  assert.ok(!JSON.stringify(p.getSnapshot()).includes(secret)); assert.ok(!JSON.stringify(h.app.getSnapshot()).includes(secret));
  assert.ok(h.calls.every(c => !c.path.includes(secret)));
});
test('foreign Trip invitation scope and client-selected roles/expiry are not submitted', async () => {
  const h = setup(); await h.app.verify(); const p = h.panel(); await p.loadMembers(); const before = h.calls.length;
  await p.chooseScope({ kind: 'trip', id: id(999) }); assert.equal(h.calls.length, before); assert.equal(p.getSnapshot().scope.kind, 'project');
});
test('invitation links must use the exact HTTPS origin and existing fragment-only landing', () => {
  assert.equal(invitationLink(link, origin), link);
  for (const bad of [`http://127.0.0.1:8789/invite#${secret}`, `https://other.invalid/invite#${secret}`, `${origin}/app#${secret}`, `${origin}/invite?token=x#${secret}`, `${origin}/invite#short`, `https://user:pass@127.0.0.1:8789/invite#${secret}`]) assert.throws(() => invitationLink(bad, origin));
});
test('closing creation aborts delayed issuance and does not deliver a token after closure', async () => {
  const delayed = deferred<Response>(); const h = setup((p, init) => p.endsWith('/invitations') && init.method === 'POST' ? delayed.promise : undefined);
  await h.app.verify(); const p = h.panel(); await p.loadMembers(); const pending = p.issue(); await tick(); p.cancelIssue();
  delayed.resolve(Response.json({ ...invite(), invitationUrl: link }, { status: 201 })); assert.equal(await pending, undefined);
  assert.ok(!JSON.stringify(p.getSnapshot()).includes(secret)); assert.equal(p.getSnapshot().pending, false);
});
test('completed issuance cleanup cannot clear the pending state of a later membership operation', async () => {
  const delayed = deferred<Response>(); const h = setup(p => p.includes('/promote-admin') ? delayed.promise : undefined);
  await h.app.verify(); const p = h.panel(); await p.loadMembers(); await p.issue(); await tick();
  const pending = p.changeMember('promote', id(6)); await tick(); p.cancelIssue(); assert.equal(p.getSnapshot().pending, true);
  delayed.resolve(new Response(null, { status: 204 })); await pending;
});
test('scope switching cancels invitation pages and never mixes Project/Trip rows', async () => {
  const delayed = deferred<Response>(); let delay = false;
  const h = setup(p => p.includes(`/projects/${id(2)}/invitations?`) && delay ? delayed.promise : undefined);
  await h.app.verify(); const p = h.panel(); await p.loadMembers(); delay = true;
  const pending = p.loadInvitations(); await tick(); await p.chooseScope({ kind: 'trip', id: id(3) });
  delayed.resolve(Response.json(page([invite(29)]))); await pending;
  const state = p.getSnapshot(); assert.ok(state.invitations.status === 'ready' && state.invitations.page.items.every(row => row.scopeType === 'trip'));
});
test('invitation metadata pagination is bounded, deduplicated and never reveals URLs/digests', async () => {
  const h = setup(p => p.includes('/invitations?') ? Response.json(p.includes('cursor=') ? page([invite(), invite(22)]) : page([invite()], 'opaque-invites')) : undefined);
  await h.app.verify(); const p = h.panel(); await p.loadMembers(); await p.loadInvitations(true);
  const state = p.getSnapshot(); assert.ok(state.invitations.status === 'ready' && state.invitations.page.items.length === 2);
  const text = renderToStaticMarkup(createElement(InvitationList, { state, refresh: () => undefined, more: () => undefined, revoke: () => undefined }));
  assert.doesNotMatch(text, /tokenDigest|invitationUrl|Z{43}/); assert.match(text, /Status reported by server: pending|Expires/);
});
test('token/digest injection into listing fails the generated DTO and clears private state', async () => {
  const h = setup(p => p.includes('/invitations?') ? Response.json(page([{ ...invite(), tokenDigest: 'secret-digest' }])) : undefined);
  await h.app.verify(); const p = h.panel(); await p.loadMembers(); assert.equal(h.app.getSnapshot().phase, 'unavailable');
  assert.doesNotMatch(html(h.app), /secret-digest|Synthetic city/);
});
for (const kind of ['project', 'trip'] as const) test(`${kind} invitation revocation uses matching scope and refreshes authoritative listing`, async () => {
  const h = setup(); await h.app.verify(); const p = h.panel(); await p.loadMembers(); if (kind === 'trip') await p.chooseScope({ kind, id: id(3) });
  const before = h.calls.filter(c => c.path.includes('/invitations?')).length; await p.revoke(id(20));
  assert.ok(h.calls.some(c => c.path === `/api/v1/${kind === 'project' ? 'projects' : 'trips'}/${id(kind === 'project' ? 2 : 3)}/invitations/${id(20)}/revoke` && c.init.method === 'POST'));
  assert.equal(h.calls.filter(c => c.path.includes('/invitations?')).length, before + 1);
  assert.ok(!h.calls.some(c => c.init.method === 'DELETE'));
});
test('consumed/expired/revoked statuses do not offer revocation or promise usable links', async () => {
  const h = setup(p => p.includes('/invitations?') ? Response.json(page(['consumed', 'expired', 'revoked'].map((status, i) => ({ ...invite(20 + i), status })))) : undefined);
  await h.app.verify(); const p = h.panel(); await p.loadMembers(); const before = h.calls.length; await p.revoke(id(20)); assert.equal(h.calls.length, before);
  const text = renderToStaticMarkup(createElement(InvitationList, { state: p.getSnapshot(), refresh: () => undefined, more: () => undefined, revoke: () => undefined }));
  assert.doesNotMatch(text, /Revoke invitation/); assert.match(text, /consumed/);
});
test('stale pending invitation revoked concurrently returns safe409 without membership revocation or retry', async () => {
  const h = setup(p => p.endsWith('/revoke') ? failure(409) : undefined); await h.app.verify(); const p = h.panel(); await p.loadMembers(); await p.revoke(id(20));
  assert.match(p.getSnapshot().message ?? '', /conflicts|No automatic retry/);
  assert.equal(h.calls.filter(c => c.path.endsWith('/revoke')).length, 1); assert.ok(!h.calls.some(c => c.path.includes('/members/')));
});
for (const status of [400, 401, 403, 404, 409, 429, 503]) test(`collaboration ${status} has safe errors and preserves correct authentication semantics`, async () => {
  const h = setup(p => p.includes('/members?') ? failure(status) : undefined); await h.app.verify(); const p = h.panel(); await p.loadMembers();
  const state = h.app.getSnapshot();
  if (status === 401) assert.equal(state.phase, 'anonymous'); else if (status === 503) assert.equal(state.phase, 'unavailable');
  else if ([403, 404].includes(status)) assert.ok(state.phase === 'ready' && state.scope.status === 'error' && state.map.status === 'idle');
  else assert.ok(state.phase === 'ready' && p.getSnapshot().message);
  assert.doesNotMatch(html(h.app), /DO NOT DISPLAY|Z{43}|You have signed out/);
});
test('collaboration network failure hides private state without declaring revocation/logout', async () => {
  const h = setup(p => { if (p.includes('/members?')) throw Error('postgresql://never-log-this'); }); await h.app.verify(); const p = h.panel(); await p.loadMembers();
  assert.equal(h.app.getSnapshot().phase, 'unavailable'); assert.doesNotMatch(html(h.app), /never-log-this|signed out|membership revoked/i);
});
for (const kind of ['project', 'trip'] as const) test(`${kind} departure is explicit, CSRF-protected and clears descendant UI only after acknowledgement`, async () => {
  const delayed = deferred<Response>(); const h = setup(p => p.endsWith('/leave') ? delayed.promise : undefined, kind === 'trip' ? 9 : 6, `/app/${kind === 'trip' ? 'trips' : 'projects'}/${id(kind === 'trip' ? 3 : 2)}`);
  await h.app.verify(); if (kind === 'trip') await h.app.openMapVisit(id(8));
  assert.ok(!h.calls.some(c => c.path.endsWith('/leave'))); const pending = h.app.leaveResource(); await tick(); assert.equal(ready(h.app).mutation.pending, true);
  await h.app.leaveResource(); delayed.resolve(new Response(null, { status: 204 })); await pending;
  assert.equal(h.calls.filter(c => c.path.endsWith('/leave')).length, 1); assert.equal(ready(h.app).route.kind, 'home'); assert.equal(ready(h.app).map.status, 'idle');
  assert.doesNotMatch(html(h.app), /Synthetic contribution|Synthetic city|Trip Guest|Copy invitation/);
});
test('inherited Trip departure denied403 clears scope safely without claiming departure or logout', async () => {
  const h = setup(p => p.endsWith('/leave') ? failure(403) : undefined, 6, `/app/trips/${id(3)}`); await h.app.verify(); await h.app.leaveResource();
  assert.equal(ready(h.app).map.status, 'idle'); assert.equal(ready(h.app).route.kind, 'home');
  assert.doesNotMatch(html(h.app), /You have left|You have signed out|Synthetic city/);
});
test('failed departure409 is not acknowledged as successful', async () => {
  const h = setup(p => p.endsWith('/leave') ? failure(409) : undefined, 6); await h.app.verify(); await h.app.leaveResource();
  assert.equal(ready(h.app).route.kind, 'project'); assert.match(ready(h.app).mutation.error ?? '', /Departure was not confirmed/);
});
test('direct Trip Guest sees no Project management and makes no privileged probes', async () => {
  const h = setup(undefined, 9, `/app/trips/${id(3)}`); await h.app.verify(); const text = html(h.app);
  assert.match(text, /Request Trip departure \(Guest only\)/); assert.doesNotMatch(text, /Manage members|New invitation|Synthetic shared Project|Project member management/);
  assert.ok(!h.calls.some(c => /\/projects\/|members|invitations/.test(c.path)));
});
test('owning an unrelated Project never grants administration in a direct Guest Trip', async () => {
  const h = setup(p => p.startsWith('/api/v1/projects?') ? Response.json(page([{ ...project, id: id(90), ownerUserId: id(9), name: 'Independent authorized Project' }])) : undefined, 9, `/app/trips/${id(3)}`);
  await h.app.verify(); assert.match(html(h.app), /Independent authorized Project/);
  assert.doesNotMatch(html(h.app), /Manage members|New invitation|Synthetic shared Project/);
  assert.ok(!h.calls.some(c => /\/projects\/|members|invitations/.test(c.path)));
});
test('acknowledged membership changes invalidate older map requests before reloading management', async () => {
  const delayed = deferred<Response>(); let delay = false;
  const h = setup(p => { if (p.includes('/map?') && delay) { delay = false; return delayed.promise; } });
  await h.app.verify(); const p = h.panel(); await p.loadMembers(); delay = true;
  const old = h.app.loadMap(); await tick(); await p.changeMember('remove', id(6));
  delayed.resolve(Response.json(page([{ ...marker, visitId: id(88) }]))); await old;
  assert.ok(!JSON.stringify(h.app.getSnapshot()).includes(id(88))); assert.equal(ready(h.app).collaborationOpen, true);
});
test('invitation issuance touches neither persistent storage nor logging channels', async () => {
  const h = setup(); await h.app.verify(); const p = h.panel(); await p.loadMembers();
  const logs: unknown[][] = [], originals = { log: console.log, warn: console.warn, error: console.error };
  const stores = ['localStorage', 'sessionStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  try {
    for (const [key] of stores) Object.defineProperty(globalThis, key, { configurable: true, get() { throw Error('Unexpected persistent storage'); } });
    for (const key of ['log', 'warn', 'error'] as const) console[key] = (...args: unknown[]) => { logs.push(args); };
    assert.ok(await p.issue()); await tick(); assert.equal(logs.length, 0);
  } finally {
    Object.assign(console, originals);
    for (const [key, descriptor] of stores) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
test('roster responses cannot outlive navigation, account replacement, logout or panel closure', async () => {
  for (const action of ['navigate', 'account', 'logout', 'close', 'dispose']) {
    const delayed = deferred<Response>(); const h = setup(p => p.includes('/members?') ? delayed.promise : undefined);
    await h.app.verify(); const p = h.panel(); const pending = p.loadMembers(); await tick();
    if (action === 'navigate') await h.app.navigate(`/app/trips/${id(3)}`);
    else if (action === 'account') { h.setActor(6); await h.app.verify(); }
    else if (action === 'logout') await h.app.logout(); else if (action === 'close') h.app.showCollaboration(false); else p.dispose();
    delayed.resolve(Response.json(page([row(77, 'member')]))); await pending;
    assert.ok(!JSON.stringify(p.getSnapshot()).includes('Collaborator 77')); assert.ok(!h.calls.some(c => c.path.includes('/invitations')));
  }
});
test('StrictMode effect cleanup/restart uses fresh requests and cannot restore an aborted roster', async () => {
  const old = deferred<Response>(); let first = true;
  const h = setup(p => { if (p.includes('/members?') && first) { first = false; return old.promise; } });
  await h.app.verify(); const p = h.panel(); const initial = p.start(); await tick(); p.dispose(); await p.start();
  old.resolve(Response.json(page([row(77, 'member')]))); await initial;
  assert.ok(p.getSnapshot().members.status === 'ready'); assert.ok(!JSON.stringify(p.getSnapshot()).includes('Collaborator 77'));
});
test('disposed panels cannot initiate membership or invitation operations even before parent cleanup', async () => {
  const h = setup(); await h.app.verify(); const p = h.panel(); await p.loadMembers(); p.dispose(); const before = h.calls.length;
  await p.changeMember('promote', id(6)); await p.issue(); await p.revoke(id(20)); await p.removeGuest(id(9)); await p.chooseScope({ kind: 'trip', id: id(3) });
  assert.equal(h.calls.length, before);
});
test('session change during issuance never returns the previous account token', async () => {
  const delayed = deferred<Response>(); const h = setup((p, init) => p.endsWith('/invitations') && init.method === 'POST' ? delayed.promise : undefined);
  await h.app.verify(); const p = h.panel(); await p.loadMembers(); const pending = p.issue(); await tick(); h.setActor(6); await h.app.verify();
  delayed.resolve(Response.json({ ...invite(), invitationUrl: link }, { status: 201 })); assert.equal(await pending, undefined);
  assert.ok(!JSON.stringify(h.app.getSnapshot()).includes(secret));
});
test('revocation observed during map interaction clears selected Visit and collaboration state', async () => {
  let revoked = false; const h = setup(p => p.includes('/map?') && revoked ? failure(404) : undefined, 9, `/app/trips/${id(3)}`);
  await h.app.verify(); await h.app.openMapVisit(id(8)); assert.match(html(h.app), /Synthetic contribution/);
  revoked = true; await h.app.loadMap(); assert.equal(ready(h.app).map.status, 'idle'); assert.doesNotMatch(html(h.app), /Synthetic contribution|Synthetic city|Copy invitation/);
});
test('History revalidation closes collaboration and never persists panel or bearer context', async () => {
  const h = setup(); await h.app.verify(); const p = h.panel(); await p.loadMembers();
  h.setPath(`/app/trips/${id(3)}`); await h.app.verify(); h.setPath(`/app/projects/${id(2)}`); await h.app.verify();
  assert.equal(Boolean(ready(h.app).collaborationOpen), false); assert.ok(!JSON.stringify(h.app.getSnapshot()).includes(secret));
});
