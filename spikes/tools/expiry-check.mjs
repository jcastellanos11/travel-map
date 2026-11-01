import {readFileSync,writeFileSync} from 'node:fs';
import {jwtVerify,createRemoteJWKSet} from 'jose';
let stack;for(const line of readFileSync(new URL('../runs/supabase-native-start.log',import.meta.url),'utf8').split('\n')){try{const x=JSON.parse(line);if(x.env)stack=x;}catch{}}
const identities=JSON.parse(readFileSync(new URL('../runs/private/supabase-test-identities.json',import.meta.url),'utf8'));
const issuer=stack.env.API_URL+'/auth/v1';const resolver=createRemoteJWKSet(new URL(issuer+'/.well-known/jwks.json'));
await jwtVerify(identities.guest.access,resolver,{issuer,audience:'authenticated'});
let code;
try{await jwtVerify(identities.guest.access,resolver,{issuer,audience:'authenticated',currentDate:new Date(Date.now()+7200_000)});}catch(error){code=error.code;}
const report={scope:'LOCAL JWT signature verified, then expiry enforced with injected verifier clock; no real waiting or cloud',validNow:true,expiredRejected:code==='ERR_JWT_EXPIRED',errorCode:code};
writeFileSync(new URL('../evidence/native/jwt-expiry.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.expiredRejected)process.exitCode=1;
