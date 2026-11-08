import { ApiError, paginatedPath } from '../../api/client.ts';
import type { createApiClient } from '../../api/client.ts';
import type { Invitation, InvitationIssued, RosterMember } from '../../api/generated.ts';
import type { Page } from '../../api/contracts.ts';

export interface InviteScope { kind: 'project' | 'trip'; id: string }
export interface CollaborationContext { projectId: string; ownerUserId: string; actorId: string; tripIds: ReadonlyArray<string> }
type List<T> = { status: 'idle' | 'loading' | 'error' } | { status: 'ready'; page: Page<T>; loadingMore: boolean };
export interface CollaborationState {
  members: List<RosterMember>; invitations: List<Invitation>; scope: InviteScope;
  pending: boolean; message?: string;
}
interface Host {
  current(): boolean;
  failure(error: unknown): Promise<void>;
  refresh(message: string): Promise<void>;
}
export type MemberAction = 'promote' | 'demote' | 'remove';
export function memberActions(owner: boolean, actorId: string, member: RosterMember): MemberAction[] {
  if (member.userId === actorId || member.role === 'owner') return [];
  return owner ? [member.role === 'member' ? 'promote' : 'demote', 'remove'] : member.role === 'member' ? ['remove'] : [];
}
// Owned by one explicitly opened Project management panel. No token/URL is ever
// published here. The Host binds every response to the current actor/scope/version.
export class CollaborationController {
  private state: CollaborationState;
  private listeners = new Set<() => void>();
  private requests = new Map<string, AbortController>();
  private disposed = false;
  private client: ReturnType<typeof createApiClient>;
  readonly context: CollaborationContext;
  private host: Host;
  constructor(client: ReturnType<typeof createApiClient>, context: CollaborationContext, host: Host) {
    this.client = client; this.context = context; this.host = host;
    this.state = { members: { status: 'idle' }, invitations: { status: 'idle' }, scope: { kind: 'project', id: context.projectId }, pending: false };
  }
  getSnapshot = () => this.state;
  start = async () => { this.disposed = false; await this.loadMembers(); };
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(state: CollaborationState) { if (!this.disposed && this.host.current()) { this.state = state; this.listeners.forEach(fn => fn()); } }
  private request(key: string) {
    this.requests.get(key)?.abort(); const request = new AbortController(); this.requests.set(key, request);
    return { signal: request.signal, current: () => !this.disposed && !request.signal.aborted && this.host.current() && this.requests.get(key) === request };
  }
  dispose = () => { this.disposed = true; this.requests.forEach(request => request.abort()); this.requests.clear(); this.listeners.clear(); };
  cancelIssue = () => {
    const issue = this.requests.get('issue'); if (!issue) return;
    issue.abort(); this.requests.delete('issue');
    this.publish({ ...this.state, pending: false, message: 'Creation view closed. An in-flight issuance may have completed. Refresh invitation metadata; no automatic retry was made.' });
  };
  private async failed(error: unknown) {
    const message = error instanceof ApiError ? error.message : 'The request could not be completed.';
    this.publish({ ...this.state, pending: false, message: `${message} Refresh authoritative data before trying again. No automatic retry was made.` });
    if (!(error instanceof ApiError) || ['network', 'protocol', 'unavailable', 'unexpected'].includes(error.kind) || [401, 403, 404].includes(error.status ?? 0)) {
      this.requests.forEach(request => request.abort());
      this.publish({ ...this.state, members: { status: 'error' }, invitations: { status: 'error' } });
      await this.host.failure(error);
    }
  }
  loadMembers = async (more = false) => {
    if (!this.host.current() || this.disposed || this.state.pending) return;
    const previous = this.state.members;
    if (more && (previous.status !== 'ready' || !previous.page.nextCursor || previous.loadingMore)) return;
    const request = this.request('members');
    this.publish({ ...this.state, message: undefined, members: more && previous.status === 'ready' ? { ...previous, loadingMore: true } : { status: 'loading' },
      ...(!more ? { invitations: { status: 'idle' } as const } : {}) });
    try {
      const page = await this.client.get(paginatedPath(`/api/v1/projects/${this.context.projectId}/members`, { limit: 25, cursor: more && previous.status === 'ready' ? previous.page.nextCursor : null }), 'RosterMemberPage', { signal: request.signal });
      if (!request.current()) return;
      if (page.items.some(row => (row.role === 'owner') !== (row.userId === this.context.ownerUserId))) throw new ApiError('protocol', 'INVALID_RESPONSE');
      const items = more && previous.status === 'ready' ? [...new Map([...previous.page.items, ...page.items].map(row => [row.userId, row])).values()] : page.items;
      this.publish({ ...this.state, members: { status: 'ready', page: { ...page, items }, loadingMore: false } });
      if (!more) await this.loadInvitations();
    } catch (error) { if (request.current()) { this.publish({ ...this.state, members: { status: 'error' } }); await this.failed(error); } }
  };
  private allowedScope(scope: InviteScope) { return scope.kind === 'project' ? scope.id === this.context.projectId : this.context.tripIds.includes(scope.id); }
  chooseScope = async (scope: InviteScope) => {
    if (this.disposed || this.state.pending || !this.allowedScope(scope) || !this.host.current()) return;
    this.publish({ ...this.state, scope, invitations: { status: 'idle' }, message: undefined });
    await this.loadInvitations();
  };
  loadInvitations = async (more = false) => {
    if (this.disposed || !this.host.current() || this.state.pending || this.state.members.status !== 'ready') return;
    const previous = this.state.invitations, scope = this.state.scope;
    if (more && (previous.status !== 'ready' || previous.loadingMore || !previous.page.nextCursor)) return;
    const request = this.request('invitations');
    this.publish({ ...this.state, message: undefined, invitations: more && previous.status === 'ready' ? { ...previous, loadingMore: true } : { status: 'loading' } });
    try {
      const page = await this.client.get(paginatedPath(`/api/v1/${scope.kind === 'project' ? 'projects' : 'trips'}/${scope.id}/invitations`, { limit: 25, cursor: more && previous.status === 'ready' ? previous.page.nextCursor : null }), 'InvitationPage', { signal: request.signal });
      if (!request.current()) return;
      if (page.items.some(row => scope.kind === 'trip' ? row.scopeType !== 'trip' || row.scopeId !== scope.id : row.scopeType === 'project' && row.scopeId !== scope.id)) throw new ApiError('protocol', 'INVALID_RESPONSE');
      const items = more && previous.status === 'ready' ? [...new Map([...previous.page.items, ...page.items].map(row => [row.id, row])).values()] : page.items;
      this.publish({ ...this.state, invitations: { status: 'ready', page: { ...page, items }, loadingMore: false } });
    } catch (error) { if (request.current()) { this.publish({ ...this.state, invitations: { status: 'error' } }); await this.failed(error); } }
  };
  changeMember = async (action: MemberAction, userId: string) => {
    if (this.disposed || this.state.pending || !this.host.current() || this.state.members.status !== 'ready') return;
    const target = this.state.members.page.items.find(row => row.userId === userId);
    if (!target || !memberActions(this.context.ownerUserId === this.context.actorId, this.context.actorId, target).includes(action)) return;
    const request = this.request('action'); this.publish({ ...this.state, pending: true, message: undefined });
    const suffix = action === 'remove' ? '' : action === 'promote' ? '/promote-admin' : '/remove-admin';
    try {
      await this.client.mutate(action === 'remove' ? 'DELETE' : 'POST', `/api/v1/projects/${this.context.projectId}/members/${target.userId}${suffix}`, undefined, { signal: request.signal });
      if (!request.current()) return;
      // Revalidate actor/scope, cancel all old map/Visit/panel reads, then reopen
      // the explicitly requested management panel with a fresh roster.
      this.publish({ ...this.state, pending: false, members: { status: 'idle' }, invitations: { status: 'idle' } });
      await this.host.refresh('Membership change confirmed. Management data reloaded.');
    } catch (error) { if (request.current()) await this.failed(error); }
  };
  removeGuest = async (userId: string) => {
    const scope = this.state.scope;
    if (this.disposed || this.state.pending || !this.host.current() || this.state.members.status !== 'ready'
      || scope.kind !== 'trip' || !this.allowedScope(scope) || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(userId)) return;
    const request = this.request('action'); this.publish({ ...this.state, pending: true, message: undefined });
    try {
      await this.client.mutate('DELETE', `/api/v1/trips/${scope.id}/members/${userId}`, undefined, { signal: request.signal });
      if (!request.current()) return;
      this.publish({ ...this.state, pending: false, members: { status: 'idle' }, invitations: { status: 'idle' } });
      await this.host.refresh('Explicit Trip grant revocation confirmed. Inherited Project access is unaffected.');
    } catch (error) { if (request.current()) await this.failed(error); }
  };
  issue = async (): Promise<InvitationIssued | undefined> => {
    if (this.disposed || this.state.pending || !this.host.current() || this.state.members.status !== 'ready') return;
    const scope = this.state.scope; if (!this.allowedScope(scope)) return;
    const request = this.request('issue'); this.publish({ ...this.state, pending: true, message: undefined });
    try {
      const result = await this.client.mutate('POST', `/api/v1/${scope.kind === 'project' ? 'projects' : 'trips'}/${scope.id}/invitations`, undefined, { response: 'InvitationIssued', signal: request.signal });
      if (!request.current()) return;
      if (result.scopeType !== scope.kind || result.scopeId !== scope.id || result.status !== 'pending') throw new ApiError('protocol', 'INVALID_RESPONSE');
      this.requests.delete('issue');
      this.publish({ ...this.state, pending: false });
      void this.loadInvitations();
      return result; // Immediate caller only; never retained in the controller.
    } catch (error) { if (request.current()) { this.requests.delete('issue'); await this.failed(error); } }
  };
  revoke = async (id: string) => {
    if (this.disposed || this.state.pending || !this.host.current() || this.state.invitations.status !== 'ready') return;
    const target = this.state.invitations.page.items.find(row => row.id === id);
    if (!target || target.status !== 'pending') return;
    const scope = this.state.scope, request = this.request('action'); this.publish({ ...this.state, pending: true, message: undefined });
    try {
      await this.client.mutate('POST', `/api/v1/${scope.kind === 'project' ? 'projects' : 'trips'}/${scope.id}/invitations/${target.id}/revoke`, undefined, { signal: request.signal });
      if (!request.current()) return;
      this.publish({ ...this.state, pending: false }); await this.loadInvitations();
    } catch (error) { if (request.current()) await this.failed(error); }
  };
}

export function invitationLink(value: string, origin: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError('protocol', 'INVALID_RESPONSE'); }
  if (url.origin !== origin || url.protocol !== 'https:' || url.pathname !== '/invite' || url.search || url.username || url.password
    || !/^#[A-Za-z0-9_-]{43}$/.test(url.hash)) throw new ApiError('protocol', 'INVALID_RESPONSE');
  return url.href;
}
