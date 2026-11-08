import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { api } from '../api/client.ts';
import BaseWorldMap from '../features/map/components/BaseWorldMap.tsx';
import { AppController } from './controller.ts';
import { browserNavigation, googleLoginPath, rememberLoginPath, routePath } from './navigation.ts';
import AppView from './AppView.tsx';
import AuthorizedMarkers from '../features/map/components/AuthorizedMarkers.tsx';

export default function PrivateApp() {
  const [navigation] = useState(() => browserNavigation(window));
  const [controller] = useState(() => new AppController(api, navigation));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const channelRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('travel-map.session-change');
    channelRef.current = channel;
    const refresh = () => {
      const phase = controller.getSnapshot().phase;
      if (phase !== 'logging-out' && phase !== 'logout-failed') void controller.verify();
    };
    const hide = () => {
      if (!['logging-out', 'logout-failed'].includes(controller.getSnapshot().phase)) flushSync(controller.suspend);
    };
    const visibility = () => { if (document.visibilityState === 'hidden') hide(); else refresh(); };
    const sessionSignal = () => { hide(); if (document.visibilityState === 'visible') refresh(); };
    const unlisten = navigation.subscribe(refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', visibility);
    channel?.addEventListener('message', sessionSignal);
    void controller.verify();
    return () => {
      unlisten(); window.removeEventListener('focus', refresh); window.removeEventListener('pageshow', refresh);
      window.removeEventListener('pagehide', hide); document.removeEventListener('visibilitychange', visibility);
      channel?.removeEventListener('message', sessionSignal);
      channel?.close(); channelRef.current = null;
      controller.dispose();
    };
  }, [controller, navigation]);
  // No payload/identity/credential is broadcast; peers independently ask /me.
  const actions = {
    navigate: controller.navigate, verify: controller.verify, createProject: controller.createProject,
    createTrip: controller.createTrip, loadProjects: controller.loadProjects, loadMoreTrips: controller.loadMoreTrips,
    loadVisits: controller.loadVisits, selectVisit: controller.selectVisit, openVisitEditor: controller.openVisitEditor,
    searchPlaces: controller.searchPlaces, clearPlaces: controller.clearPlaces, cancelPlaces: controller.cancelPlaces, saveVisit: controller.saveVisit,
    loadMap: controller.loadMap, showMapGroup: controller.showMapGroup, fitMap: controller.fitMap, openMapVisit: controller.openMapVisit,
    showCollaboration: controller.showCollaboration, collaborationCurrent: controller.collaborationCurrent,
    collaborationFailure: controller.collaborationFailure, refreshCollaboration: controller.refreshCollaboration, leaveResource: controller.leaveResource,
    logout: async () => { await controller.logout(); if (controller.getSnapshot().phase === 'anonymous') channelRef.current?.postMessage('invalidate'); },
  };
  const projection = state.phase === 'ready' && state.map.status === 'ready' ? state.map : null;
  const framing = state.phase === 'ready' && (projection || state.route.kind === 'home')
    ? { key: `${state.user.id}:${routePath(state.route)}`, positions: projection?.visits.flatMap(visit => visit.position ? [visit.position] : []) ?? [] } : undefined;
  const privacyReset = ['anonymous', 'unavailable', 'logging-out', 'logout-failed'].includes(state.phase) || state.phase === 'ready' && state.scope.status === 'error';
  const mapHidden = state.phase !== 'ready' || state.scope.status !== 'home' && !projection;
  return <div className="private-root">
    <div className={`map-backdrop${mapHidden ? ' map-hidden' : ''}`} inert={mapHidden} aria-hidden={mapHidden}><BaseWorldMap framing={framing} camera={projection?.camera} privacyReset={privacyReset}>
      {projection && <AuthorizedMarkers visits={projection.visits} selectedIds={projection.selectedVisitId ? [projection.selectedVisitId] : projection.groupIds} select={controller.showMapGroup} />}
    </BaseWorldMap></div>
    <AppView state={state} actions={actions} onLogin={() => {
      try { rememberLoginPath(window.sessionStorage, routePath(state.route)); } catch { /* Optional navigation storage. */ }
      window.location.assign(googleLoginPath);
    }} />
  </div>;
}
