import pg from 'pg';
import { HttpError } from '../shared/http.ts';
import type { VerifiedIdentity } from '../modules/identity/provider.ts';

export type JsonObject = Record<string, unknown>;
export interface IdentityRepository {
  begin(stateDigest: string, rateKey: string): Promise<boolean>;
  consume(stateDigest: string): Promise<boolean>;
  complete(stateDigest: string, identity: VerifiedIdentity, tokenDigest: string, oldDigest: string | null): Promise<boolean>;
  call(tokenDigest: string, action: string, data?: JsonObject): Promise<JsonObject>;
}
export class PostgresRepository implements IdentityRepository {
  readonly url: string;
  constructor(url: string) { this.url=url; }
  async query<T>(text: string, values: unknown[]): Promise<T> {
    const local = ['127.0.0.1','localhost','[::1]'].includes(new URL(this.url).hostname);
    const client = new pg.Client({connectionString:this.url,connectionTimeoutMillis:5000,query_timeout:10_000,
      ssl:local?false:{rejectUnauthorized:true},application_name:'travel-map-api',
      options:'-c statement_timeout=10000 -c lock_timeout=5000',
    });
    try {
      await client.connect();
      const result = await client.query<{result:T}>(text,values);
      if (!result.rows[0]) throw new Error('Empty result');
      return result.rows[0].result;
    } catch { throw new HttpError(503,'DEPENDENCY_UNAVAILABLE','Data service unavailable'); }
    finally { await client.end().catch(()=>{}); }
  }
  begin(state: string, rate: string) { return this.query<boolean>('SELECT travel_map.oauth_begin($1,$2) AS result',[state,rate]); }
  consume(state: string) { return this.query<boolean>('SELECT travel_map.oauth_consume($1) AS result',[state]); }
  complete(state: string, identity: VerifiedIdentity, token: string, old: string | null) {
    return this.query<boolean>('SELECT travel_map.login_complete($1,$2,$3,$4) AS result',[state,JSON.stringify(identity),token,old]);
  }
  async call(token: string, action: string, data: JsonObject = {}): Promise<JsonObject> {
    const result = await this.query<JsonObject>('SELECT travel_map.api_call($1,$2,$3) AS result',[token,action,JSON.stringify(data)]);
    if (result.error === 'SESSION_REQUIRED') throw new HttpError(401,'SESSION_REQUIRED','Authentication required');
    if (result.error) throw new HttpError(404,'RESOURCE_NOT_FOUND','Resource not available');
    return result;
  }
}
