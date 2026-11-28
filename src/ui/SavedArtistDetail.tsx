import React from 'react';
import type {AlbumEdition,CatalogArtist} from '../library/album-catalog';
import {albumCoordinator} from '../library/album-download';
import {AlbumPageController} from './AlbumPageController';
import {ArtistPage} from './ArtistCatalogView';

interface Props {
 artist:CatalogArtist;
 scope:string;
 visible:boolean;
 saveArtist?:React.ComponentProps<typeof ArtistPage>['onSave'];
 canSave:boolean;
 onBack:()=>void;
}

export function SavedArtistDetail({artist,scope,visible,onBack,saveArtist,canSave}:Props) {
 const [album,setAlbum]=React.useState<AlbumEdition|null>(null);
 const fromAlbum=React.useRef<{opener:HTMLButtonElement;scroll:number}|null>(null);
 React.useLayoutEffect(()=>{
  if(album||!visible||!fromAlbum.current)return;
  const {opener,scroll}=fromAlbum.current;
  fromAlbum.current=null;
  if(opener.isConnected)opener.focus({preventScroll:true});
  window.scrollTo(0,scroll);
 },[album,visible]);
 return <>
  <div hidden={!!album}>
   <ArtistPage artist={artist} scope={scope} visible={visible&&!album} backLabel="Volver a Biblioteca" onBack={onBack} saved saveDisabled={!canSave} onSave={saveArtist}
    onAlbum={(edition,opener)=>{fromAlbum.current={opener,scroll:window.scrollY};setAlbum(edition);window.scrollTo(0,0);}}/>
  </div>
  {album&&<AlbumPageController metadataOnly coordinator={albumCoordinator} title={album.title} artist={album.artist} editionId={album.id}
   artworkUrl={album.artworkUrl} scope={scope} visible={visible} backLabel="Volver al artista"
   client={null} revision={undefined} provider={null} providers={[]} capture={()=>null} management={()=>null}
   selectedKey={null} songActions={null} onChoose={()=>{}} onBack={()=>setAlbum(null)}/>}
 </>;
}
