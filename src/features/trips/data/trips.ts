
import type { Trip } from '../types';

export const trips: Trip[] = [
  {
    id: 'ankara-2026',
    title: 'Our new adventure in Ankara',
    countryCode: 'TUR',
    countryName: 'Türkiye',
    city: 'Ankara',
    coordinates: [39.9334, 32.8597],
    startDate: '2026-09-01',
    description:
      'Discovering Ankara, learning about Turkish culture, and building unforgettable memories.',
    photos: [
        {
            id: 'ankara-photo-01',
            url: 'images/turkiye/ankara/photo-01.webp',
            alt: 'Exploring Ankara together',
        },
        {
            id: 'ankara-photo-02',
            url: 'images/turkiye/ankara/photo-02.webp',
            alt: 'Our memories in Ankara',
        },
    ],
  },
  {
    id: 'istanbul-2026',
    title: 'Exploring Istanbul',
    countryCode: 'TUR',
    countryName: 'Türkiye',
    city: 'Istanbul',
    coordinates: [41.0082, 28.9784],
    startDate: '2026-10-01',
    description:
      'Exploring the history, architecture, and energy of Istanbul.',
    photos: [],
  },
  {
    id: 'bogota-2026',
    title: 'Memories from Bogotá',
    countryCode: 'COL',
    countryName: 'Colombia',
    city: 'Bogotá',
    coordinates: [4.711, -74.0721],
    startDate: '2025-10-01',
    description:
      'Donde todo comenzo',
    photos: [
        {
            id: 'bogota-photo-01',
            url: 'images/colombia/bogota/photo-01.webp',
            alt: 'En el Humedal La Conejera, en Suba',
        },
    ],
  },
  {
    id: 'villadeleiva-2026',
    title: 'Memories from Villa de Leyva',
    countryCode: 'COL',
    countryName: 'Colombia',
    city: 'Villa de Leyva',
    coordinates: [5.2667, -73.0667],
    startDate: '2026-01-01',
    description:
      'Fuimos a Villa de Leyva, conocimos el parque pegaplones, el parque mamadas, y el bioparque. ',
    photos: [
        {
            id: 'villadeleyva-photo-01',
            url: 'images/colombia/villadeleyva/photo-01.webp',
            alt: 'Cenando en un lugar desconocido y romantico. Comimos Pizza',
        },
    ],
   
  },
];
