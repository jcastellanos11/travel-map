const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
export type AppRoute = { kind: 'home' } | { kind: 'project' | 'trip'; id: string } | { kind: 'not-found' };
export function parseRoute(path: string): AppRoute {
  if (path === '/app' || path === '/app/') return { kind: 'home' };
  const match = /^\/app\/(projects|trips)\/([^/]+)\/?$/.exec(path);
  if (!match || !uuid.test(match[2])) return { kind: 'not-found' };
  return { kind: match[1] === 'projects' ? 'project' : 'trip', id: match[2].toLowerCase() };
}
export function routePath(route: AppRoute): string {
  return route.kind === 'project' ? `/app/projects/${route.id}`
    : route.kind === 'trip' ? `/app/trips/${route.id}` : '/app';
}
export interface Navigation {
  read(): string;
  go(path: string, replace?: boolean): void;
  subscribe(listener: () => void): () => void;
}
export function browserNavigation(browser: Window): Navigation {
  return {
    read: () => browser.location.pathname,
    go: (path, replace = false) => {
      // No external URLs, credentials, query strings, or private DTOs in history state.
      const target = routePath(parseRoute(path));
      browser.history[replace ? 'replaceState' : 'pushState'](null, '', target);
    },
    subscribe: listener => {
      browser.addEventListener('popstate', listener);
      return () => browser.removeEventListener('popstate', listener);
    },
  };
}
type ReturnStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const returnKey = 'travel-map.login-return';
export const googleLoginPath = '/api/v1/auth/google/start';
// Only a validated navigation path is retained for ten minutes, never identity,
// DTOs, cookies, CSRF, OAuth parameters, invitation fragments or query strings.
export function rememberLoginPath(storage: ReturnStorage, path: string, now = Date.now()): void {
  const route = parseRoute(path);
  try { storage.setItem(returnKey, JSON.stringify({ path: routePath(route), expires: now + 600_000 })); } catch { /* Login still works without return storage. */ }
}
export function consumeLoginPath(storage: ReturnStorage, now = Date.now()): string {
  try {
    const raw = storage.getItem(returnKey);
    storage.removeItem(returnKey);
    const data: unknown = JSON.parse(raw ?? 'null');
    if (data && typeof data === 'object' && 'path' in data && typeof data.path === 'string'
      && 'expires' in data && typeof data.expires === 'number' && data.expires > now && data.expires <= now + 600_000
      && parseRoute(data.path).kind !== 'not-found' && routePath(parseRoute(data.path)) === data.path) return data.path;
  } catch { /* Storage is optional; never trust it as authentication. */ }
  return '/app';
}
