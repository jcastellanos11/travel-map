import pg from '../tools/node_modules/pg/lib/index.js';
import { createHandler } from '../shared/native-handler.mjs';
import { jwtVerify,createRemoteJWKSet } from '../tools/node_modules/jose/dist/webapi/index.js';
let resolver;
let issuer;
export default { fetch: createHandler(async (env) => {
  const client = new pg.Client({ connectionString: env.POC_DATABASE_URL });
  await client.connect();
  const query = (sql,params=[]) => {
    let i=0;
    return client.query(sql.replaceAll('?',()=>`$${++i}`),params);
  };
  return {
    sessionCheck: env.POC_SESSION_CHECK==='true',
    all: async (sql,params=[]) => (await query(sql,params)).rows,
    resolveIdentity: async (authorization) => {
      try {
        if(!env.POC_AUTH_URL || !authorization?.startsWith('Bearer '))return null;
        const expected=env.POC_AUTH_URL+'/auth/v1';
        if(issuer!==expected){issuer=expected;resolver=createRemoteJWKSet(new URL(expected+'/.well-known/jwks.json'));}
        const {payload}=await jwtVerify(authorization.slice(7),resolver,{issuer:expected,audience:'authenticated',algorithms:['ES256']});
        if(env.POC_SESSION_CHECK==='true') {
          const current=await fetch(env.POC_AUTH_URL+'/auth/v1/user',{headers:{Authorization:authorization,apikey:env.POC_ANON_KEY}});
          if(!current.ok || (await current.json()).id!==payload.sub)return null;
        }
        return (await query('SELECT l.actor FROM poc_identity_link l JOIN users u ON u.id=l.actor WHERE l.auth_id=? AND u.active=1',[payload.sub])).rows[0]?.actor??null;
      } catch(error){console.warn(JSON.stringify({poc:'jwt_verifier',code:error.code??error.name}));return null;}
    },
    run: query,
    batch: async (items) => {
      await client.query('BEGIN');
      try { const result=[];for(const [sql,params] of items) result.push(await query(sql,params));await client.query('COMMIT');return result; }
      catch(error){await client.query('ROLLBACK');throw error;}
    },
    close: () => client.end(),
  };
}, 'PostgreSQL') };
