const cleaners=new Set<()=>void>();
export function registerSearchCacheCleaner(fn:()=>void):()=>void {cleaners.add(fn);return ()=>{cleaners.delete(fn);};}
export function clearSearchCaches():void {for(const clean of cleaners)clean();}
