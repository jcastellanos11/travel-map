// Reference policy only. No HTTP listener, OAuth/JWT verifier, or production adapter.
import { readFileSync } from 'node:fs';

export function fixture() {
  return JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
}

export function makePolicy(data = fixture()) {
  // Deliberately mock session lookup: caller-supplied roles are never consulted.
  const sessions = new Map(data.users.map((id: string) => [`test-session:${id}`, id]));
  function identity(session: string | null) {
    const user = sessions.get(session);
    return user && user !== 'inactive' ? user : null;
  }
  function role(user: string, trip: any) {
    const project = data.projects.find((p: any) => p.id === trip?.project && p.state === 'active');
    if (!project || trip.state !== 'active') return null;
    if (project.owner === user) return 'owner';
    const membership = data.projectMemberships.find((m: any) => m.project === project.id && m.user === user && m.active);
    if (membership) return membership.role;
    return data.tripMemberships.some((m: any) => m.trip === trip.id && m.user === user && m.active) ? 'guest' : null;
  }
  function chain(id: string) {
    const photo = data.photos.find((p: any) => p.id === id);
    const visit = data.visits.find((v: any) => v.id === (photo?.visit ?? id));
    const trip = data.trips.find((t: any) => t.id === (visit?.trip ?? id));
    return { photo, visit, trip };
  }
  function allows(session: string | null, action: string, id: string) {
    const user = identity(session);
    if (!user) return false;
    const project = data.projects.find((p: any) => p.id === id && p.state === 'active');
    if (project) {
      const membership = data.projectMemberships.find((m: any) => m.project === id && m.user === user && m.active);
      const r = project.owner === user ? 'owner' : membership?.role;
      if (['project.overview', 'project.counts'].includes(action)) return Boolean(r);
      if (['project.archive', 'project.manageAdmins', 'project.transfer'].includes(action)) return r === 'owner';
      if (action === 'trip.create') return ['owner', 'admin'].includes(r) || (r === 'member' && project.membersCanCreateTrips);
      return false; // Unresolved/proposed operations are intentionally not implemented.
    }
    const { photo, visit, trip } = chain(id);
    if (!trip || (visit && visit.state !== 'active') || (photo && photo.state !== 'ready')) return false;
    const r = role(user, trip);
    if (!r) return false;
    const admin = ['owner', 'admin'].includes(r);
    if (['trip.read', 'trip.map', 'trip.counts'].includes(action)) return id === trip.id;
    if (['visit.read', 'visit.create', 'photo.upload'].includes(action)) return Boolean(visit);
    if (['visit.edit', 'visit.delete'].includes(action)) return Boolean(visit && (admin || visit.creator === user));
    if (['photo.metadata', 'photo.thumbnail', 'photo.display'].includes(action)) return Boolean(photo);
    if (['photo.original', 'photo.edit', 'photo.trash'].includes(action)) return Boolean(photo && (admin || photo.author === user));
    return false;
  }
  function request(session: string | null, action: string, id: string) {
    // Identical denial body for nonexistent, unauthenticated and out-of-scope IDs.
    return allows(session, action, id) ? { ok: true, id } : { ok: false, error: 'unavailable' };
  }
  function photos(session: string | null, filter: { country?: string; place?: string; trip?: string } = {}) {
    return data.photos.filter((p: any) => {
      if (!allows(session, 'photo.display', p.id)) return false;
      const visit = data.visits.find((v: any) => v.id === p.visit);
      const place = data.places.find((v: any) => v.id === visit.place);
      return (!filter.country || place.country === filter.country)
        && (!filter.place || place.id === filter.place) && (!filter.trip || visit.trip === filter.trip);
    }).map((p: any) => p.id); // Each photo visited once; overlapping memberships do not duplicate rows.
  }
  return { data, allows, request, photos, revokeSession: (id: string) => sessions.delete(id) };
}
