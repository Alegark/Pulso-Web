import {readBoundedJson} from '../../src/accounts/bounded-body.mjs';
import {clientIp} from './rate-limit.mjs';

export const turnstileOrigin='https://challenges.cloudflare.com';
export function turnstileSiteKey(env) {
 const siteKey=env.PULSO_TURNSTILE_SITE_KEY?.trim();
 return siteKey&&env.PULSO_TURNSTILE_SECRET?.trim()?siteKey:undefined;
}

export async function verifyTurnstile(request,env,action,fetcher,timeoutMs) {
 const token=request.headers.get('X-Pulso-Turnstile');
 if(!token||token.length>2048)return 'TURNSTILE_REQUIRED';
 const body=JSON.stringify({secret:env.PULSO_TURNSTILE_SECRET.trim(),response:token,remoteip:clientIp(request)});
 const signal=AbortSignal.timeout(timeoutMs);
 try {
  // Siteverify consumes tokens. A failed or ambiguous attempt needs a new one.
  const response=await fetcher(turnstileOrigin+'/turnstile/v0/siteverify',{
   method:'POST',headers:{'Content-Type':'application/json'},body,signal,redirect:'error',
  });
  if(!response.ok)return 'TURNSTILE_UNAVAILABLE';
  const result=await readBoundedJson(response,8192,signal);
  if(typeof result?.success!=='boolean'||(result['error-codes']??[]).includes('internal-error'))return 'TURNSTILE_UNAVAILABLE';
  if(!result.success||result.hostname!==new URL(request.url).hostname||result.action!==action)return 'TURNSTILE_INVALID';
  return null;
 }catch{
  return 'TURNSTILE_UNAVAILABLE';
 }
}
