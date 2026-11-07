import { ApiError, paginatedPath } from '../api/client.ts';
import type { createApiClient } from '../api/client.ts';
import { decodeDto } from '../api/contracts.ts';
import type { CurrentUser, Page, Project, Trip, Visit } from '../api/contracts.ts';
import type { ProjectCreate, TripCreate, VisitCreate, VisitPatch } from '../api/generated.ts';
import { placeSearch, visitForm } from './visits/forms.ts';
import type { VisitWorkspace } from './visits/types.ts';
import { parseRoute } from './navigation.ts';
import type { AppRoute, Navigation } from './navigation.ts';

type Client = ReturnType<typeof createApiClient>;
export type ListState<T> = { status: 'loading' | 'error'; message?: string }
  | { status: 'ready'; page: Page<T>; loadingMore: boolean; message?: string };
export type ScopeState = { status: 'home' | 'loading' | 'not-found' }
  | { status: 'error'; message: string }
  | { status: 'project'; project: Project; trips: ListState<Trip> }
  | ({ status: 'trip'; trip: Trip } & VisitWorkspace);
export type Snapshot = {
  phase: 'checking' | 'anonymous' | 'unavailable' | 'logging-out' | 'logout-failed';
  route: AppRoute; message: string;
} | {
  phase: 'ready'; route: AppRoute; user: CurrentUser;
  projects: ListState<Project>; scope: ScopeState;
  mutation: { pending: boolean; error?: string }; formVersion: number;
};
const safeMessage = (error: unknown) => error instanceof ApiError ? error.message : 'The request could not be completed. Please retry.';
export function tripCreationHint(project: Project, user: CurrentUser): 'allowed' | 'server-check' {
  // Current DTO has no viewer role. Do not probe the management roster or invent one.
  return project.ownerUserId === user.id || project.tripCreationPolicy === 'all_project_members' ? 'allowed' : 'server-check';
}

