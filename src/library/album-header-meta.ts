export function formatAlbumHeaderMeta(trackCount:number,discCount:number,downloaded:number,savedAlbum:boolean):string {
 const parts=[`${trackCount} ${trackCount===1?'canción':'canciones'}`];
 if(discCount>1)parts.push(`${discCount} discos`);
 if(savedAlbum||downloaded>0)parts.push(`${downloaded} ${downloaded===1?'descargada':'descargadas'}`);
 return parts.join(' · ');
}
