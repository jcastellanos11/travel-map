
import { CircleMarker, Tooltip } from 'react-leaflet';
import type { Trip } from '../../trips/types';

interface CityMarkersProps {
  trips: Trip[];
  selectedTripId: string | null;
  onSelectTrip: (trip: Trip) => void;
}

export default function CityMarkers({
  trips,
  selectedTripId,
  onSelectTrip,
}: CityMarkersProps) {
  return (
    <>
      {trips.map((trip) => {
        const isSelected = selectedTripId === trip.id;

        return (
          <CircleMarker
            key={trip.id}
            center={trip.coordinates}
            radius={isSelected ? 12 : 9}
            pathOptions={{
              color: '#FFFFFF',
              weight: 3,
              fillColor: isSelected
                ? '#365F47'
                : '#D18A61',
              fillOpacity: 1,
            }}
            eventHandlers={{
              click: () => onSelectTrip(trip),
            }}
          >
            <Tooltip
              direction="top"
              offset={[0, -12]}
            >
              <strong>{trip.city}</strong>
              <div>{trip.title}</div>
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}

