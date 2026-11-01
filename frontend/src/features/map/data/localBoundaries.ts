import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';

interface BoundaryMetadata {
  boundaryType: string;
  boundaryCanonical: string;
  boundarySource: string;
  boundaryLicense: string;
  simplifiedGeometryGeoJSON: string;
}

export interface LocalBoundaries {
  geometry: FeatureCollection<Polygon | MultiPolygon>;
  metadata: BoundaryMetadata;
}

// Keep only a few countries in memory: local geometry can be large.
const cache = new Map<string, LocalBoundaries>();

export async function loadLocalBoundaries(
  countryCode: string,
  signal: AbortSignal,
): Promise<LocalBoundaries | null> {
  const cached = cache.get(countryCode);
  if (cached) return cached;
  if (!/^[A-Z]{3}$/.test(countryCode)) return null;

  const response = await fetch(
    `https://www.geoboundaries.org/api/current/gbOpen/${countryCode}/ALL/`,
    { signal },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('No se pudo consultar la cobertura.');

  const records: unknown = await response.json();
  if (!Array.isArray(records)) return null;
  const available = records.filter((item): item is BoundaryMetadata => (
    item && typeof item.boundaryType === 'string'
    && /^ADM[1-5]$/.test(item.boundaryType)
    && typeof item.boundaryCanonical === 'string'
    && typeof item.simplifiedGeometryGeoJSON === 'string'
  ));
  // ADM2 is not universally municipal (for example, US counties).
  // Prefer a layer explicitly identified as municipalities/cities/communes.
  const metadata = available.find((item) =>
    /municip|commune|communi|cities|township/i.test(item.boundaryCanonical),
  ) ?? available.find((item) => item.boundaryType === 'ADM2');
  if (!metadata) return null;

  const url = new URL(metadata.simplifiedGeometryGeoJSON);
  if (url.protocol !== 'https:') throw new Error('URL de límites no válida.');
  // Use GitHub's raw-content host directly, avoiding its download page.
  if (url.hostname === 'github.com' && url.pathname.includes('/raw/')) {
    url.hostname = 'raw.githubusercontent.com';
    url.pathname = url.pathname.replace('/raw/', '/');
  }
  const geometryResponse = await fetch(url, { signal });
  if (!geometryResponse.ok) throw new Error('No se pudieron descargar los límites.');
  const geometry = await geometryResponse.json();
  if (geometry?.type !== 'FeatureCollection' || !Array.isArray(geometry.features)
    || !geometry.features.length || !geometry.features.every((feature: { type?: string; geometry?: { type?: string } }) =>
      feature?.type === 'Feature' && ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type ?? ''),
    )) {
    throw new Error('La fuente devolvió límites no válidos.');
  }

  const result: LocalBoundaries = { geometry, metadata };
  signal.throwIfAborted();
  if (cache.size >= 3) cache.delete(cache.keys().next().value!);
  cache.set(countryCode, result);
  return result;
}
