import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api } from '../../api/client.ts';
import { ApiError } from '../../api/client.ts';
import type { InvitationIssued, Project, Trip } from '../../api/generated.ts';
import type { AppController } from '../controller.ts';
import { CollaborationController, invitationLink, memberActions } from './controller.ts';
import type { CollaborationState, InviteScope, MemberAction } from './controller.ts';
import ConfirmationDialog from './ConfirmationDialog.tsx';

export type CollaborationActions = Pick<AppController, 'showCollaboration' | 'collaborationCurrent' | 'collaborationFailure' | 'refreshCollaboration' | 'leaveResource'>;
export function ProjectCollaboration({ project, actorId, version, trips, open, notice, pending, actions }: {
  project: Project; actorId: string; version: number; trips: ReadonlyArray<Trip>;
  open: boolean; notice?: string; pending: boolean; actions: CollaborationActions;
}) {
  const owner = project.ownerUserId === actorId;
  const authorizedTrips = trips.filter(trip => trip.projectId === project.id);
  return <section className="collaboration" aria-labelledby="project-collaboration-title">
    <h3 id="project-collaboration-title">Collaboration</h3>
    <p className="muted">{owner ? 'Your role: Project Owner.' : 'You have Project access. This response does not identify Admin versus Member.'}</p>
    <p className="muted">Owners and Admins can manage members and invitations. Open management only to perform these tasks; current permission is checked by the server.</p>
    <button disabled={pending} aria-expanded={open} aria-controls="project-management" onClick={() => actions.showCollaboration(!open)}>{open ? 'Close management' : 'Manage members & invitations'}</button>
    {notice && <p role="status">{notice}</p>}
    {open && <ManagementPanel key={`${project.id}:${version}:${authorizedTrips.map(trip => trip.id).join(',')}`} project={project} actorId={actorId} version={version} trips={authorizedTrips} actions={actions} />}
    {owner ? <p className="muted">The Owner cannot leave while retaining ownership. Ownership transfer is not available here.</p>
      : <LeaveResource kind="project" pending={pending} leave={actions.leaveResource} />}
  </section>;
}

