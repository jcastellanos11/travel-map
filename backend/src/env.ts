export interface AppEnv {
  APP_ENV: 'dev' | 'test' | 'prod';
  APP_ORIGIN?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  DATABASE_URL?: string;
  OAUTH_COOKIE_KEY?: string;
}

export interface IdentityConfig {
  origin: string;
  supabaseUrl: string;
  supabaseKey: string;
  databaseUrl: string;
  cookieKey: string;
}

export function identityConfig(env: AppEnv): IdentityConfig {
  if (!env.APP_ORIGIN || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY
    || !env.DATABASE_URL || !/^[0-9a-f]{64}$/.test(env.OAUTH_COOKIE_KEY ?? '')) throw new Error('Identity configuration missing');
  const origin = new URL(env.APP_ORIGIN);
  const provider = new URL(env.SUPABASE_URL);
  const database = new URL(env.DATABASE_URL);
  const local = (host: string) => ['127.0.0.1','localhost','[::1]'].includes(host);
  if (origin.origin !== env.APP_ORIGIN || origin.protocol !== 'https:'
    || provider.username || provider.password || provider.search || provider.hash || !['','/'].includes(provider.pathname)
    || (provider.protocol !== 'https:' && !(env.APP_ENV !== 'prod' && provider.protocol === 'http:' && local(provider.hostname)))
    || !['postgres:','postgresql:'].includes(database.protocol) || database.search || database.hash
    || (env.APP_ENV === 'prod' && (local(origin.hostname) || local(provider.hostname) || local(database.hostname)))) {
    throw new Error('Identity configuration invalid');
  }
  return {origin:origin.origin,supabaseUrl:provider.origin,supabaseKey:env.SUPABASE_PUBLISHABLE_KEY,
    databaseUrl:database.toString(),cookieKey:env.OAUTH_COOKIE_KEY!};
}

export function assertEnvironment(env: AppEnv): void {
  if (!['dev', 'test', 'prod'].includes(env.APP_ENV)) {
    throw new Error('Invalid application environment');
  }
}
