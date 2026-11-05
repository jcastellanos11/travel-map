import { assertEnvironment, identityConfig } from './env.ts';
import type { AppEnv } from './env.ts';
import { PostgresRepository } from './infrastructure/postgres.ts';
import type { IdentityRepository } from './infrastructure/postgres.ts';
import { SupabaseIdentityProvider } from './modules/identity/provider.ts';
import type { IdentityProvider } from './modules/identity/provider.ts';
import { finishLogin, startLogin } from './modules/identity/routes.ts';
import { checkOrigin, cookie, csrf, digest, equal, OAUTH_COOKIE, SESSION_COOKIE, setCookie, tokenPattern } from './modules/identity/security.ts';
import { projectInput, projectPage, projectQuery, uuid } from './modules/projects/validation.ts';
import { geographyRoute } from './modules/geography/routes.ts';
import { collaborationRoute } from './modules/collaboration/routes.ts';
import { invitationRoute } from './modules/invitations/routes.ts';
import { documentationRoute } from './modules/documentation/routes.ts';
import { invitationLanding } from './modules/invitations/landing.ts';
import { tripRoute } from './modules/trips/routes.ts';
import { health } from './modules/system/health.ts';
import { errorResponse, HttpError, secureResponse } from './shared/http.ts';

// Ports support isolated tests; the production entry always uses real adapters.
export interface Dependencies { repository: IdentityRepository; provider: IdentityProvider }
export async function handleRequest(request: Request, env: AppEnv, dependencies?: Dependencies): Promise<Response> {
  const requestId=crypto.randomUUID();
  const url=new URL(request.url); const path=url.pathname;
  let response: Response;
  try {
    assertEnvironment(env);
    const documentation=await documentationRoute(request,env);
    if (documentation) return documentation;
    if (path==='/invite' && request.method==='GET') {
      if (url.search) throw new HttpError(400,'VALIDATION_ERROR','Invalid request');
      response=invitationLanding();
    } else if (path==='/health') {
      if (request.method!=='GET') throw new HttpError(405,'METHOD_NOT_ALLOWED','Method not allowed');
      response=health();
    } else if (path==='/api/v1' || path.startsWith('/api/v1/')) {
      const login=path==='/api/v1/auth/google/start'; const callback=path==='/api/v1/auth/callback';
      const raw=cookie(request,SESSION_COOKIE);
      if (!login && !callback && (!raw || !tokenPattern.test(raw))) {
        throw new HttpError(401,'SESSION_REQUIRED','Authentication required');
      }
      let config;
      try { config=identityConfig(env); } catch { throw new HttpError(503,'DEPENDENCY_UNAVAILABLE','Service not configured'); }
      if (url.origin!==config.origin) throw new HttpError(403,'ACTION_FORBIDDEN','Request origin not allowed');
      const repo=dependencies?.repository??new PostgresRepository(config.databaseUrl);
      const provider=dependencies?.provider??new SupabaseIdentityProvider(config);
      if (login || callback) {
        if (request.method!=='GET') throw new HttpError(405,'METHOD_NOT_ALLOWED','Method not allowed');
        response=login?await startLogin(request,config,repo,provider):await finishLogin(request,config,repo,provider);
      } else {
        const token=raw!; const hash=await digest(token);
        if (!['GET','HEAD','OPTIONS'].includes(request.method)) {
          checkOrigin(request,config.origin);
          if (!equal(request.headers.get('X-CSRF-Token')??'',await csrf(token))) {
            throw new HttpError(403,'ACTION_FORBIDDEN','Request verification failed');
          }
        }
        if (path==='/api/v1/me' && request.method==='GET') {
          response=Response.json({...await repo.call(hash,'me'),csrfToken:await csrf(token)});
        } else if (path==='/api/v1/auth/logout' && request.method==='POST') {
          await repo.call(hash,'logout');
          response=new Response(null,{status:204,headers:{'Set-Cookie':setCookie(SESSION_COOKIE,'',0)}});
        } else if (path==='/api/v1/projects' && request.method==='POST') {
          response=Response.json(await repo.call(hash,'projects.create',await projectInput(request)),{status:201});
        } else if (path==='/api/v1/projects' && request.method==='GET') {
          const {data,limit}=projectQuery(url);
          response=Response.json(projectPage(await repo.call(hash,'projects.list',data),limit));
        } else if (/^\/api\/v1\/projects\/[^/]+$/.test(path) && request.method==='GET') {
          const id=path.split('/').at(-1)??'';
          if (!uuid.test(id)) throw new HttpError(404,'RESOURCE_NOT_FOUND','Resource not available');
          response=Response.json(await repo.call(hash,'projects.get',{id}));
        } else {
          const tripResponse = await tripRoute(request, repo, hash) ?? await geographyRoute(request, repo, hash) ?? await collaborationRoute(request, repo, hash) ?? await invitationRoute(request, repo, hash);
          if (tripResponse) response = tripResponse;
          else {
            await repo.call(hash,'me');
            throw new HttpError(404,'RESOURCE_NOT_FOUND','Resource not available');
          }
        }
      }
    } else throw new HttpError(404,'RESOURCE_NOT_FOUND','Resource not available');
  } catch (error) {
    response=errorResponse(error,requestId);
    if (error instanceof HttpError && error.status===405 && path==='/health') response.headers.set('Allow','GET');
    if (path==='/api/v1/auth/callback') response.headers.append('Set-Cookie',setCookie(OAUTH_COOKIE,'',0));
  }
  const invitationCsp=path==='/invite' && response.status===200 ? response.headers.get('Content-Security-Policy') : null;
  response=secureResponse(response,requestId);
  if (invitationCsp) response.headers.set('Content-Security-Policy',invitationCsp);
  return response;
}
