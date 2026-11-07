import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import IntegrationCheck from './IntegrationCheck.tsx';
import './style.css';
if (import.meta.env.MODE !== 'integration') throw new Error('Local integration build required');
createRoot(document.getElementById('root')!).render(<StrictMode><IntegrationCheck /></StrictMode>);
