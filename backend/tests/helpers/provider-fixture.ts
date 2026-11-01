// Synthetic protocol server ONLY in tests. This is not Supabase or Google.
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import type { User } from '@supabase/auth-js';
export function syntheticGoogleUser(): User {
  return {id:randomUUID(),aud:'authenticated',created_at:new Date().toISOString(),email:'synthetic@example.invalid',
    email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'google',providers:['google']},
    identities:[{id:randomUUID(),user_id:randomUUID(),identity_id:randomUUID(),provider:'google'}],
    user_metadata:{full_name:'Synthetic traveler'}} as User;
}
export async function providerFixture() {
  const codes=new Map<string,{challenge:string;user:User}>(); const tokens=new Map<string,User>();
  let exchanges=0;
  const server=createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    const url=new URL(req.url??'/', 'http://localhost');
    if (url.pathname==='/auth/v1/token' && url.searchParams.get('grant_type')==='pkce') {
      const chunks=[]; for await(const part of req) chunks.push(part);
      const data=JSON.parse(Buffer.concat(chunks).toString()) as {auth_code:string;code_verifier:string};
      const entry=codes.get(data.auth_code); codes.delete(data.auth_code); exchanges++;
      if (!entry || createHash('sha256').update(data.code_verifier).digest('base64url')!==entry.challenge) {
        res.writeHead(400); res.end(JSON.stringify({msg:'Invalid synthetic code',error_code:'bad_code_verifier'})); return;
      }
      const token=`synthetic-${randomUUID()}`; tokens.set(token,entry.user);
      res.end(JSON.stringify({access_token:token,refresh_token:'synthetic-unused',expires_in:3600,token_type:'bearer',user:entry.user}));return;
    }
    if (url.pathname==='/auth/v1/user') {
      const user=tokens.get(req.headers.authorization?.replace('Bearer ','')??'');
      if (user) {res.end(JSON.stringify(user));return;}
    }
    res.writeHead(401);res.end(JSON.stringify({msg:'Invalid synthetic identity'}));
  });
  await new Promise<void>((done)=>server.listen(0,'127.0.0.1',done));
  const address=server.address(); if (!address || typeof address==='string') throw new Error('No local fixture port');
  return {url:`http://127.0.0.1:${address.port}`, exchanges:()=>exchanges,
    issue:(authorizationUrl:string,user:User)=>{
      const start=new URL(authorizationUrl); const code=randomUUID();
      codes.set(code,{challenge:start.searchParams.get('code_challenge')??'',user});
      const redirect=new URL(start.searchParams.get('redirect_to')!); redirect.searchParams.set('code',code); return redirect;
    },
    close:()=>new Promise<void>((done,reject)=>server.close((error)=>error?reject(error):done())),
  };
}
