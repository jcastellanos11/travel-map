import type { MouseEvent } from 'react';
import CreationForms from './CreationForms.tsx';
import { tripCreationHint } from './controller.ts';
import type { AppController, Snapshot } from './controller.ts';
import { googleLoginPath } from './navigation.ts';
import TripVisits from './visits/TripVisits.tsx';
import type { VisitActions } from './visits/TripVisits.tsx';
import MapControls from './map/MapControls.tsx';
import type { MapActions } from './map/MapControls.tsx';
import { LeaveResource, ProjectCollaboration } from './collaboration/Collaboration.tsx';
import type { CollaborationActions } from './collaboration/Collaboration.tsx';

type Actions = Pick<AppController, 'navigate' | 'verify' | 'logout' | 'createProject' | 'createTrip' | 'loadProjects' | 'loadMoreTrips'> & VisitActions & MapActions & CollaborationActions;
export default function AppView({ state, actions, onLogin }: { state: Snapshot; actions: Actions; onLogin(): void }) {
  function link(event: MouseEvent<HTMLAnchorElement>, path: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); void actions.navigate(path);
  }
  if (state.phase !== 'ready') return <main className="access-screen"><section className="access-card"><p className="eyebrow">YOUR WORLD, REMEMBERED</p><h1>Travel Map</h1><p role="status">{state.message}</p>
    {state.phase === 'anonymous' && <a className="primary-action" href={googleLoginPath} onClick={e => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault(); onLogin();
    }}>Continue with Google</a>}
    {state.phase === 'unavailable' && <button onClick={() => void actions.verify()}>Retry session check</button>}
    {state.phase === 'logout-failed' && <div className="action-row"><button onClick={() => void actions.logout()}>Retry sign-out</button><button onClick={() => void actions.verify()}>Check session</button></div>}
    <p className="muted">Private projects. Shared journeys. Every place has a story.</p>
  </section></main>;
  const scope = state.scope;
  const selectedProject = scope.status === 'project' ? scope.project : null;
  const projects = state.projects.status === 'ready' ? state.projects.page.items : [];
  // A separately GET-authorized Project may lie beyond the current list page.
  const options = selectedProject && !projects.some(p => p.id === selectedProject.id) ? [...projects, selectedProject] : projects;
  return <div className="private-app">
    <header className="private-header"><div><a className="brand" href="/app" onClick={e => link(e, '/app')}>Travel Map</a><p>Every place has a story.</p></div>
      <nav aria-label="Account"><button onClick={() => void actions.verify()}>Refresh access</button><button onClick={() => void actions.logout()}>Sign out</button></nav>
    </header>
    <p className="map-note">{state.route.kind === 'home' ? 'Choose a Project or open a Trip. No all-Projects map is shown.' : 'Approximate catalog locations. Marker counts include loaded Visits only.'}</p>
    <main className="private-panel" aria-label="Projects and Trips">
      <h1>Your journeys</h1>
      <label htmlFor="project-selector">Project</label>
      <select id="project-selector" value={selectedProject?.id ?? ''} onChange={e => void actions.navigate(e.target.value ? `/app/projects/${e.target.value}` : '/app')}>
        <option value="">Choose a Project</option>{options.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      {state.projects.status === 'loading' && <p role="status">Loading Projects…</p>}
      {state.projects.status === 'error' && <><p role="alert">{state.projects.message}</p><button onClick={() => void actions.loadProjects()}>Retry Projects</button></>}
      {state.projects.status === 'ready' && <>{!projects.length && <p>You have no Project memberships. Create a Project or open an authorized Trip link.</p>}
        {state.projects.page.nextCursor && <button disabled={state.projects.loadingMore} onClick={() => void actions.loadProjects(true)}>{state.projects.loadingMore ? 'Loading…' : 'Load more Projects'}</button>}</>}
      <CreationForms key={`project-${state.formVersion}`} kind="project" pending={state.mutation.pending} onProject={actions.createProject} onTrip={actions.createTrip} />
      <MapControls state={state.map} actions={actions} trips={scope.status === 'project' && scope.trips.status === 'ready' ? scope.trips.page.items : []} pending={state.mutation.pending} />
      <div className="scope" key={`${state.formVersion}-${state.route.kind}-${'id' in state.route ? state.route.id : ''}`}>
        {scope.status === 'home' && <p>Select a Project, or open a Trip link shared with you.</p>}
        {scope.status === 'loading' && <p role="status">Loading your selection…</p>}
        {scope.status === 'not-found' && <><h2>Page not found</h2><a href="/app" onClick={e => link(e, '/app')}>Return to your map</a></>}
        {scope.status === 'error' && <><p role="alert">{scope.message}</p><button onClick={() => void actions.verify()}>Check access again</button></>}
        {scope.status === 'trip' && <><p className="eyebrow">TRIP</p><h2>{scope.trip.name}</h2>{scope.trip.description && <p className="trip-description">{scope.trip.description}</p>}<p className="muted">Only this Trip’s authorized context is shown here.</p>
          <TripVisits workspace={scope} actions={actions} user={state.user} pending={state.mutation.pending} version={state.formVersion} />
          <LeaveResource kind="trip" pending={state.mutation.pending} leave={actions.leaveResource} /></>}
        {scope.status === 'project' && <><p className="eyebrow">PROJECT</p><h2>{scope.project.name}</h2>
          <h3>Trips</h3>
          {scope.trips.status === 'ready' && <>{!scope.trips.page.items.length && <p>No Trips yet.</p>}<ul className="trip-links">{scope.trips.page.items.map(trip => <li key={trip.id}><a href={`/app/trips/${trip.id}`} onClick={e => link(e, `/app/trips/${trip.id}`)}>{trip.name}</a></li>)}</ul>
            {scope.trips.page.nextCursor && <button disabled={scope.trips.loadingMore} onClick={() => void actions.loadMoreTrips()}>{scope.trips.loadingMore ? 'Loading…' : 'Load more Trips'}</button>}</>}
          <p className="muted">{tripCreationHint(scope.project, state.user) === 'allowed' ? 'You may request a new Trip in this Project.' : 'Only the Owner and Admins may create Trips here. The server checks your current permission when you save.'}</p>
          <CreationForms kind="trip" pending={state.mutation.pending} onProject={actions.createProject} onTrip={actions.createTrip} />
          <ProjectCollaboration project={scope.project} actorId={state.user.id} version={state.formVersion}
            trips={scope.trips.status === 'ready' ? scope.trips.page.items : []} open={Boolean(state.collaborationOpen)} notice={state.collaborationNotice} pending={state.mutation.pending} actions={actions} />
        </>}
      </div>
      {state.mutation.error && <p role="alert">{state.mutation.error}</p>}
      {state.mutation.pending && <p role="status">Saving your request…</p>}
    </main>
  </div>;
}
