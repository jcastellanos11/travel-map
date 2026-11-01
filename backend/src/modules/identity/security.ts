import { EncryptJWT, jwtDecrypt } from 'jose';
import { timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../shared/http.ts';

export const SESSION_COOKIE = '__Host-travel-map-session';
export const OAUTH_COOKIE = '__Host-travel-map-oauth';
export const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();

export function randomToken(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}

export async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2,'0')).join('');
}

export function equal(left: string, right: string): boolean {
  const a=encoder.encode(left); const b=encoder.encode(right);
  return a.byteLength===b.byteLength && timingSafeEqual(a,b);
}

export function cookie(request: Request, name: string): string | null {
  const matches = (request.headers.get('Cookie') ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  // Reject ambiguity rather than accept cookie shadowing/fixation.
  if (matches.length !== 1) return null;
  const value = matches[0]?.slice(name.length+1) ?? '';
  return value.length <= 3800 ? value : null;
}

export function setCookie(name: string, value: string, seconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}

export async function csrf(rawSession: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw',encoder.encode(rawSession),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode('travel-map/csrf/v1')))));
}

export function checkOrigin(request: Request, origin: string): void {
  if (request.headers.get('Origin') !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new HttpError(403,'ACTION_FORBIDDEN','Request origin not allowed');
  }
}

export interface OAuthState { state: string; storage: Record<string,string>; flowId: string }
function encryptionKey(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [],(byte) => parseInt(byte,16));
}
export async function sealOAuth(value: OAuthState, key: string): Promise<string> {
  return new EncryptJWT({...value}).setProtectedHeader({alg:'dir',enc:'A256GCM'})
    .setIssuer('travel-map').setAudience('oauth-callback').setIssuedAt().setExpirationTime('10m')
    .encrypt(encryptionKey(key));
}
export async function openOAuth(value: string, key: string): Promise<OAuthState> {
  try {
    const {payload} = await jwtDecrypt(value,encryptionKey(key),{
      issuer:'travel-map',audience:'oauth-callback',requiredClaims:['exp','iat'],maxTokenAge:'10m',keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM'],
    });
    if (typeof payload.state !== 'string' || !tokenPattern.test(payload.state)
      || typeof payload.flowId !== 'string' || !payload.storage || typeof payload.storage !== 'object') throw new Error();
    return {state:payload.state,flowId:payload.flowId,storage:payload.storage as Record<string,string>};
  } catch { throw new HttpError(400,'OAUTH_INVALID','Login transaction not valid'); }
}
