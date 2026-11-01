import React from 'react';
import {createRoot} from 'react-dom/client';
import {Player} from './playback/player';
import {demoMusic} from './demo-music';
import './style.css';
const audio=new Audio();audio.preload='metadata';const player=new Player(audio);
player.setQueue(demoMusic.map((sample,i)=>({id:`sample-${i}`,trackId:sample.id,title:sample.id,src:new URL(sample.file,location.origin).href})));
let owner=false;let lockPending=false;let ownership='';let release:(()=>void)|null=null;
const subscribers=new Set<()=>void>();const emit=()=>subscribers.forEach(fn=>fn());
async function acquire(){
 if(lockPending||owner)return;lockPending=true;
 if(!navigator.locks){ownership='Este navegador no permite asegurar una sola reproducción. La prueba no se ha iniciado.';lockPending=false;emit();return;}
 try{await navigator.locks.request('pulso-web:local:playback',{ifAvailable:true},async lock=>{
 if(!lock){ownership='Otra pestaña de Pulso tiene el control. Cierra esa pestaña y pulsa Reintentar.';lockPending=false;emit();return;}
 owner=true;ownership='';lockPending=false;emit();await new Promise<void>(resolve=>{release=resolve;});owner=false;emit();
 });}catch{ownership='No se pudo obtener el control. Recarga y reintenta.';lockPending=false;emit();}
}
void acquire();
window.addEventListener('pagehide',()=>{player.pause();release?.();});
window.addEventListener('pageshow',()=>{void acquire();});
player.subscribe(()=>{
 if(owner&&'mediaSession'in navigator){navigator.mediaSession.metadata=player.current?new MediaMetadata({title:player.current.title,artist:'Pulso · muestra instrumental original'}):null;navigator.mediaSession.playbackState=player.state==='playing'?'playing':'paused';}
 emit();
});
if('mediaSession'in navigator){for(const[action,fn]of Object.entries({play:()=>{if(owner)void player.play();},pause:()=>player.pause(),nexttrack:()=>{if(owner)player.next();},previoustrack:()=>{if(owner)player.previous();}})){try{navigator.mediaSession.setActionHandler(action as MediaSessionAction,fn);}catch{/* optional */}}}
const states={idle:'Listo para escuchar',loading:'Cargando',playing:'Reproduciendo',paused:'En pausa',buffering:'Cargando audio',ended:'Prueba finalizada',error:'No se pudo reproducir'};
function App(){
 const[,render]=React.useReducer(n=>n+1,0);React.useEffect(()=>{subscribers.add(render);return()=>{subscribers.delete(render);};},[]);
 return <main><p>PULSO · PRUEBA MUSICAL</p><h1>Aquí están las tres muestras</h1><p>Instrumentales originales: Aurora, Brisa y Camino. Cada una dura unos 16 segundos. No necesitas importar nada.</p>
 <button disabled={!owner} onClick={()=>player.select(0,true)}>Reproducir las tres</button>
 {ownership&&<div role="status"><p>{ownership}</p><button onClick={()=>void acquire()}>Reintentar</button></div>}
 <section aria-label="Reproductor de muestras"><h2>{player.current?.title??'Aurora → Brisa → Camino'}</h2><p role="status" data-playback-state={player.state}>{states[player.state]}{player.error?` · ${player.error}`:''}</p><div className="controls"><button disabled={!owner||!player.current} onClick={()=>void player.play()}>Continuar</button><button onClick={()=>player.pause()}>Pausar</button><button disabled={!owner||player.following()<0} onClick={()=>player.next()}>Siguiente</button></div></section>
 <ol aria-label="Tres muestras disponibles">{demoMusic.map((sample,i)=><li key={sample.id}><h2>{i+1}. {sample.id}</h2><p>Instrumental original · 16 segundos</p><button disabled={!owner} onClick={()=>player.select(i,true)}>Escuchar {sample.id}</button></li>)}</ol>
 <p>Esta página comprueba reproducción y avance entre archivos. No modifica tu biblioteca ni prueba por sí sola el funcionamiento sin conexión o con el iPhone bloqueado.</p><a href="/listen.html">Volver a mi biblioteca</a></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