type Confirmation = { kind: 'member'; action: MemberAction; id: string; name: string } | { kind: 'revoke'; id: string } | { kind: 'guest_remove'; id: string };
function ManagementPanel({ project, actorId, version, trips, actions }: {
  project: Project; actorId: string; version: number; trips: ReadonlyArray<Trip>; actions: CollaborationActions;
}) {
  const [controller] = useState(() => new CollaborationController(api,
    { projectId: project.id, ownerUserId: project.ownerUserId, actorId, tripIds: trips.map(trip => trip.id) },
    { current: () => actions.collaborationCurrent(actorId, project.id, version), failure: actions.collaborationFailure, refresh: actions.refreshCollaboration }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [creating, setCreating] = useState(false);
  const mounted = useRef(false);
  const createToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => { mounted.current = true; void controller.start(); return () => { mounted.current = false; controller.dispose(); }; }, [controller]);
  async function confirm() {
    if (!confirmation) return;
    setCreating(false);
    if (confirmation.kind === 'member') await controller.changeMember(confirmation.action, confirmation.id);
    else if (confirmation.kind === 'guest_remove') await controller.removeGuest(confirmation.id);
    else await controller.revoke(confirmation.id);
    if (mounted.current) setConfirmation(null);
  }
  return <div id="project-management">
    <ManagementView state={state} owner={project.ownerUserId === actorId} actorId={actorId} request={setConfirmation} refresh={controller.loadMembers} loadMembers={() => void controller.loadMembers(true)} />
    {state.members.status === 'ready' && <>
      <h4>Invitations</h4>
      <label htmlFor="invitation-scope">Invitation scope</label>
      <select id="invitation-scope" disabled={state.pending} value={`${state.scope.kind}:${state.scope.id}`} onChange={event => {
        setCreating(false); const [kind, id] = event.target.value.split(':');
        if (kind === 'project' || kind === 'trip') void controller.chooseScope({ kind, id });
      }}><option value={`project:${project.id}`}>Project Member · {project.name}</option>{trips.map(trip => <option key={trip.id} value={`trip:${trip.id}`}>Trip Guest · {trip.name}</option>)}</select>
      <p className="muted">Project listing includes pending invitations for its Trips. Trip choices use loaded authorized Trip pages; load more Trips below if needed.</p>
      <InvitationList state={state} refresh={controller.loadInvitations} more={() => void controller.loadInvitations(true)} revoke={id => { setCreating(false); setConfirmation({ kind: 'revoke', id }); }} />
      <button ref={createToggle} disabled={state.pending} aria-expanded={creating} onClick={() => setCreating(!creating)}>{creating ? 'Close invitation creation' : 'New invitation'}</button>
      {creating && <InvitationCreator key={`${state.scope.kind}:${state.scope.id}`} scope={state.scope} controller={controller} current={() => actions.collaborationCurrent(actorId, project.id, version)} failure={actions.collaborationFailure} close={() => { setCreating(false); createToggle.current?.focus(); }} pending={state.pending} />}
      {state.scope.kind === 'trip' && <GuestRemoval key={state.scope.id} pending={state.pending} request={id => { setCreating(false); setConfirmation({ kind: 'guest_remove', id }); }} />}
    </>}
    {state.pending && <p role="status">Waiting for the server. Do not submit again.</p>}
    {state.message && <p role="alert">{state.message}</p>}
    {confirmation && <ConfirmationDialog pending={state.pending} title={confirmation.kind === 'revoke' ? 'Revoke unused invitation?' : confirmation.kind === 'guest_remove' ? 'Revoke explicit Trip Guest grant?' : confirmation.action === 'remove' ? 'Remove Project participant?' : 'Change Project role?'}
      message={confirmation.kind === 'revoke' ? 'This prevents future redemption if the invitation is still unused. It does not revoke any established membership.'
        : confirmation.kind === 'guest_remove' ? `Revoke the explicit grant for user ${confirmation.id} in Trip ${state.scope.id}? Verify this identifier with the collaborator. No participant directory is available. Contributions remain; inherited Project access is not revoked.`
        : confirmation.action === 'remove' ? `Remove ${confirmation.name} (${confirmation.id})? Their Project membership and all explicit descendant Trip grants will be revoked. Contributions and attribution remain.`
          : `${confirmation.action === 'promote' ? 'Appoint' : 'Remove Admin rights from'} ${confirmation.name} (${confirmation.id})${confirmation.action === 'promote' ? ' as a Project Admin' : ', making them an ordinary Member'}? Only the Owner may make this change.`}
      cancel={() => setConfirmation(null)} confirm={() => void confirm()} />}
  </div>;
}

// Pure projection for focused component tests. Roster is management data, not a
// capability-probing endpoint; render it only after an explicitly opened panel.
export function ManagementView({ state, owner, actorId, request, refresh, loadMembers }: {
  state: CollaborationState; owner: boolean; actorId: string; request(value: Confirmation): void; refresh(): void; loadMembers(): void;
}) {
  const own = state.members.status === 'ready' ? state.members.page.items.find(member => member.userId === actorId) : undefined;
  return <section aria-label="Project member management"><h4>Project members</h4>
    {own && <p>Your roster role: <strong>{own.role === 'owner' ? 'Owner' : own.role === 'admin' ? 'Admin' : 'Member'}</strong>.</p>}
    <p className="muted">Active Project participants only, without emails or a Trip Guest roster. Counts describe loaded rows.</p>
    <button disabled={state.pending} onClick={() => refresh()}>Refresh members & invitations</button>
    {['idle', 'loading'].includes(state.members.status) && <p role="status">Loading authorized management data…</p>}
    {state.members.status === 'error' && <p role="status">Management data unavailable.</p>}
    {state.members.status === 'ready' && <><ul className="membership-list">{state.members.page.items.map(member => <li key={member.userId}><strong>{member.displayName}</strong>{member.userId === actorId && ' (you)'}<span>User: {member.userId}</span><span>{member.role === 'owner' ? 'Owner' : member.role === 'admin' ? 'Admin' : 'Member'}</span>
      <div className="action-row">{memberActions(owner, actorId, member).map(action => <button key={action} disabled={state.pending} aria-label={`${action === 'promote' ? 'Appoint Admin' : action === 'demote' ? 'Demote to Member' : 'Remove participant'}: ${member.displayName} (${member.userId})`} onClick={() => request({ kind: 'member', action, id: member.userId, name: member.displayName })}>{action === 'promote' ? 'Appoint Admin' : action === 'demote' ? 'Demote to Member' : 'Remove'}</button>)}</div>
    </li>)}</ul>{state.members.page.nextCursor && <button disabled={state.pending || state.members.loadingMore} onClick={loadMembers}>{state.members.loadingMore ? 'Loading…' : 'Load more members'}</button>}</>}
  </section>;
}
export function InvitationList({ state, refresh, more, revoke }: { state: CollaborationState; refresh(): void; more(): void; revoke(id: string): void }) {
  return <section aria-label="Invitation management"><button disabled={state.pending} onClick={() => refresh()}>Refresh invitations</button>
    {['idle', 'loading'].includes(state.invitations.status) && <p role="status">Loading invitation metadata…</p>}
    {state.invitations.status === 'error' && <p role="status">Invitation list unavailable. Refresh to retry.</p>}
    {state.invitations.status === 'ready' && <>{!state.invitations.page.items.length && <p>No pending invitations returned. Used, revoked and expired invitations are not listed.</p>}
      <ul className="membership-list">{state.invitations.page.items.map(invite => <li key={invite.id}><strong>{invite.scopeType === 'project' ? 'Project Member' : 'Trip Guest'}</strong><span>Scope: {invite.scopeId}</span><span>Status reported by server: {invite.status}</span><span>Expires: <time dateTime={invite.expiresAt}>{invite.expiresAt}</time></span>
        <p className="muted">Refresh or redemption determines current validity; a listed invitation may already be unavailable.</p>
        {invite.status === 'pending' && <button disabled={state.pending} onClick={() => revoke(invite.id)}>Revoke invitation</button>}</li>)}</ul>
      {state.invitations.page.nextCursor && <button disabled={state.pending || state.invitations.loadingMore} onClick={more}>{state.invitations.loadingMore ? 'Loading…' : 'Load more invitations'}</button>}</>}
  </section>;
}

function InvitationCreator({ scope, controller, current, failure, close, pending }: { scope: InviteScope; controller: CollaborationController; current(): boolean; failure(error: unknown): Promise<void>; close(): void; pending: boolean }) {
  const [issued, setIssued] = useState<InvitationIssued | null>(null);
  const [message, setMessage] = useState('');
  const mounted = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { mounted.current = true; title.current?.focus(); return () => { mounted.current = false; controller.cancelIssue(); }; }, [controller]);
  async function create() {
    setIssued(null); setMessage('');
    const response = await controller.issue();
    if (!mounted.current || !current() || !response) return;
    try { setIssued({ ...response, invitationUrl: invitationLink(response.invitationUrl, window.location.origin) }); }
    catch { await failure(new ApiError('protocol', 'INVALID_RESPONSE')); }
  }
  async function copy() {
    if (!issued) return;
    try { await navigator.clipboard.writeText(issued.invitationUrl); if (mounted.current && current()) setMessage('Sensitive invitation link copied. Share only with the intended collaborator.'); }
    catch { if (mounted.current && current()) setMessage('Copy failed. Select the link below and copy it manually.'); }
  }
  return <section className="invitation-creator" aria-label="Create invitation"><h4 ref={title} tabIndex={-1}>Create {scope.kind === 'project' ? 'Project Member' : 'Trip Guest'} invitation</h4>
    <p className="muted">Single use, valid for seven days from server issuance. No email is sent or recipient email checked: the first authenticated holder can redeem this bearer link. It never grants Admin or Owner rights.</p>
    <form onSubmit={event => { event.preventDefault(); if (!pending) void create(); }}><button disabled={pending || Boolean(issued)} type="submit">Create single-use invitation</button></form>
    {issued && <><label htmlFor="new-invitation-link">Sensitive link — shown only now</label><textarea id="new-invitation-link" readOnly spellCheck={false} autoComplete="off" rows={3} value={issued.invitationUrl} />
      <p>Expires: <time dateTime={issued.expiresAt}>{issued.expiresAt}</time></p><p className="muted">Copy privately before closing. This link cannot be recovered from the invitation list. The recipient opens it, signs in in a separate tab if needed, returns and explicitly accepts. Refreshing that invitation tab loses its secret.</p>
      <p className="muted">The invitation page does not redirect after acceptance. Share this separate app destination if needed: <a href={`/app/${issued.scopeType === 'project' ? 'projects' : 'trips'}/${issued.scopeId}`}>Open invited {issued.scopeType === 'project' ? 'Project' : 'Trip'}</a>. It works only with authorized access; it contains no invitation secret.</p>
      <button type="button" onClick={() => void copy()}>Copy invitation link</button></>}
    <p role="status">{message}</p><button type="button" onClick={() => { setIssued(null); close(); }}>Close and clear link</button>
  </section>;
}

