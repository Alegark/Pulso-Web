import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {NowPlayingView} from '../../src/ui/NowPlayingView';
let scopeCurrent=true;
Object.assign(window,{invalidateScope:()=>{scopeCurrent=false;}});
function Fixture(){
 const [track,setTrack]=useState('a'),[favorite,setFavorite]=useState(false),[pending,setPending]=useState(false),[status,setStatus]=useState(''),[open,setOpen]=useState(true);
 const noop=()=>{};
 return <div className="pulso-app"><button onClick={()=>setOpen(!open)}>Alternar reproductor</button><button onClick={()=>{setTrack(track==='a'?'b':'a');setFavorite(false);}}>Cambiar pista</button><button onClick={()=>{setPending(false);setStatus('No se pudo guardar');}}>Simular error</button><button onClick={()=>{setPending(false);setFavorite(true);setStatus('Añadida a Favoritos');}}>Confirmar</button><div className="player-surface"><NowPlayingView open={open} headingRef={null} title={track} artist="Artista" artwork={null} lyrics={null} queue={null} playing={false} favorite={favorite} favoritePending={pending} favoriteStatus={status} shuffle={false} repeat="off" position={0} duration={10} canPlay canPause canPrevious canNext canSeek canOrganize onPlay={noop} onPause={noop} onPrevious={noop} onNext={noop} onSeek={noop} onShuffle={noop} onRepeat={noop} onFavorite={()=>setPending(true)} trackId={track} current={()=>scopeCurrent}/></div></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
