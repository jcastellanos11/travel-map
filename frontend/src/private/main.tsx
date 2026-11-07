import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PrivateApp from './PrivateApp.tsx';
import { consumeLoginPath } from './navigation.ts';
import './style.css';

// Existing OAuth callback redirects to /. Only frontend navigation continues it;
// no provider state, callback parameters or authentication code are touched.
if (window.location.pathname === '/') {
  let target = '/app';
  try { target = consumeLoginPath(window.sessionStorage); } catch { /* Safe landing if storage is disabled. */ }
  window.history.replaceState(null, '', target);
} else {
  // Consume/discard an abandoned continuation rather than reusing it on next login.
  try { consumeLoginPath(window.sessionStorage); } catch { /* Optional navigation storage. */ }
}
createRoot(document.getElementById('root')!).render(<StrictMode><PrivateApp /></StrictMode>);
