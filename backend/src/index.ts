import { handleRequest } from './app.ts';
import type { AppEnv } from './env.ts';

export default {
  fetch(request: Request, env: AppEnv): Promise<Response> {
    return handleRequest(request, env);
  },
};
