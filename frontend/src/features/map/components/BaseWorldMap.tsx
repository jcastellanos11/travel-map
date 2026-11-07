import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GeoJSON, MapContainer } from 'react-leaflet';
import L from 'leaflet';
import type { FeatureCollection } from 'geojson';
import type { ReactNode } from 'react';
import type { LatLngTuple } from 'leaflet';
import type { MapCamera } from '../../../private/map/model.ts';
// Public geometry and reusable camera/presentation. Authorized layers are supplied
// by the private entry; this component never imports demo Trips or API DTOs.
export default function BaseWorldMap({ children, framing, camera, privacyReset = false }: {
  children?: ReactNode; framing?: { key: string; positions: ReadonlyArray<LatLngTuple> };
  camera?: MapCamera; privacyReset?: boolean;
}) {
  const [countries, setCountries] = useState<FeatureCollection | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const map = useRef<L.Map | null>(null);
  const framed = useRef<string | null>(null);
  const focused = useRef(0);
  const reset = useRef(false);
  useLayoutEffect(() => {
    if (!map.current) return;
    if (privacyReset) {
      if (!reset.current) map.current.setView([20, 0], 2, { animate: false });
      reset.current = true; framed.current = null; return;
    }
    reset.current = false;
    const padding = () => window.matchMedia('(max-width: 480px)').matches
      ? { paddingTopLeft: L.point(24, 100), paddingBottomRight: L.point(24, Math.round(window.innerHeight * 0.57)) }
      : { paddingTopLeft: L.point(24, 120), paddingBottomRight: L.point(400, 24) };
    const fit = () => { if (framing?.positions.length) map.current?.fitBounds(L.latLngBounds([...framing.positions]), { ...padding(), maxZoom: 7, animate: false }); };
    if (framing && framing.key !== framed.current) {
      framed.current = framing.key;
      if (framing.positions.length) fit(); else map.current.setView([20, 0], 2, { animate: false });
    }
    if (camera && camera.sequence !== focused.current) {
      focused.current = camera.sequence;
      if (camera.kind === 'fit') fit();
      else if (camera.position) map.current.flyToBounds(L.latLngBounds([camera.position]), { ...padding(), maxZoom: 8, animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches, duration: 0.6 });
    }
  }, [framing, camera, privacyReset]);
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
  return <section className="base-map" aria-label="World map with approximate catalog Visit locations">
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
      {children}
    </MapContainer>
    {failed && <div className="geometry-notice" role="status">World outline unavailable. Your navigation still works. <button onClick={() => setAttempt(attempt + 1)}>Retry map</button></div>}
  </section>;
}
