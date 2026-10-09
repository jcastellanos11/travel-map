
import { useEffect, useRef, useState } from 'react';
import type { Photo } from '../types';

interface PhotoGalleryProps {
  photos: Photo[];
  title: string;
}

function getPhotoUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

export default function PhotoGallery({
  photos,
  title,
}: PhotoGalleryProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const activePhoto =
    activeIndex === null ? null : photos[activeIndex];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (activeIndex === null) {
      if (dialog.open) dialog.close();
      return;
    }

    if (!dialog.open) dialog.showModal();
  }, [activeIndex]);

  function navigate(direction: -1 | 1) {
    setActiveIndex((current) => {
      if (current === null) return null;

      return (current + direction + photos.length) % photos.length;
    });
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLDialogElement>
  ) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      navigate(1);
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      navigate(-1);
    }
  }

  if (photos.length === 0) return null;

  return (
    <>
      <div className="photo-gallery">
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            type="button"
            className="photo-gallery__item"
            onClick={() => setActiveIndex(index)}
            aria-label={`View photo ${index + 1}: ${photo.alt}`}
          >
            <img
              src={getPhotoUrl(photo.url)}
              alt={photo.alt}
              loading="lazy"
            />
          </button>
        ))}
      </div>

      <dialog
        ref={dialogRef}
        className="photo-viewer"
        aria-label={`${title} photo viewer`}
        onClose={() => setActiveIndex(null)}
        onKeyDown={handleKeyDown}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setActiveIndex(null);
          }
        }}
      >
        {activePhoto && (
          <div className="photo-viewer__content">
            <button
              type="button"
              className="photo-viewer__close"
              onClick={() => setActiveIndex(null)}
              aria-label="Close photo viewer"
            >
              ×
            </button>

            <img
              src={getPhotoUrl(activePhoto.url)}
              alt={activePhoto.alt}
            />

            <div className="photo-viewer__footer">
              <button
                type="button"
                onClick={() => navigate(-1)}
                aria-label="Previous photo"
              >
                ←
              </button>

              <div className="photo-viewer__caption">
                <span>{activePhoto.alt}</span>
                <small>
                  {activeIndex! + 1} / {photos.length}
                </small>
              </div>

              <button
                type="button"
                onClick={() => navigate(1)}
                aria-label="Next photo"
              >
                →
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
