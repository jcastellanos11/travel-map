
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
      'Nuestra primera vez juntos en un nuevo Pais',
    photos: [
        {
            id: 'ankara-photo-01',
            url: 'images/turkiye/ankara/photo-01.webp',
            alt: 'Llegando Ankara en Super Tren',
        },
        {
            id: 'ankara-photo-02',
            url: 'images/turkiye/ankara/photo-02.webp',
            alt: 'Primer dia de escuela',
        },
        {
            id: 'ankara-photo-03',
            url: 'images/turkiye/ankara/photo-03.webp',
            alt: 'Salida a un parque lindo',
        },
    ],
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
        {
            id: 'bogota-photo-02',
            url: 'images/colombia/bogota/photo-02.webp',
            alt: 'En la fiesta donde nos volvimos a enredar',
        },
        {
            id: 'bogota-photo-03',
            url: 'images/colombia/bogota/photo-03.webp',
            alt: 'Nuestro Primer Aniversario',
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
        {
            id: 'villadeleyva-photo-02',
            url: 'images/colombia/villadeleyva/photo-02.webp',
            alt: 'Museo del chocolate, no era un museo de verdad...',
        },
        {
            id: 'villadeleyva-photo-03',
            url: 'images/colombia/villadeleyva/photo-03.webp',
            alt: 'El parque Mamadas, un lugar para jugar y divertirse.',
        },
    ],
   
  },
  {
    id: 'pereira-2024',
    title: 'Memories from Pereira',
    countryCode: 'COL',
    countryName: 'Colombia',
    city: 'Pereira',
    coordinates: [3.5333, -75.5667],
    startDate: '2024-01-01',
    description:
      'Fuimos a Pereira con amigos, fuimos a varios pueblos del eje cafetero',
    photos: [
        {
            id: 'pereira-photo-01',
            url: 'images/colombia/pereira/pereira-1.webp',
            alt: 'Termales de Santa Rosa de Cabal, hicimos travesuras...',
        },
        {
            id: 'pereira-photo-02',
            url: 'images/colombia/pereira/pereira-2.webp',
            alt: 'Caminamos por un mirador de salento',
        },
        {
            id: 'pereira-photo-03',
            url: 'images/colombia/pereira/pereira-3.webp',
            alt: 'Bosque y rio de salento',
        },
    ],
   
  },
    {
    id: 'Meta-2025',
    title: 'Memories from Meta',
    countryCode: 'COL',
    countryName: 'Colombia',
    city: 'Meta',
    coordinates: [3.3575, -74.0171],
    startDate: '2025-01-01',
    description:
      'Fuimos a Meta al rio guejar',
    photos: [
        {
            id: 'meta-photo-01',
            url: 'images/colombia/meta/meta-1.webp',
            alt: 'Adentro del rio guejar, haciendo rafting',
        },
        {
            id: 'meta-photo-02',
            url: 'images/colombia/meta/meta-2.webp',
            alt: 'En un extraño rio, el agua era rara',
        },
        {
            id: 'meta-photo-03',
            url: 'images/colombia/meta/meta-3.webp',
            alt: 'La cervesita no podia faltar',
        },
    ],
   
  },
];
