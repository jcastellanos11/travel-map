import { useEffect, useState } from 'react';
import L from 'leaflet';
import { GeoJSON, useMap } from 'react-leaflet';
import { loadLocalBoundaries } from '../data/localBoundaries';
import type { LocalBoundaries as BoundaryData } from '../data/localBoundaries';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: BoundaryData }
  | { status: 'empty' | 'error' };

export default function LocalBoundaries({ countryCode }: { countryCode: string }) {
  const map = useMap();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    let disposed = false;

    loadLocalBoundaries(countryCode, controller.signal)
      .then((data) => {
        if (!disposed) setState(data ? { status: 'ready', data } : { status: 'empty' });
      })
      .catch(() => {
        if (!disposed) setState({ status: 'error' });
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [countryCode, attempt]);

  return (
    <>
      {state.status === 'ready' && (
        <GeoJSON
          data={state.data.geometry}
          style={{ color: '#FFFFFF', opacity: 0.65, weight: 0.7, fillColor: '#FFFFFF', fillOpacity: 0 }}
          bubblingMouseEvents={false}
          onEachFeature={(feature, layer) => {
            const label = document.createElement('span');
            label.textContent = String(feature.properties?.shapeName ?? 'Localidad');
            layer.bindTooltip(label, {
              sticky: true, direction: 'top', className: 'local-boundary-tooltip',
            });
            if (!(layer instanceof L.Path)) return;
            layer.on({
              mouseover: () => layer.setStyle({ weight: 1.2, opacity: 1, fillOpacity: 0.14 }),
              mouseout: () => layer.setStyle({ weight: 0.7, opacity: 0.65, fillOpacity: 0 }),
              click: () => {
                if (layer instanceof L.Polygon) {
                  map.flyToBounds(layer.getBounds(), {
                    padding: [40, 40], maxZoom: 11,
                    animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
                  });
                }
              },
            });
          }}
        />
      )}
      <div className="local-boundaries-status">
        <div role="status" aria-live="polite">
          {state.status === 'loading' && 'Cargando límites locales…'}
          {state.status === 'empty' && 'No hay límites locales disponibles para este país.'}
          {state.status === 'error' && 'No se pudieron cargar los límites locales.'}
          {state.status === 'ready' && (
            <>
              <span>Límites locales · Explora cada localidad</span>
            </>
          )}
        </div>
        {state.status === 'error' && (
          <button type="button" onClick={() => {
            setState({ status: 'loading' });
            setAttempt((value) => value + 1);
          }}>Reintentar</button>
        )}
        {state.status === 'ready' && (
          <small title={`${state.data.metadata.boundarySource} · ${state.data.metadata.boundaryLicense}`}>
            <a href="https://www.geoboundaries.org/" target="_blank" rel="noreferrer">geoBoundaries</a>
            <details>
              <summary>Fuente y licencia</summary>
              {state.data.metadata.boundarySource} · {state.data.metadata.boundaryLicense}
            </details>
          </small>
        )}
      </div>
    </>
  );
}
