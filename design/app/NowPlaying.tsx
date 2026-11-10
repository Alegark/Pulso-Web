import {useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {SaveTrackButton} from './SaveTrackButton';
import {demoLyrics,missingLyrics} from './lyrics';

type Mode='player'|'lyrics'|'queue';
const paths={shuffle:'m3 5 4 0c4 0 5 14 10 14h4m-4-4 4 4-4 4M3 19h4c1 0 2-1 3-3M14 8c1-2 2-3 4-3h3m-4-4 4 4-4 4',previous:'m19 4-12 8 12 8ZM4 4v16',next:'m5 4 12 8-12 8ZM20 4v16',repeat:'m18 2 4 4-4 4M2 10V8a2 2 0 0 1 2-2h18M6 22l-4-4 4-4m16 0v2a2 2 0 0 1-2 2H2',play:'m8 4 12 8-12 8Z',pause:'M8 5v14M16 5v14',lyrics:'M4 4h16v12H8l-4 4ZM8 8h8M8 12h6',queue:'M3 5h18M3 12h18M3 19h12'};
function Icon({name}:{name:keyof typeof paths}){return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} fill={['play','previous','next'].includes(name)?'currentColor':'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;}
interface NowPlayingProps {
  requestedView?:Mode;
  open:boolean;trackId:string;title:string;artist:string;album:string;cover:ReactNode;playing:boolean;position:number;saved:boolean;shuffle:boolean;repeat:boolean;
  queue:{id:string;title:string;artist:string}[];
  onToggleSave:()=>void;onPlayPause:()=>void;onSeek:(time:number)=>void;onNext:()=>void;onPrevious:()=>void;onShuffle:()=>void;onRepeat:()=>void;onQueueSelect:(id:string)=>void;
}
export function NowPlaying(props:NowPlayingProps){
  const [mode,setMode]=useState<Mode>('player'),previousMode=useRef<Mode>('player');
  const lyricsButton=useRef<HTMLButtonElement>(null),queueButton=useRef<HTMLButtonElement>(null),viewHeading=useRef<HTMLHeadingElement>(null),scroll=useRef(0),viewOpener=useRef<HTMLElement|null>(null);
  const lyrics=demoLyrics[props.trackId]??missingLyrics;
  const active=lyrics.kind==='timed'?lyrics.lines.reduce((found,line,index)=>(line.time??0)<=props.position?index:found,0):-1;
  useLayoutEffect(()=>{setMode(props.open?(props.requestedView??'player'):'player');},[props.open,props.requestedView]);
  useLayoutEffect(()=>{
    if(!props.open){previousMode.current='player';return;}
    const surface=document.querySelector<HTMLElement>('.player-surface');
    if(mode!=='player'){if(surface)surface.scrollTop=0;viewHeading.current?.focus({preventScroll:true});}
    else if(previousMode.current!=='player'){
      const button=viewOpener.current??(previousMode.current==='lyrics'?lyricsButton.current:queueButton.current);
      if(surface)surface.scrollTop=scroll.current;button?.focus({preventScroll:true});
    }
    previousMode.current=mode;
  },[mode,props.open]);
  function openView(next:Mode){viewOpener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;scroll.current=document.querySelector('.player-surface')?.scrollTop??0;setMode(next);}
  const transport=<div className="expanded-transport">
    <button className="round-button" type="button" aria-label="Reproducción aleatoria" aria-pressed={props.shuffle} onClick={props.onShuffle}><Icon name="shuffle"/></button>
    <button className="round-button" type="button" aria-label="Canción anterior de muestra" onClick={props.onPrevious}><Icon name="previous"/></button>
    <button className="round-button expanded-play" type="button" aria-label={props.playing?'Pausar sonido de prueba':'Reproducir sonido de prueba'} onClick={props.onPlayPause}><Icon name={props.playing?'pause':'play'}/></button>
    <button className="round-button" type="button" aria-label="Siguiente canción de muestra" onClick={props.onNext}><Icon name="next"/></button>
    <button className="round-button" type="button" aria-label="Repetir sonido de prueba" aria-pressed={props.repeat} onClick={props.onRepeat}><Icon name="repeat"/></button>
  </div>;
  return <div className="now-playing" data-view={mode}>
    <div hidden={mode!=='player'}>
      <div className="now-playing__visual">
      <div className="now-playing__context"><span>SONANDO DESDE LA MUESTRA</span><strong>{props.album}</strong></div>
      <div className="expanded-art">{props.cover}</div>
      {lyrics.kind==='timed'&&<p className="now-playing__line" aria-hidden="true">{lyrics.lines[active]?.text}</p>}
      </div><div className="now-playing__body">
      <div className="expanded-info"><div><h2>{props.title}</h2><p>{props.artist}</p></div><SaveTrackButton saved={props.saved} label={props.saved?'Quitar canción actual de favoritos':'Añadir canción actual a favoritos'} onToggle={props.onToggleSave}/></div>
      <div className="expanded-seek"><label className="sr-only" htmlFor="demo-position">Posición del sonido de prueba</label><input id="demo-position" type="range" min="0" max="8" step=".1" value={props.position} onChange={event=>props.onSeek(Number(event.target.value))}/><div><span>0:{String(Math.floor(props.position)).padStart(2,'0')}</span><span>−0:{String(Math.max(0,8-Math.floor(props.position))).padStart(2,'0')}</span></div></div>
      {mode==='player'&&transport}
      <div className="now-playing__secondary"><button ref={lyricsButton} type="button" onClick={()=>openView('lyrics')}><Icon name="lyrics"/>Letra</button><span>Sonido de prueba · 8 s</span><button ref={queueButton} type="button" onClick={()=>openView('queue')}><Icon name="queue"/>Cola</button></div>
      <div className="lyrics-card"><div className="lyrics-card__heading"><h3>Vista previa de la letra</h3><span>Texto de muestra</span></div>
        {lyrics.kind==='missing'?<div className="lyrics-empty"><strong>Letra no disponible</strong><p>Puedes seguir escuchando. Esta pista de muestra no tiene letra.</p></div>:<div className="lyrics-card__lines">{lyrics.lines.slice(0,2).map((line,index)=><p key={index} data-active={lyrics.kind==='timed'&&index===active?'true':undefined}>{line.text}</p>)}</div>}
        <button type="button" onClick={()=>openView('lyrics')}>Mostrar letra</button>
      </div>
      </div>
    </div>
    {mode!=='player'&&<div className="player-detail-view"><button className="back-button" type="button" onClick={()=>setMode('player')}>← Volver al reproductor</button><h2 ref={viewHeading} tabIndex={-1}>{mode==='lyrics'?'Letra':'Cola de reproducción'}</h2><p className="player-detail-view__track">{props.title} · {props.artist}</p>
      {mode==='lyrics'?<><p className="lyrics-source">{lyrics.kind==='timed'?'Texto original de muestra · tiempos de demostración':lyrics.kind==='plain'?'Texto original de muestra · sin sincronizar':'Sin letra disponible para esta muestra'}</p>
        {lyrics.kind==='missing'?<div className="lyrics-empty"><h3>Letra no disponible</h3><p>El audio y sus controles siguen disponibles.</p></div>:<div className="lyrics-full">{lyrics.lines.map((line,index)=>lyrics.kind==='timed'?<button type="button" key={index} aria-current={active===index?'true':undefined} onClick={()=>props.onSeek(line.time??0)}>{line.text}</button>:<p key={index}>{line.text}</p>)}</div>}
      </>:<ol className="now-playing__queue">{props.queue.map((item,index)=><li key={item.id}><span aria-hidden="true">{index+1}</span><button type="button" aria-current={item.id===props.trackId?'true':undefined} onClick={()=>props.onQueueSelect(item.id)}><strong>{item.title}</strong><span>{item.artist}</span></button></li>)}</ol>}
      {transport}<p className="detail-footnote">La letra es original de esta prueba visual. El audio es un tono instrumental de 8 segundos; no es una grabación cantada.</p>
    </div>}
  </div>;
}
