// Minimal server-owned bearer-link continuation, no private resource inspection.
// Token stays in page memory; Google login opens another tab and uses E1 unchanged.
export function invitationLanding(): Response {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const script = `const token=location.hash.slice(1);history.replaceState(null,'','/invite');
const output=document.getElementById('result');
document.getElementById('redeem').onclick=async()=>{try{if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error('Open a valid invitation link.');
const me=await fetch('/api/v1/me',{credentials:'same-origin'});if(!me.ok)throw Error('Sign in using the Google link, then return to this tab.');
const user=await me.json();const response=await fetch('/api/v1/invitations/redeem',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':user.csrfToken},body:JSON.stringify({token})});
if(!response.ok)throw Error(response.status===429?'Please try again later.':'Invitation unavailable or already used.');
const value=await response.json();output.textContent=value.result==='already_has_access'?'You already have access. This invitation has been consumed.':'Access granted. You may close this tab.';
}catch(e){output.textContent=e.message;}};`;
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Travel Map invitation</title><h1>Travel Map invitation</h1><p>Sign in with Google in the new tab, then return here and accept. Refreshing loses this invitation; reopen the original link if needed.</p><a href="/api/v1/auth/google/start" target="_blank" rel="noopener noreferrer">Sign in with Google</a><p><button id="redeem">Accept invitation</button></p><p id="result" role="status"></p><script nonce="${nonce}">${script}</script></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` } });
}
