import { GoTrueClient } from '@supabase/auth-js';
import type { User } from '@supabase/auth-js';
import type { IdentityConfig } from '../../env.ts';
import { HttpError } from '../../shared/http.ts';
import type { OAuthState } from './security.ts';

export interface VerifiedIdentity { id: string; displayName: string; email: string }
export interface IdentityProvider {
  begin(redirectTo: string): Promise<{url: string; storage: Record<string,string>; flowId: string}>;
  complete(code: string, state: OAuthState): Promise<VerifiedIdentity>;
}

export function googleIdentity(user: User): VerifiedIdentity {
  // app_metadata is provider-controlled; user_metadata is never a role/provider assertion.
  if (user.is_anonymous || user.app_metadata.provider !== 'google'
    || !user.identities?.some((identity) => identity.provider === 'google')
    || !user.email_confirmed_at || !user.email || !/^[0-9a-f-]{36}$/i.test(user.id)) {
    throw new HttpError(403,'IDENTITY_NOT_ALLOWED','Google identity required');
  }
  const name = typeof user.user_metadata.full_name === 'string' ? user.user_metadata.full_name.trim() : '';
  return {id:user.id,displayName:[...name].slice(0,200).join('') || 'Traveler',email:user.email};
}

export class SupabaseIdentityProvider implements IdentityProvider {
  readonly config: IdentityConfig;
  readonly fetcher: typeof fetch;
  constructor(config: IdentityConfig, fetcher: typeof fetch = fetch) { this.config=config; this.fetcher=fetcher.bind(globalThis); }
  client(values: Record<string,string>): GoTrueClient {
    return new GoTrueClient({
      url:`${this.config.supabaseUrl}/auth/v1`, headers:{apikey:this.config.supabaseKey},
      storageKey:'travel-map-pkce', flowType:'pkce',persistSession:true, autoRefreshToken:false,detectSessionInUrl:false,
      storage:{getItem:(key)=>values[key]??null,setItem:(key,value)=>{values[key]=value;},removeItem:(key)=>{delete values[key];}},
      fetch: (input, init) => this.fetcher(input,{...init,signal:AbortSignal.timeout(8000)}),
    });
  }
  async begin(redirectTo: string) {
    const storage: Record<string,string> = {};
    const {data,error} = await this.client(storage).signInWithOAuth({provider:'google',options:{
      redirectTo,skipBrowserRedirect:true,scopes:'openid email profile',
    }});
    if (error || !data.url || !data.flowId) throw new HttpError(503,'DEPENDENCY_UNAVAILABLE','Identity service unavailable');
    const url = new URL(data.url);
    if (url.origin !== new URL(this.config.supabaseUrl).origin || url.searchParams.get('code_challenge_method')?.toLowerCase() !== 's256') {
      throw new HttpError(503,'DEPENDENCY_UNAVAILABLE','Identity service unavailable');
    }
    return {url:data.url,storage,flowId:data.flowId};
  }
  async complete(code: string, state: OAuthState): Promise<VerifiedIdentity> {
    const client = this.client({...state.storage});
    const {data,error} = await client.exchangeCodeForSession(code,{flowId:state.flowId});
    if (error && (!error.status || error.status>=500 || error.status===429)) {
      throw new HttpError(503,'DEPENDENCY_UNAVAILABLE','Identity service unavailable');
    }
    if (error || !data.session) throw new HttpError(400,'OAUTH_INVALID','Login transaction not valid');
    // Re-fetch authenticated provider identity; never trust callback claims or decode-only JWTs.
    const verified = await client.getUser(data.session.access_token);
    if (verified.error && (!verified.error.status || verified.error.status>=500 || verified.error.status===429)) {
      throw new HttpError(503,'DEPENDENCY_UNAVAILABLE','Identity service unavailable');
    }
    if (verified.error || !verified.data.user) throw new HttpError(400,'OAUTH_INVALID','Login transaction not valid');
    return googleIdentity(verified.data.user);
  }
}
