import { useCallback, useSyncExternalStore } from 'react';
import { CircleMarker, Tooltip, useMap } from 'react-leaflet';
import { groupVisits } from '../../../private/map/model.ts';
import type { MapVisit } from '../../../private/map/model.ts';
export default function AuthorizedMarkers({ visits, selectedIds, select }: { visits: ReadonlyArray<MapVisit>; selectedIds: ReadonlyArray<string>; select(ids: ReadonlyArray<string>): void }) {
  const map = useMap();
  const subscribe = useCallback((changed: () => void) => {
    map.on('zoomend', changed); return () => { map.off('zoomend', changed); };
  }, [map]);
  // The external-store snapshot also catches a camera fit between render/commit.
  const zoom = useSyncExternalStore(subscribe, () => map.getZoom());
  const groups = groupVisits(visits, point => map.project(point, zoom), 256 * 2 ** zoom);
  return <>{groups.map(group => {
    const active = group.visits.some(visit => selectedIds.includes(visit.visitId));
    return <CircleMarker key={group.key} center={group.position} radius={group.visits.length > 1 ? 12 : 8} bubblingMouseEvents={false} pathOptions={{ color: '#FFFFFF', weight: active ? 4 : 2, fillColor: active ? '#365F47' : '#B57349', fillOpacity: 1 }} eventHandlers={{ click: () => select(group.visits.map(visit => visit.visitId)) }}>
      <Tooltip permanent={group.visits.length > 1} direction="top" offset={[0, -10]} className="authorized-marker-label">{group.visits.length > 1 ? `${group.visits.length} loaded Visits` : `${group.visits[0].city} · approximate`}</Tooltip>
    </CircleMarker>;
  })}</>;
}
