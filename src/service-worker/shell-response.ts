/** Cached navigations must not retain a followed HTTP redirect. Browsers reject
 * that response for navigation requests with redirect mode "manual". Recreate
 * only redirected, trusted same-origin shell responses; keep every header. */
export function cachedShellResponse(response:Response):Response {
 return response.redirected?new Response(response.body,{status:response.status,statusText:response.statusText,headers:response.headers}):response;
}
