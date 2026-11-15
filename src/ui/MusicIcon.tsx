const paths={search:'M21 21l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',library:'M4 4v16M9 4v16m5-15 5-1 2 15-5 1Z',previous:'M19 4 7 12l12 8ZM4 4v16',next:'M5 4l12 8-12 8ZM20 4v16',plus:'M12 5v14M5 12h14'} as const;
export function MusicIcon({name}:{name:keyof typeof paths}){
 return <svg className="music-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} fill={name==='previous'||name==='next'?'currentColor':'none'}/></svg>;
}
