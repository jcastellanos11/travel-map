
import { useState } from 'react';

export default function WelcomeModal() {
  const [isOpen, setIsOpen] = useState(true);

  if (!isOpen) return null;

  return (
    <div className="welcome-overlay">
      <div
        className="welcome-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
      >
        <div className="welcome-modal__icon">❤️</div>

        <h2 id="welcome-title">
          Para Aura María
        </h2>

        <p className="welcome-modal__message">
          Este desarrollo está inspirado en los viajes
          que he hecho con la mujer que amo, ¡y espero
          que sean muchos más!
        </p>

        <p className="welcome-modal__dedication">
          ¡Por muchos viajes más a tu lado, Aura María!
        </p>

        <span className="welcome-modal__signature">
          Con todo mi amor, Janer ❤️
        </span>

        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="welcome-modal__button"
        >
          Explorar nuestros recuerdos 🌍
        </button>
      </div>
    </div>
  );
}