function GuestRemoval({ pending, request }: { pending: boolean; request(id: string): void }) {
  const [userId, setUserId] = useState(''), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  return <details className="creation"><summary>Remove a Trip Guest using a known user ID</summary>
    <p className="muted">No Trip participant directory is provided. Use only a server-issued user ID verified with the collaborator, never an ID inferred from Visit authors. This revokes one explicit grant, not inherited Project access.</p>
    <form noValidate onSubmit={event => { event.preventDefault(); if (pending) return; const value = userId.trim();
      if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)) { setError('Enter the collaborator’s verified user UUID.'); input.current?.focus(); return; }
      setError(''); request(value.toLowerCase());
    }}><label htmlFor="guest-user-id">Verified Guest user ID</label><input ref={input} id="guest-user-id" value={userId} onChange={event => setUserId(event.target.value)} disabled={pending} autoComplete="off" aria-invalid={Boolean(error)} aria-describedby="guest-user-id-help" />
      <small id="guest-user-id-help" role={error ? 'alert' : undefined}>{error || 'Confirm the complete identifier before revocation. No profile lookup is performed.'}</small>
      <button disabled={pending} type="submit">Review Trip Guest removal</button></form>
  </details>;
}

export function LeaveResource({ kind, pending, leave }: { kind: 'project' | 'trip'; pending: boolean; leave(): Promise<void> }) {
  const [confirming, setConfirming] = useState(false), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return <section className="departure" aria-label={`Leave ${kind}`}><p className="muted">{kind === 'trip'
    ? 'This response does not identify explicit Guest versus inherited access. Only an explicit Guest may leave this Trip. Project members inherit access and must leave the Project instead; the server checks.'
    : 'Leaving revokes your Project membership and all explicit grants in its Trips. Authored content and attribution remain.'}</p>
    <button disabled={pending} onClick={() => setConfirming(true)}>{kind === 'trip' ? 'Request Trip departure (Guest only)' : 'Leave Project'}</button>
    {confirming && <ConfirmationDialog title={kind === 'trip' ? 'Leave this Trip?' : 'Leave this Project?'} pending={pending} message={kind === 'trip'
      ? 'If you are an explicit Trip-only Guest, your grant will be revoked. Your contributions remain. Inherited Project access cannot be suppressed here.'
      : 'Your Project membership and every explicit descendant Trip grant will be revoked. Contributions remain with their creators. You cannot reopen the content without new authorization.'}
      cancel={() => setConfirming(false)} confirm={() => { void leave().then(() => { if (mounted.current) setConfirming(false); }); }} />}
  </section>;
}
