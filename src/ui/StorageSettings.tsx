import {useMemo,useRef,useState,type ReactNode} from 'react';
import type {StorageSummary} from '../library/storage-summary';
import {formatStorageMB} from '../library/storage-format';

export interface DownloadItem {id:string;title:string;artist:string;bytes:number;protected:boolean;action:ReactNode}
export function StorageSettings({summary,items,cacheCopies,canClean,onClean,onCheck,canCheck}:{summary:StorageSummary;items:DownloadItem[];cacheCopies:number;canClean:boolean;onClean:(button:HTMLButtonElement)=>void;onCheck:()=>void;canCheck:boolean}){
 const [managing,setManaging]=useState(false),[query,setQuery]=useState(''),[page,setPage]=useState(0);
 const opener=useRef<HTMLButtonElement>(null),heading=useRef<HTMLHeadingElement>(null);
 const filtered=useMemo(()=>items.filter(item=>`${item.title} ${item.artist}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),[items,query]);
 const pages=Math.max(1,Math.ceil(filtered.length/8)),current=Math.min(page,pages-1);
 function move(next:number){setPage(next);requestAnimationFrame(()=>heading.current?.focus({preventScroll:true}));}
 return <section className="settings-storage settings-group" aria-label="Almacenamiento">
  {managing?<>
   <button className="settings-back" onClick={()=>{setManaging(false);requestAnimationFrame(()=>opener.current?.focus());}}>← Volver al resumen</button>
   <h3 ref={heading} tabIndex={-1}>Tus descargas</h3><p className="settings-note">Quitar una descarga conserva la canción en tus playlists y favoritos.</p>
   <label className="settings-download-search">Buscar una descarga<input type="search" value={query} placeholder="Canción o artista" onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label>
   <p className="settings-note" role="status">{filtered.length} {filtered.length===1?'archivo':'archivos'} · Página {current+1} de {pages}</p>
   <ul className="storage-downloads">{filtered.slice(current*8,current*8+8).map(item=><li key={item.id}><div><strong>{item.title}</strong><span>{item.artist}</span><small>{formatStorageMB(item.bytes)}{item.protected?' · En uso':''}</small></div>{item.action}</li>)}</ul>
   {!filtered.length&&<p>{query?'No hay descargas que coincidan.':'Todavía no hay música descargada en este navegador.'}</p>}
   {pages>1&&<nav className="settings-pagination" aria-label="Páginas de descargas"><button disabled={current===0} onClick={()=>move(current-1)}>Anterior</button><span>{current+1} / {pages}</span><button disabled={current===pages-1} onClick={()=>move(current+1)}>Siguiente</button></nav>}
  </>:<>
   <div className="settings-storage__heading"><div><p className="settings-eyebrow">EN ESTE DISPOSITIVO</p><h3>Almacenamiento</h3></div><span className="settings-storage__count">{items.length} archivos</span></div>
   <p className="settings-storage__total">{formatStorageMB(summary.knownAudioBytes)} <span>de audio</span></p>
   <div className="storage-summary" aria-label="Resumen del almacenamiento"><svg className="storage-summary__segments" viewBox="0 0 100 1" preserveAspectRatio="none" role="img" aria-label={`Descargas ${formatStorageMB(summary.savedAudioBytes)}; caché ${formatStorageMB(summary.cachedAudioBytes)}`}><rect className="storage-summary__saved" width={summary.knownAudioBytes?summary.savedAudioBytes/summary.knownAudioBytes*100:0} height="1"/><rect className="storage-summary__cache" x={summary.knownAudioBytes?summary.savedAudioBytes/summary.knownAudioBytes*100:0} width={summary.knownAudioBytes?summary.cachedAudioBytes/summary.knownAudioBytes*100:0} height="1"/></svg><dl className="settings-storage__metrics"><div><dt>Descargas conservadas</dt><dd>{formatStorageMB(summary.savedAudioBytes)}</dd></div><div><dt>Caché de escucha</dt><dd>{formatStorageMB(summary.cachedAudioBytes)}</dd></div></dl></div>
   <div className="settings-storage__actions"><button ref={opener} onClick={()=>{setManaging(true);requestAnimationFrame(()=>heading.current?.focus());}}>Gestionar descargas</button><button disabled={!canClean||cacheCopies===0} onClick={e=>onClean(e.currentTarget)}>Limpiar caché de escucha</button></div>
   <p className="settings-note">La caché contiene escuchas no guardadas. Se conservan tu biblioteca y los archivos en uso.</p>
   <details className="settings-storage__details"><summary>Espacio del navegador y revisión de archivos</summary><p>{summary.estimatedPercent===null?'El navegador no informa de su cuota disponible.':`${formatStorageMB(summary.estimatedUsage)} usados de ${formatStorageMB(summary.estimatedQuota)} de cuota estimada.`} Esta cuota incluye la app y otros datos; no equivale al espacio libre del teléfono.</p><p>Se cuenta cada archivo una sola vez. La caché de la aplicación Telegram se gestiona por separado.</p><button disabled={!canCheck} onClick={onCheck}>Comprobar archivos locales</button></details>
  </>}
 </section>;
}
