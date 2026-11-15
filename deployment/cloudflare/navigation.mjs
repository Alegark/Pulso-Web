/** Old version URLs remain immutable for fetch/precache/audits. A user opening
 * or refreshing one gets today's app, rather than reinstalling an obsolete UI. */
export function shellAssetRequest(request){
 const url=new URL(request.url);
 const navigation=request.mode==='navigate'||request.headers.get('Sec-Fetch-Mode')==='navigate'&&request.headers.get('Sec-Fetch-Dest')==='document';
 return navigation&&/^\/releases\/[a-f0-9]{16}(?:\.html)?$/.test(url.pathname)?new Request(new URL('/',url),request):request;
}
