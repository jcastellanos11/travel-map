import { handleRequest } from './app.ts';
import type { AppEnv } from './env.ts';

export default {
  fetch(request: Request, env: AppEnv): Response {
    return handleRequest(request, env);
  },
};
