
import type { Trip } from '../types';
import PhotoGallery from './PhotoGallery';

interface CountryMemoriesPanelProps {
  countryName: string;
  trips: Trip[];
  selectedTripId?: string | null;
  onBackToCountry?: () => void;
  onClose: () => void;
}

export default function CountryMemoriesPanel({
  countryName,
  trips,
  onClose,
  selectedTripId,
  onBackToCountry,
}: CountryMemoriesPanelProps) {
  return (
    <aside className="memories-panel">
      <div className="memories-panel__header">
        <div>
          <span className="memories-panel__eyebrow">
            Travel memories
          </span>
          {selectedTripId && (
            <button
                type="button"
                className="back-to-country"
                onClick={onBackToCountry}
            >
                ← All memories
            </button>
          )}
          <h2>{countryName}</h2>
          <p>
            {trips.length === 0
              ? 'No memories added yet.'
              : `${trips.length} ${trips.length === 1 ? 'story' : 'stories'}`}
          </p>
        </div>

        <button
          type="button"
          className="memories-panel__close"
          onClick={onClose}
          aria-label="Close country details"
        >
          ×
        </button>
      </div>

      <div className="memories-panel__content">
        {trips.length === 0 ? (
          <p>There are no travel stories for this country yet.</p>
        ) : (
          trips.map((trip) => (

            <article className="trip-card" key={trip.id}>
                <span className="trip-card__city">
                    {trip.city}
                </span>

                <h3>{trip.title}</h3>

                <time dateTime={trip.startDate}>
                    {trip.startDate}
                </time>

                <p>{trip.description}</p>

                <PhotoGallery
                    photos={trip.photos}
                    title={trip.title}
                />
            </article>

          ))
        )}
      </div>
    </aside>
  );
}
