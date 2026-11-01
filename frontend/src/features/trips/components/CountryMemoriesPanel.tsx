
import { useState } from 'react';
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
  selectedTripId,
  onBackToCountry,
  onClose,
}: CountryMemoriesPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`memories-panel ${
        collapsed ? 'memories-panel--collapsed' : ''
      }`}
      aria-label={`${countryName} travel memories`}
    >
      <div className="memories-panel__handle-area">
        <button
          type="button"
          className="memories-panel__handle-button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-label={
            collapsed ? 'Expand memories panel' : 'Collapse memories panel'
          }
        >
          <span className="memories-panel__handle" />
        </button>
      </div>

      <div className="memories-panel__header">
        <div className="memories-panel__heading">
          <span className="memories-panel__eyebrow">
            Travel memories
          </span>

          <h2>{countryName}</h2>

          <p>
            {trips.length} {trips.length === 1 ? 'story' : 'stories'}
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

      {selectedTripId && !collapsed && (
        <button
          type="button"
          className="back-to-country"
          onClick={onBackToCountry}
        >
          ← All memories
        </button>
      )}

      <div
        className="memories-panel__content"
        hidden={collapsed}
      >
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
