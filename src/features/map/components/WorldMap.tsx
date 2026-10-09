
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { GeoJSON, MapContainer } from 'react-leaflet';
import type { FeatureCollection } from 'geojson';
import type { PathOptions } from 'leaflet';

import { trips } from '../../trips/data/trips';
import CountryMemoriesPanel from '../../trips/components/CountryMemoriesPanel';

const MAP_COLORS = {
  ocean: '#EAF2F4',
  land: '#D8E5DA',
  visited: '#A5C8AE',
  hover: '#B8D0BE',
  selected: '#6F9F80',
  border: '#FFFFFF',
};

const defaultStyle: PathOptions = {
  fillOpacity: 1,
  color: MAP_COLORS.border,
  weight: 0.8,
};

const visitedCountries = new Set(
  trips.map((trip) => trip.countryCode)
);

export default function WorldMap() {
  const [countries, setCountries] =
    useState<FeatureCollection | null>(null);

  const [selectedCountry, setSelectedCountry] = useState<{
    code: string;
    name: string;
  } | null>(null);

  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCountries() {
      try {
        const response = await fetch(
          `${import.meta.env.BASE_URL}data/countries.geojson`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error('Failed to load countries');
        }

        const data: FeatureCollection = await response.json();
        setCountries(data);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('Error loading map:', error);
        }
      }
    }

    void loadCountries();

    return () => controller.abort();
  }, []);

  const selectedTrips = selectedCountry
    ? trips.filter(
        (trip) => trip.countryCode === selectedCountry.code
      )
    : [];

  function handleClose() {
    setSelectedCountry(null);

    mapRef.current?.flyTo([20, 0], 2, {
      duration: 1.2,
    });
  }

  function getCountryStyle(
    countryCode: string
  ): PathOptions {
    let fillColor = visitedCountries.has(countryCode)
      ? MAP_COLORS.visited
      : MAP_COLORS.land;

    if (selectedCountry?.code === countryCode) {
      fillColor = MAP_COLORS.selected;
    }

    return {
      ...defaultStyle,
      fillColor,
    };
  }

  return (
    <div className="map-page">
      <header className="map-header">
        <h1>Travel Map</h1>
        <p>Every place has a story.</p>
      </header>

      <MapContainer
        ref={mapRef}
        center={[20, 0]}
        zoom={2}
        minZoom={2}
        maxZoom={8}
        zoomControl={false}
        worldCopyJump
        className="world-map"
        style={{ background: MAP_COLORS.ocean }}
      >
        {countries && (
          <GeoJSON
            key={selectedCountry?.code ?? 'world'}
            data={countries}
            style={(feature) => {
              const countryCode = String(
                feature?.properties?.ADM0_A3 ?? ''
              );

              return getCountryStyle(countryCode);
            }}
            onEachFeature={(feature, layer) => {
              const countryCode = String(
                feature.properties?.ADM0_A3 ?? ''
              );

              const countryName = String(
                feature.properties?.ADMIN ?? 'Unknown'
              );

              if (!(layer instanceof L.Path)) return;

              layer.on('mouseover', () => {
                if (selectedCountry?.code !== countryCode) {
                  layer.setStyle({
                    fillColor: MAP_COLORS.hover,
                  });
                }
              });

              layer.on('mouseout', () => {
                layer.setStyle(
                  getCountryStyle(countryCode)
                );
              });

              layer.on('click', () => {
                setSelectedCountry({
                  code: countryCode,
                  name: countryName,
                });

                if (layer instanceof L.Polygon) {
                  mapRef.current?.flyToBounds(
                    layer.getBounds(),
                    {
                      padding: [60, 60],
                      maxZoom: 6,
                      duration: 1.2,
                    }
                  );
                }
              });
            }}
          />
        )}
      </MapContainer>

      {selectedCountry && (
        <CountryMemoriesPanel
          countryName={selectedCountry.name}
          trips={selectedTrips}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
