import { bundle, css } from '../../../.generated/swagger-assets.ts';
import spec from '../../../openapi.json' with { type: 'json' };
import type { AppEnv } from '../../env.ts';
import { HttpError, secureResponse } from '../../shared/http.ts';

const initializer = `/* No credentials, tokens or API responses are persisted. */
(()=>{'use strict';
const sensitive=(path)=>path.startsWith('/api/v1/auth/google/')||path==='/api/v1/auth/callback'||path.includes('/invitations')||path==='/invite';
const permitted=(value)=>{const u=new URL(value,location.origin);if(u.origin!==location.origin||u.hash||u.searchParams.has('token'))throw Error('Same-origin documentation requests only');return u;};
const nativeFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{const request=new Request(input,init);const u=permitted(request.url);
if(sensitive(u.pathname))throw Error('Use the secure browser flow.');
const headers=new Headers(request.headers);
if(!['GET','HEAD'].includes(request.method)){
const response=await nativeFetch('/api/v1/me',{credentials:'same-origin',cache:'no-store'});
if(!response.ok)throw Error('Sign in with Google first.');const me=await response.json();headers.set('X-CSRF-Token',me.csrfToken);
}
const response=await nativeFetch(new Request(request,{headers,credentials:'same-origin'}));
if(u.pathname==='/openapi.json'&&response.ok){const data=await response.json();data.components.parameters.csrf.schema.default='automatic';return new Response(JSON.stringify(data),{status:response.status,headers:{'Content-Type':'application/json'}});}
if(u.pathname==='/api/v1/me'&&response.ok){const data=await response.json();delete data.csrfToken;return new Response(JSON.stringify(data),{status:response.status,headers:{'Content-Type':'application/json'}});}return response;
};
const policy=()=>({wrapComponents:{authorizeBtn:()=>()=>null,authorizeOperationBtn:()=>()=>null},statePlugins:{spec:{wrapSelectors:{allowTryItOutFor:(original)=>(state,path,method)=>!sensitive(path)&&!['/api-docs','/openapi.json'].includes(path)&&original(state,path,method)}}}});
SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',layout:'BaseLayout',validatorUrl:null,
queryConfigEnabled:false,persistAuthorization:false,withCredentials:true,deepLinking:false,showMutatedRequest:false,
requestSnippetsEnabled:false,displayRequestDuration:false,plugins:[policy],
requestInterceptor:(request)=>{const u=permitted(request.url);if(sensitive(u.pathname))throw Error('Use the secure browser flow.');request.credentials='same-origin';return request;}
});})();`;

// Dev AND exact loopback origin. A production environment can never enable this.
export async function documentationRoute(request: Request, env: AppEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!['/api-docs', '/openapi.json', '/api-docs/swagger-ui.js', '/api-docs/swagger-ui.css', '/api-docs/init.js'].includes(url.pathname)) return null;
  if (env.APP_ENV !== 'dev' || url.protocol !== 'https:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || (env.APP_ORIGIN && env.APP_ORIGIN !== url.origin)) throw new HttpError(404, 'RESOURCE_NOT_FOUND', 'Resource not available');
  if (request.method !== 'GET' || url.search) throw new HttpError(404, 'RESOURCE_NOT_FOUND', 'Resource not available');
  let response: Response;
  if (url.pathname === '/openapi.json') response = Response.json(spec);
  else if (url.pathname.endsWith('.js')) response = new Response(url.pathname.endsWith('/init.js') ? initializer : bundle, { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
  else if (url.pathname.endsWith('.css')) response = new Response(css, { headers: { 'Content-Type': 'text/css; charset=utf-8' } });
  else response = new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Travel Map API</title><link rel="stylesheet" href="/api-docs/swagger-ui.css"><body><h1>Travel Map API — local development</h1><p><a href="/api/v1/auth/google/start" target="_blank" rel="noopener noreferrer">Sign in with Google</a>. Return here after login. Mutations persist real local data; use a dedicated test Project. OAuth and invitation token operations are reference-only; use the secure invitation flow.</p><div id="swagger-ui"></div><script src="/api-docs/swagger-ui.js"></script><script src="/api-docs/init.js"></script></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  response = secureResponse(response, crypto.randomUUID());
  response.headers.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  return response;
}
