
export interface Photo {
  id: string;
  url: string;
  alt: string;
}

export interface Trip {
  id: string;
  title: string;
  countryCode: string;
  countryName: string;
  city: string;
  coordinates: [number, number];
  startDate: string;
  endDate?: string;
  description: string;
  photos: Photo[];
}
