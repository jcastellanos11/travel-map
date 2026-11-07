import type { CurrentUser } from '../../api/contracts.ts';
import type { AppController } from '../controller.ts';
import type { VisitWorkspace } from './types.ts';
import { dateLabel, placeLabel } from './forms.ts';
import VisitForm from './VisitForm.tsx';
export type VisitActions = Pick<AppController, 'loadVisits' | 'selectVisit' | 'openVisitEditor' | 'searchPlaces' | 'clearPlaces' | 'cancelPlaces' | 'saveVisit'>;
export default function TripVisits({ workspace, actions, user, pending, version }: {
  workspace: VisitWorkspace; actions: VisitActions; user: CurrentUser; pending: boolean; version: number;
}) {
  const selected = workspace.selection.status === 'ready' ? workspace.selection.visit : undefined;
  return <section className="trip-visits" aria-labelledby="trip-visits-title"><h3 id="trip-visits-title">Visits</h3>
    <div className="action-row"><button disabled={pending} onClick={() => actions.openVisitEditor('create')}>New Visit</button><button disabled={pending} onClick={() => void actions.loadVisits()}>Refresh Visits</button></div>
    {workspace.visits.status === 'loading' && <p role="status">Loading Visits…</p>}
    {workspace.visits.status === 'ready' && <>{!workspace.visits.page.items.length && <p>No Visits in this Trip yet.</p>}
      <ul className="visit-list">{workspace.visits.page.items.map(visit => <li key={visit.id}><button disabled={pending} aria-pressed={selected?.id === visit.id} aria-label={`View Visit ${visit.name ?? visit.place.city}, ${dateLabel(visit.date)}, ${visit.id}`} onClick={() => void actions.selectVisit(visit.id)}><strong>{visit.name ?? visit.place.city}</strong><span>{placeLabel(visit.place)}</span><small>{dateLabel(visit.date)}</small></button></li>)}</ul>
      {workspace.visits.page.nextCursor && <button disabled={pending || workspace.visits.loadingMore} onClick={() => void actions.loadVisits(true)}>{workspace.visits.loadingMore ? 'Loading…' : 'Load more Visits'}</button>}</>}
    {workspace.selection.status === 'loading' && <p role="status">Loading Visit details…</p>}
    {workspace.selection.status === 'error' && <p role="alert">{workspace.selection.message}</p>}
    {workspace.saved && <p role="status">{workspace.saved}</p>}
    {selected && <article className="visit-detail" aria-label="Visit details"><h4>{selected.name ?? `Visit to ${selected.place.city}`}</h4><p>{placeLabel(selected.place)}</p><p>{dateLabel(selected.date)}</p>
      <p className="muted">City/region reference only. No exact Visit coordinates are collected or shared.</p>
      {workspace.editor === 'closed' && <button disabled={pending} onClick={() => actions.openVisitEditor('edit')}>{selected.createdByUserId === user.id ? 'Edit Visit' : 'Edit Visit (Owner/Admin only)'}</button>}
    </article>}
    {workspace.editor !== 'closed' && <VisitForm key={`${version}-${workspace.editor}-${workspace.editor === 'edit' ? selected?.id : 'new'}`} initial={workspace.editor === 'edit' ? selected : undefined} catalog={workspace.catalog} actions={actions} pending={pending} onSave={actions.saveVisit} onCancel={() => actions.openVisitEditor('closed')} />}
  </section>;
}
