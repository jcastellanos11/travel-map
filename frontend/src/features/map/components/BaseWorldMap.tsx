import { useEffect, useRef, useState } from 'react';
import { GeoJSON, MapContainer } from 'react-leaflet';
import L from 'leaflet';
import type { FeatureCollection } from 'geojson';
// Public geometry presentation only. No Trips, Visits, Photos, API DTOs or demo
// memories. A future authorized marker adapter can be composed separately.
export default function BaseWorldMap() {
  const [countries, setCountries] = useState<FeatureCollection | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const map = useRef<L.Map | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}data/countries.geojson`, { signal: controller.signal, credentials: 'same-origin' });
        if (!response.ok) throw new Error('Geometry unavailable');
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object' || !('type' in data) || data.type !== 'FeatureCollection' || !('features' in data) || !Array.isArray(data.features)) throw new Error('Invalid geometry');
        if (!controller.signal.aborted) { setCountries(data as FeatureCollection); setFailed(false); }
      } catch { if (!controller.signal.aborted) setFailed(true); }
    }
    void load(); return () => controller.abort();
  }, [attempt]);
  return <section className="base-map" aria-label="World map with no Visit markers">
    <MapContainer ref={map} center={[20, 0]} zoom={2} minZoom={1} maxZoom={12} worldCopyJump className="private-world-map" scrollWheelZoom keyboard>
      {countries && <GeoJSON data={countries} style={{ fillColor: '#D8E5DA', fillOpacity: 1, color: '#FFFFFF', weight: 0.8 }} onEachFeature={(feature, layer) => {
        const label = document.createElement('span');
        label.textContent = String(feature.properties?.ADMIN ?? 'Country');
        layer.bindTooltip(label, { sticky: true, direction: 'top', className: 'private-country-tooltip' });
        if (layer instanceof L.Path) {
          layer.on('mouseover', () => layer.setStyle({ fillColor: '#B8D0BE' }));
          layer.on('mouseout', () => layer.setStyle({ fillColor: '#D8E5DA' }));
          layer.on('click', () => { if (layer instanceof L.Polygon) map.current?.flyToBounds(layer.getBounds(), { maxZoom: 6, padding: [24, 24], duration: 0.6 }); });
        }
      }} />}
    </MapContainer>
    {failed && <div className="geometry-notice" role="status">World outline unavailable. Your navigation still works. <button onClick={() => setAttempt(attempt + 1)}>Retry map</button></div>}
  </section>;
}