// A controller is owned by one mounted application, not a process-wide data cache.
// React consumes its immutable snapshots; all requests use the existing API client.
export class AppController {
  private client: Client;
  private navigation: Navigation;
  private listeners = new Set<() => void>();
  private requests = new Map<string, AbortController>();
  private generation = 0;
  private sessionSeen = false;
  private snapshot: Snapshot;
  constructor(client: Client, navigation: Navigation) {
    this.client = client;
    this.navigation = navigation;
    this.snapshot = { phase: 'checking', route: parseRoute(navigation.read()), message: 'Checking your session…' };
  }
  getSnapshot = (): Snapshot => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(snapshot: Snapshot) { this.snapshot = snapshot; this.listeners.forEach(listener => listener()); }
  private cancel() { this.generation++; this.requests.forEach(request => request.abort()); this.requests.clear(); }
  private request(key: string) {
    this.requests.get(key)?.abort();
    const controller = new AbortController();
    const generation = this.generation;
    this.requests.set(key, controller);
    return { signal: controller.signal, current: () => !controller.signal.aborted && generation === this.generation && this.requests.get(key) === controller };
  }
  suspend = () => {
    // Hides private DOM and discards DTOs before backgrounding/BFCache or recovery.
    this.cancel();
    this.publish({ phase: 'checking', route: this.snapshot.route, message: 'Checking your session…' });
  };
  dispose = () => {
    this.cancel();
    this.snapshot = { phase: 'checking', route: this.snapshot.route, message: 'Checking your session…' };
    this.listeners.clear();
  };
  private fail(error: unknown): boolean {
    if (error instanceof ApiError && error.status === 401) {
      this.sessionSeen = false;
      this.cancel(); this.navigation.go('/app', true);
      this.publish({ phase: 'anonymous', route: { kind: 'home' }, message: 'Your session is no longer valid. Please sign in again.' });
      return true;
    }
    if (!(error instanceof ApiError) || ['network', 'unavailable', 'protocol', 'unexpected'].includes(error.kind)) {
      const route = this.snapshot.route;
      this.cancel(); this.publish({ phase: 'unavailable', route, message: `${safeMessage(error)} Access could not be verified. Your server session may still be active. Please retry.` });
      return true;
    }
    return false;
  }
  verify = async () => {
    this.cancel();
    const route = parseRoute(this.navigation.read());
    this.publish({ phase: 'checking', route, message: 'Checking your session…' });
    const request = this.request('session');
    try {
      const user = await this.client.currentUser({ signal: request.signal });
      if (!request.current()) return;
      this.sessionSeen = true;
      this.publish({ phase: 'ready', route, user, projects: { status: 'loading' }, scope: { status: route.kind === 'home' ? 'home' : route.kind === 'not-found' ? 'not-found' : 'loading' }, mutation: { pending: false }, formVersion: this.generation });
      await Promise.all([this.loadProjects(), this.loadScope()]);
    } catch (error) {
      if (!request.current()) return;
      // Initial anonymous deep links retain their URL solely as a login destination.
      if (error instanceof ApiError && error.status === 401) {
        if (this.sessionSeen) this.fail(error);
        else { this.cancel(); this.publish({ phase: 'anonymous', route, message: 'Sign in to explore your private travel memories.' }); }
      } else if (!this.fail(error)) {
        this.cancel(); this.publish({ phase: 'unavailable', route, message: safeMessage(error) });
      }
    }
  };
  navigate = async (path: string) => {
    this.navigation.go(path);
    // Verify actor again on navigation; never reuse a previous account's list.
    await this.verify();
  };
  loadProjects = async (more = false) => {
    const state = this.snapshot;
    if (state.phase !== 'ready') return;
    const previous = state.projects;
    if (more && (previous.status !== 'ready' || !previous.page.nextCursor || previous.loadingMore)) return;
    const cursor = more && previous.status === 'ready' ? previous.page.nextCursor : null;
    const request = this.request('projects');
    this.publish({ ...state, projects: more && previous.status === 'ready' ? { ...previous, loadingMore: true, message: undefined } : { status: 'loading' } });
    try {
      const page = await this.client.get(paginatedPath('/api/v1/projects', { limit: 25, cursor }), 'ProjectPage', { signal: request.signal });
      if (!request.current() || this.snapshot.phase !== 'ready') return;
      const items = more && previous.status === 'ready' ? merge(previous.page.items, page.items) : page.items;
      this.publish({ ...this.snapshot, projects: { status: 'ready', page: { ...page, items }, loadingMore: false } });
    } catch (error) {
      if (!request.current() || this.fail(error) || this.snapshot.phase !== 'ready') return;
      this.publish({ ...this.snapshot, projects: { status: 'error', message: safeMessage(error) } });
    }
  };
  private loadScope = async () => {
    const state = this.snapshot;
    if (state.phase !== 'ready' || !('id' in state.route)) return;
    const route = state.route, request = this.request('scope');
    try {
      if (route.kind === 'trip') {
        // Critical Guest boundary: Trip and its Visits only; no parent/roster/sibling probe.
        const trip = await this.client.get(`/api/v1/trips/${route.id}`, 'Trip', { signal: request.signal });
        if (request.current() && this.snapshot.phase === 'ready') {
          this.publish({ ...this.snapshot, scope: { status: 'trip', trip, visits: { status: 'loading' }, selection: { status: 'none' }, catalog: { status: 'idle' }, editor: 'closed' } });
          await this.loadVisits();
        }
      } else {
        const project = await this.client.get(`/api/v1/projects/${route.id}`, 'Project', { signal: request.signal });
        const trips = await this.client.get(paginatedPath(`/api/v1/projects/${route.id}/trips`, { limit: 25 }), 'TripPage', { signal: request.signal });
        if (request.current() && this.snapshot.phase === 'ready') this.publish({ ...this.snapshot, scope: { status: 'project', project, trips: { status: 'ready', page: trips, loadingMore: false } } });
      }
    } catch (error) {
      if (!request.current() || this.fail(error) || this.snapshot.phase !== 'ready') return;
      // No stale resource details or stale selector labels after lost authorization.
      this.publish({ ...this.snapshot, scope: { status: 'error', message: safeMessage(error) }, projects: { status: 'loading' }, formVersion: this.snapshot.formVersion + 1 });
      await this.loadProjects();
    }
  };
  private cancelRequest(key: string) { this.requests.get(key)?.abort(); this.requests.delete(key); }
  private tripState(tripId?: string) {
    const state = this.snapshot;
    return state.phase === 'ready' && state.scope.status === 'trip' && (!tripId || state.scope.trip.id === tripId)
      ? { state, scope: state.scope } : null;
  }
  private visitFailure(error: unknown) {
    if (this.fail(error)) return;
    const current = this.tripState();
    if (!current) return;
    for (const key of ['visits', 'visit-detail', 'places', 'mutation']) this.cancelRequest(key);
    this.publish({ ...current.state, scope: { status: 'error', message: safeMessage(error) }, mutation: { pending: false }, formVersion: current.state.formVersion + 1 });
  }
  loadVisits = async (more = false) => {
    const current = this.tripState(); if (!current) return;
    const { state, scope } = current, previous = scope.visits;
    if (more && (previous.status !== 'ready' || previous.loadingMore || !previous.page.nextCursor)) return;
    const request = this.request('visits');
    if (!more) { this.cancelPlaces(); this.cancelRequest('visit-detail'); }
    this.publish({ ...state, scope: { ...scope,
      ...(!more ? { selection: { status: 'none' } as const, editor: 'closed' as const, catalog: { status: 'idle' } as const, saved: undefined } : {}),
      visits: more && previous.status === 'ready' ? { ...previous, loadingMore: true } : { status: 'loading' },
    } });
    try {
      const page = await this.client.get(paginatedPath(`/api/v1/trips/${scope.trip.id}/visits`, { limit: 25, cursor: more && previous.status === 'ready' ? previous.page.nextCursor : null }), 'VisitPage', { signal: request.signal });
      const latest = this.tripState(scope.trip.id);
      if (!request.current() || !latest) return;
      page.items.forEach(visit => assertVisit(visit, scope.trip.id));
      const items = more && previous.status === 'ready' ? merge(previous.page.items, page.items) : page.items;
      this.publish({ ...latest.state, scope: { ...latest.scope, visits: { status: 'ready', page: { ...page, items }, loadingMore: false } } });
    } catch (error) { if (request.current()) this.visitFailure(error); }
  };
  selectVisit = async (id: string) => {
    const current = this.tripState(); if (!current || current.state.mutation.pending) return;
    const { state, scope } = current;
    this.cancelPlaces();
    this.cancelRequest('visit-detail');
    // Do not fetch arbitrary known IDs from another Trip, even for multi-Trip users.
    if (scope.visits.status !== 'ready' || !scope.visits.page.items.some(visit => visit.id === id)) {
      this.publish({ ...state, scope: { ...scope, selection: { status: 'error', message: 'Visit not available in the current Trip list.' }, editor: 'closed', catalog: { status: 'idle' } } });
      return;
    }
    const request = this.request('visit-detail');
    this.publish({ ...state, scope: { ...scope, selection: { status: 'loading' }, editor: 'closed', catalog: { status: 'idle' }, saved: undefined } });
    try {
      const visit = await this.client.get(`/api/v1/visits/${id}`, 'Visit', { signal: request.signal });
      const latest = this.tripState(scope.trip.id);
      if (!request.current() || !latest) return;
      assertVisit(visit, scope.trip.id, id);
      this.publish({ ...latest.state, scope: { ...latest.scope, selection: { status: 'ready', visit } } });
    } catch (error) { if (request.current()) this.visitFailure(error); }
  };
  openVisitEditor = (editor: 'closed' | 'create' | 'edit') => {
    const current = this.tripState(); if (!current || current.state.mutation.pending || editor === 'edit' && current.scope.selection.status !== 'ready') return;
    this.cancelPlaces();
    this.publish({ ...current.state, scope: { ...current.scope, editor, catalog: { status: 'idle' }, saved: undefined }, mutation: { pending: false }, formVersion: current.state.formVersion + 1 });
  };
  cancelPlaces = () => { this.cancelRequest('places'); };
  clearPlaces = () => {
    this.cancelPlaces(); const current = this.tripState();
    if (current) this.publish({ ...current.state, scope: { ...current.scope, catalog: { status: 'idle' } } });
  };
  searchPlaces = async (countryCode: string, query: string, more = false) => {
    const current = this.tripState(); if (!current || current.scope.editor === 'closed') return;
    const { state, scope } = current, previous = scope.catalog;
    if (more && (previous.status !== 'ready' || previous.countryCode !== countryCode || previous.query !== query || !previous.results.page.nextCursor || previous.results.loadingMore)) return;
    const request = this.request('places');
    if (!placeSearch(countryCode, query)) {
      this.publish({ ...state, scope: { ...scope, catalog: { status: 'error', message: 'Use an alpha-3 country code and up to 100 search characters without control characters.' } } }); return;
    }
    this.publish({ ...state, scope: { ...scope, catalog: more && previous.status === 'ready' ? { ...previous, results: { ...previous.results, loadingMore: true } } : { status: 'loading' } } });
    const params = new URLSearchParams({ countryCode });
    if (query) params.set('query', query);
    try {
      const page = await this.client.get(paginatedPath(`/api/v1/places?${params}`, { limit: 25, cursor: more && previous.status === 'ready' ? previous.results.page.nextCursor : null }), 'PlacePage', { signal: request.signal });
      const latest = this.tripState(scope.trip.id); if (!request.current() || !latest) return;
      if (page.items.some(place => place.countryCode !== countryCode)) throw new ApiError('protocol', 'INVALID_RESPONSE');
      const items = more && previous.status === 'ready' ? merge(previous.results.page.items, page.items) : page.items;
      this.publish({ ...latest.state, scope: { ...latest.scope, catalog: { status: 'ready', countryCode, query, results: { status: 'ready', page: { ...page, items }, loadingMore: false } } } });
    } catch (error) {
      if (!request.current() || this.fail(error)) return;
      const latest = this.tripState(scope.trip.id);
      if (latest) this.publish({ ...latest.state, scope: { ...latest.scope, catalog: { status: 'error', message: error instanceof ApiError && error.status === 400 ? 'This country or search is unavailable in the controlled catalog.' : safeMessage(error) } } });
    }
  };
  saveVisit = async (input: VisitCreate) => {
    const current = this.tripState(); if (!current || current.state.mutation.pending || current.scope.editor === 'closed') return;
    const { state, scope } = current;
    const editing = scope.editor === 'edit' && scope.selection.status === 'ready' ? scope.selection.visit : null;
    if (scope.editor === 'edit' && !editing) return;
    const place = scope.catalog.status === 'ready' ? scope.catalog.results.page.items.find(p => p.id === input.placeId) : undefined;
    const selected = place ?? (editing?.placeId === input.placeId ? editing.place : null);
    let body: VisitCreate;
    try {
      const allowed = decodeDto('VisitCreate', { placeId: input.placeId, name: input.name ?? null, date: input.date ?? { mode: 'none', start: null, end: null } });
      if (allowed.date?.mode === 'single' && allowed.date.start !== allowed.date.end) throw new Error();
      const checked = visitForm({ place: selected, name: allowed.name ?? '', mode: allowed.date!.mode, start: allowed.date!.start ?? '', end: allowed.date!.end ?? '' });
      if (!checked.value) throw new Error();
      body = checked.value;
    } catch {
      this.publish({ ...state, mutation: { pending: false, error: 'Select an existing catalog Place and check the Visit name and calendar dates.' } }); return;
    }
    const payload: VisitPatch = editing ? {
      ...(body.placeId !== editing.placeId ? { placeId: body.placeId } : {}),
      ...(body.name !== editing.name ? { name: body.name } : {}),
      ...(body.date!.mode !== editing.date.mode || body.date!.start !== editing.date.start || body.date!.end !== editing.date.end ? { date: body.date } : {}),
    } : body;
    if (!Object.keys(payload).length) {
      this.publish({ ...state, mutation: { pending: false, error: 'Change a Visit field before saving.' } }); return;
    }
    const request = this.request('mutation');
    this.publish({ ...state, mutation: { pending: true } });
    try {
      const visit = await this.client.mutate(editing ? 'PATCH' : 'POST', editing ? `/api/v1/visits/${editing.id}` : `/api/v1/trips/${scope.trip.id}/visits`, payload, { response: 'Visit', signal: request.signal });
      if (!request.current() || !this.tripState(scope.trip.id)) return;
      assertVisit(visit, scope.trip.id, editing?.id);
      await this.loadVisits();
      const latest = this.tripState(scope.trip.id); if (!request.current() || !latest) return;
      this.publish({ ...latest.state, scope: { ...latest.scope, selection: { status: 'ready', visit }, editor: 'closed', saved: editing ? 'Visit updated.' : 'Visit created.' }, mutation: { pending: false }, formVersion: latest.state.formVersion + 1 });
    } catch (error) {
      if (!request.current() || this.fail(error)) return;
      const latest = this.tripState(scope.trip.id); if (!latest) return;
      if (error instanceof ApiError && [403, 404].includes(error.status ?? 0)) this.visitFailure(error);
      else this.publish({ ...latest.state, mutation: { pending: false, error: safeMessage(error) } });
    }
  };
  loadMoreTrips = async () => {
    const state = this.snapshot;
    if (state.phase !== 'ready' || state.scope.status !== 'project' || state.scope.trips.status !== 'ready') return;
    const scope = state.scope, trips = state.scope.trips;
    if (trips.loadingMore || !trips.page.nextCursor) return;
    const request = this.request('scope');
    this.publish({ ...state, scope: { ...scope, trips: { ...trips, loadingMore: true } } });
    try {
      const page = await this.client.get(paginatedPath(`/api/v1/projects/${scope.project.id}/trips`, { limit: 25, cursor: trips.page.nextCursor }), 'TripPage', { signal: request.signal });
      if (request.current() && this.snapshot.phase === 'ready') this.publish({ ...this.snapshot, scope: { ...scope, trips: { status: 'ready', page: { ...page, items: merge(trips.page.items, page.items) }, loadingMore: false } } });
    } catch (error) {
      if (!request.current() || this.fail(error) || this.snapshot.phase !== 'ready') return;
      this.publish({ ...this.snapshot, scope: { status: 'error', message: safeMessage(error) }, formVersion: this.snapshot.formVersion + 1 });
    }
  };
  createProject = async (input: ProjectCreate) => { await this.create('project', input); };
  createTrip = async (input: TripCreate) => { await this.create('trip', input); };
  private async create(kind: 'project' | 'trip', input: ProjectCreate | TripCreate) {
    const state = this.snapshot;
    if (state.phase !== 'ready' || state.mutation.pending || kind === 'trip' && state.scope.status !== 'project') return;
    const request = this.request('mutation');
    this.publish({ ...state, mutation: { pending: true } });
    try {
      // Construct DTOs explicitly: no actor, owner, role, lifecycle or parent body fields.
      const created = kind === 'project'
        ? await this.client.mutate('POST', '/api/v1/projects', { name: input.name, ...('tripCreationPolicy' in input ? { tripCreationPolicy: input.tripCreationPolicy } : {}) }, { response: 'Project', signal: request.signal })
        : await this.client.mutate('POST', `/api/v1/projects/${state.scope.status === 'project' ? state.scope.project.id : ''}/trips`, { name: input.name, ...('description' in input ? { description: input.description } : {}) }, { response: 'Trip', signal: request.signal });
      if (!request.current()) return;
      await this.navigate(`/app/${kind === 'project' ? 'projects' : 'trips'}/${created.id}`);
    } catch (error) {
      if (!request.current() || this.fail(error) || this.snapshot.phase !== 'ready') return;
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        this.publish({ ...this.snapshot, scope: { status: 'error', message: safeMessage(error) }, mutation: { pending: false }, projects: { status: 'loading' }, formVersion: this.snapshot.formVersion + 1 });
        await this.loadProjects();
      } else this.publish({ ...this.snapshot, mutation: { pending: false, error: safeMessage(error) } });
    }
  }
  logout = async () => {
    if (this.snapshot.phase !== 'ready' && this.snapshot.phase !== 'logout-failed') return;
    this.cancel();
    const route = this.snapshot.route;
    this.publish({ phase: 'logging-out', route, message: 'Signing out…' });
    const request = this.request('logout');
    try {
      await this.client.mutate('POST', '/api/v1/auth/logout', undefined, { signal: request.signal });
      if (!request.current()) return;
      this.sessionSeen = false;
      this.cancel(); this.navigation.go('/app', true);
      this.publish({ phase: 'anonymous', route: { kind: 'home' }, message: 'You have signed out.' });
    } catch (error) {
      if (!request.current()) return;
      if (error instanceof ApiError && error.status === 401) { this.fail(error); return; }
      this.cancel();
      this.publish({ phase: 'logout-failed', route, message: 'Sign-out was not confirmed. Your server session may still be active. Private content is hidden; retry sign-out or check your session.' });
    }
  };
}
function merge<T extends { id: string }>(old: ReadonlyArray<T>, next: ReadonlyArray<T>): ReadonlyArray<T> {
  return [...new Map([...old, ...next].map(item => [item.id, item])).values()];
}
function assertVisit(visit: Visit, tripId: string, id?: string) {
  if (visit.tripId !== tripId || id && visit.id !== id || visit.place.id !== visit.placeId) throw new ApiError('protocol', 'INVALID_RESPONSE');
}
