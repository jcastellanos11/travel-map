import { HttpError } from '../../shared/http.ts';

// E0 fail-closed boundary. Never accept mock headers, cookies or provider JWTs.
// E1 replaces this with authoritative opaque-session validation, not a flag.
export function denyUnconfiguredSession(): never {
  throw new HttpError(401, 'SESSION_REQUIRED', 'Authentication required');
}
