import React from 'react';
import {createRoot} from 'react-dom/client';
import {MusicSearchPanel} from '../../src/ui/MusicSearchPanel';
import {AlbumPageController} from '../../src/ui/AlbumPageController';
import {SelectedSongActions} from '../../src/ui/SelectedSongActions';
import {LibraryDownloadController} from '../../src/ui/LibraryDownloadController';
import {CollectionDownloadButton} from '../../src/ui/DownloadDock';
import {albumCoordinator,notifyAlbumDownload} from '../../src/library/album-download';
import '../../src/style.css';
import '../../src/ui/shell.css';
import '../../src/ui/design-tokens.css';
import '../../src/ui/responsive-shell.css';
import '../../src/ui/app-polish.css';
const calls:string[]=[];let setView:(s:string)=>void,setConfirmationComplete:(complete:boolean)=>void,setProgress:(p:{bytes:number;total:number}|null)=>void;
function App(){
 const [view,viewSet]=React.useState('search'),[selected,choose]=React.useState<string|null>(null),[progress,progressSet]=React.useState<{bytes:number;total:number}|null>(null);setView=viewSet;setProgress=progressSet;
 const [confirmationComplete,changeConfirmationComplete]=React.useState(false);setConfirmationComplete=changeConfirmationComplete;
 const actions=selected?<SelectedSongActions title="Canción de prueba" artist="Artista" status="Preparando canción…" error={null} pending progress={progress} inLibrary={false} canAdd={false} canPlay={false} playlists={[]} canAddToPlaylist={false} onAdd={()=>{}} onPlay={()=>{}} onAddToPlaylist={()=>{}} onCancel={()=>calls.push('cancel')} current={()=>true}/>:null;
 return <main className="pulso-app"><LibraryDownloadController tracks={[]} client={null} bots={null} connected={false}/>{view==='confirmation'?<div className="collection-header"><h3 tabIndex={-1}>Playlist de prueba</h3><CollectionDownloadButton label="Descargar playlist" collectionKey="test-playlist" accountId="test" complete={confirmationComplete} onStart={()=>{}}/></div>:view==='downloads'?<section aria-label="Tus descargas"><h2>Tus descargas</h2></section>:view==='search'?<MusicSearchPanel query="Artista" onQueryChange={()=>{}} onSearch={()=>{}} suggestions={[{id:'one',kind:'track',title:'Canción de prueba',subtitle:'Artista',source:'local'},{id:'two',kind:'track',title:'Otra canción',subtitle:'Artista',source:'local'}]} selectedSuggestionId={selected} onChooseSuggestion={id=>choose(id)} suggestionsPending={false} resultsVisible primaryProvider={null} sessionReady={false} canSearch={false} searchPending={false} results={[]} selectedResultId={null} onSelectResult={()=>{}} uncertain={false} onCancel={()=>{}} songActions={actions} current={()=>true}/>:<AlbumPageController coordinator={albumCoordinator} title="Synthetic" artist="Artist" editionId={42} selectedKey={selected} scope="test" visible client={null} revision={undefined} provider={null} providers={[]} capture={()=>null} management={()=>null} onBack={()=>{}} onChoose={choice=>choose(choice.id)} songActions={actions}/>}</main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
Object.assign(window,{feedbackUI:{
 confirmation:()=>{
  setView('confirmation');setConfirmationComplete(false);
  albumCoordinator.running=true;
  albumCoordinator.active={scope:'test',editionId:0,key:'test',title:'Playlist de prueba',abort:new AbortController(),collectionKey:'test-playlist',accountId:'test'};
  notifyAlbumDownload(albumCoordinator);
 },
 settleConfirmation:()=>{
  albumCoordinator.active=undefined;albumCoordinator.running=false;notifyAlbumDownload(albumCoordinator);
 },
 completeConfirmation:()=>setConfirmationComplete(true),
 calls,view:(v:string)=>setView(v),progress:(p:{bytes:number;total:number}|null)=>setProgress(p),downloads:()=>{albumCoordinator.running=true;albumCoordinator.active={scope:'test',editionId:42,key:'test',title:'Prueba',abort:new AbortController()};albumCoordinator.notice={title:'Álbum de prueba',titles:['Canción uno','Canción dos'],progress:{message:'Preparando la siguiente canción… [D01]',rows:[{state:'downloaded',trackId:'one',confirmed:true,message:'Guardada'},{state:'unattempted',trackId:null,confirmed:false,message:'En espera [D02]'}]}};notifyAlbumDownload(albumCoordinator);},finish:()=>{albumCoordinator.notice={title:'Álbum de prueba',titles:['Canción uno','Canción dos'],progress:{message:'Lote terminado',rows:[{state:'downloaded',trackId:'one',confirmed:true,message:'Guardada'},{state:'failed',trackId:null,confirmed:false,reason:'not-found',message:'No existe en tus bots'}]}};albumCoordinator.active=undefined;albumCoordinator.running=false;notifyAlbumDownload(albumCoordinator);},aborted:()=>albumCoordinator.active?.abort.signal.aborted}});
