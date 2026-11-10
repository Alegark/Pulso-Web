import React,{useEffect,useLayoutEffect,useReducer,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Player} from '../../src/playback/player';
import {MiniPlayer} from '../../src/ui/MiniPlayer';
import {PlayerSurface} from '../../src/ui/PlayerSurface';
import '../../src/ui/shell.css';
import '../../src/ui/artwork.css';
import '../../src/style.css';
import '../../src/ui/design-tokens.css';
import '../../src/ui/responsive-shell.css';

// Own fixture audio and actual Player; no SDK, account, storage or app controller.
const audio=new Audio();
audio.preload='metadata';
const player=new Player(audio);
player.setQueue([{id:'one',trackId:'one',title:'Órbita',src:new URL('/fixtures/A.wav',location.href).href},{id:'two',trackId:'two',title:'Brisa',src:new URL('/fixtures/B.wav',location.href).href}]);
player.select(0,false);
let starts=0;
audio.addEventListener('play',()=>starts++);
const longTitle='Cuando las luces de la ciudad se apagan (sesión acústica al atardecer)';
const longArtist='Estudio Pulso, La Orquesta de las Pequeñas Cosas y Mar del Norte';

function App(){
  const [,render]=useReducer(n=>n+1,0);
  const [open,setOpen]=useState(false),[long,setLong]=useState(false),[page,setPage]=useState('Inicio');
  const heading=useRef<HTMLHeadingElement>(null),opener=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>player.subscribe(render),[]);
  const title=long?longTitle:player.current?.title??'Sin selección',artist=long?longArtist:'Estudio Pulso';
  useLayoutEffect(()=>{if(open)heading.current?.focus({preventScroll:true});else opener.current?.focus({preventScroll:true});},[open]);
  useLayoutEffect(()=>{
    const bars=[document.querySelector<HTMLElement>('.shell-nav'),document.querySelector<HTMLElement>('.mini-player')];
    const measure=()=>bars.forEach((bar,i)=>document.documentElement.style.setProperty(i?'--mini-height':'--nav-height',`${bar&&getComputedStyle(bar).position==='fixed'?bar.getBoundingClientRect().height:0}px`));
    measure();const observer=new ResizeObserver(measure);bars.forEach(bar=>{if(bar)observer.observe(bar);});addEventListener('resize',measure);return()=>{observer.disconnect();removeEventListener('resize',measure);};
  },[]);
  const close=()=>setOpen(false);
  return <main className="pulso-app" data-player-open={open?'true':undefined}>
    <header className="pulso-header"><p className="pulso-wordmark">pulso</p><h1>Tu música, en este navegador</h1><nav className="shell-nav" aria-label="Principal">{['Inicio','Buscar','Biblioteca'].map(name=><button key={name} aria-current={page===name?'page':undefined} onClick={()=>setPage(name)}>{name}</button>)}</nav><button type="button" onClick={()=>setLong(value=>!value)}>Títulos largos</button></header>
    <section aria-label={page}><h2>{page}</h2>{page==='Buscar'&&<label>Buscar<input type="search" placeholder="Canción, álbum o artista"/></label>}<p>Muestra aislada de los componentes del producto. Tres destinos y controles conectados al motor de audio existente.</p><ul>{Array.from({length:12},(_,i)=><li key={i}><strong>{long?longTitle:`Canción de muestra ${i+1}`}</strong><p>{artist}</p></li>)}</ul></section>
    <PlayerSurface open={open} onClose={close}>
      <h2 ref={heading} tabIndex={-1}>{title}</h2><p>{artist}</p><div className="artwork-panel"><div className="artwork-placeholder" role="img" aria-label="Sin portada">♪</div><p>Sin portada incrustada</p></div>
      <p role="status">{player.state}</p><div className="controls"><button onClick={()=>player.previous()}>Anterior</button><button onClick={()=>void player.play()}>Reproducir</button><button onClick={()=>player.pause()}>Pausar</button><button onClick={()=>player.next()}>Siguiente</button></div>
      <label>Posición<input type="range" aria-label="Posición en segundos" min="0" max={Number.isFinite(audio.duration)?audio.duration:1} step=".1" value={Math.min(audio.currentTime,Number.isFinite(audio.duration)?audio.duration:1)} onChange={e=>player.seek(Number(e.target.value))}/></label>
      <label>Repetición<select value={player.repeat} onChange={e=>player.setRepeat(e.target.value as 'off'|'one'|'all')}><option value="off">Desactivada</option><option value="one">Una pista</option><option value="all">Toda la cola</option></select></label>
      <details><summary>Letras de muestra</summary><label>Texto local<textarea defaultValue="El texto de prueba no pertenece a ninguna canción real."/></label></details>
      <h3>Cola independiente</h3><ol>{Array.from({length:8},(_,i)=><li key={i}><button>{long?longTitle:`Pista de prueba ${i+1}`}</button><button>Subir</button><button>Bajar</button></li>)}</ol>
    </PlayerSurface>
    <MiniPlayer title={title} artist={artist} stateText={player.state} playing={player.state==='playing'} canPlay canPause onPlay={()=>void player.play()} onPause={()=>player.pause()} onOpenPlayer={button=>{opener.current=button;setOpen(true);}}/>
  </main>;
}
Object.assign(window,{designFixture:{audio,player,get starts(){return starts;}}});
createRoot(document.getElementById('root')!).render(<App/>);
