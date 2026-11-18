// All Pulso namespaces use a 60-second window. Cloudflare exposes a decision
// only, so use the full window as a conservative retry interval.
export const clientIp = request => request.headers.get('CF-Connecting-IP') || undefined;

export async function isRateLimited(binding, key) {
 return !!binding && !(await binding.limit({key})).success;
}

export const rateLimitHeaders = {'Retry-After':'60','Cache-Control':'no-store'};
export const rateLimitBody = {code:'RATE_LIMITED'};
