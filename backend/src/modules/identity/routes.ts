import type { IdentityConfig } from '../../env.ts';
import type { IdentityRepository } from '../../infrastructure/postgres.ts';
import { HttpError } from '../../shared/http.ts';
import type { IdentityProvider } from './provider.ts';
import { cookie, digest, equal, OAUTH_COOKIE, openOAuth, randomToken, sealOAuth, SESSION_COOKIE, setCookie, tokenPattern } from './security.ts';
export async function startLogin(request: Request, config: IdentityConfig, repo: IdentityRepository, provider: IdentityProvider): Promise<Response> {
  if (request.headers.get('Sec-Fetch-Site')==='cross-site'
    || (request.headers.has('Origin') && request.headers.get('Origin')!==config.origin)) {
    throw new HttpError(403,'ACTION_FORBIDDEN','Request origin not allowed');
  }
  const state=randomToken(); const redirect=new URL('/api/v1/auth/callback',config.origin); redirect.searchParams.set('state',state);
  if (!await repo.begin(await digest(state),await digest(request.headers.get('CF-Connecting-IP')??'local'))) {
    throw new HttpError(429,'RATE_LIMITED','Please try again later');
  }
  const pending=await provider.begin(redirect.toString());
  const sealed=await sealOAuth({state,storage:pending.storage,flowId:pending.flowId},config.cookieKey);
  return new Response(null,{status:302,headers:{Location:pending.url,'Set-Cookie':setCookie(OAUTH_COOKIE,sealed,600)}});
}
export async function finishLogin(request: Request, config: IdentityConfig, repo: IdentityRepository, provider: IdentityProvider): Promise<Response> {
  const url=new URL(request.url); const raw=cookie(request,OAUTH_COOKIE);
  const states=url.searchParams.getAll('state'); const codes=url.searchParams.getAll('code');
  if (!raw || states.length!==1 || codes.length!==1 || !codes[0] || codes[0].length>2048 || url.searchParams.has('error')) {
    throw new HttpError(400,'OAUTH_INVALID','Login transaction not valid');
  }
  const saved=await openOAuth(raw,config.cookieKey);
  if (!equal(saved.state,states[0]??'')) throw new HttpError(400,'OAUTH_INVALID','Login transaction not valid');
  const stateHash=await digest(saved.state);
  if (!await repo.consume(stateHash)) throw new HttpError(400,'OAUTH_INVALID','Login transaction not valid');
  const identity=await provider.complete(codes[0],saved); const rawSession=randomToken(); const old=cookie(request,SESSION_COOKIE);
  if (!await repo.complete(stateHash,identity,await digest(rawSession),old&&tokenPattern.test(old)?await digest(old):null)) {
    throw new HttpError(403,'IDENTITY_NOT_ALLOWED','Account not available');
  }
  const response=new Response(null,{status:303,headers:{Location:`${config.origin}/`}});
  response.headers.append('Set-Cookie',setCookie(OAUTH_COOKIE,'',0));
  response.headers.append('Set-Cookie',setCookie(SESSION_COOKIE,rawSession,604800));
  return response;
}
