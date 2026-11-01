import { assertEnvironment } from './env.ts';
import type { AppEnv } from './env.ts';
import { denyUnconfiguredSession } from './modules/identity/boundary.ts';
import { health } from './modules/system/health.ts';
import { errorResponse, HttpError, secureResponse } from './shared/http.ts';

export function handleRequest(request: Request, env: AppEnv): Response {
  // Ignore caller-supplied correlation IDs: do not reflect arbitrary input.
  const requestId = crypto.randomUUID();
  let response: Response;
  try {
    assertEnvironment(env);
    const path = new URL(request.url).pathname;
    if (path === '/health') {
      if (request.method !== 'GET') {
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
      }
      response = health();
    } else if (path === '/api/v1' || path.startsWith('/api/v1/')) {
      denyUnconfiguredSession();
    } else {
      throw new HttpError(404, 'RESOURCE_NOT_FOUND', 'Resource not available');
    }
  } catch (error) {
    response = errorResponse(error, requestId);
    if (error instanceof HttpError && error.status === 405) {
      response.headers.set('Allow', 'GET');
    }
  }
  return secureResponse(response, requestId);
}
