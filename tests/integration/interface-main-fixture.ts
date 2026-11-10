import {registerDatabaseRealmHost} from '../../src/storage/database-realms';
import {openDatabase,closeDatabase,readRecord} from '../../src/storage/database';
import {importFileDetailed} from '../../src/imports/import-file';
import {setManualLyrics} from '../../src/library/lyrics';
import {createPlaylist,changePlaylist,editTrack} from '../../src/library/library';
import {readArtwork,setManualArtwork} from '../../src/library/artwork';
import type {Playlist,Track} from '../../src/library/library';
registerDatabaseRealmHost({capture:(_kind,current)=>current()?{current,onLifecycle:()=>{},end:()=>{}}:null});
Object.assign(window,{setupCollectionFixture:async()=>{const db=await openDatabase();closeDatabase(db);const rows=[];for(let i=0;i<5;i++){const b=new Uint8Array(480044),v=new DataView(b.buffer);const text=(s:string,p:number)=>[...s].forEach((c,j)=>b[p+j]=c.charCodeAt(0));text('RIFF',0);v.setUint32(4,b.length-8,true);text('WAVEfmt ',8);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text('data',36);v.setUint32(40,b.length-44,true);b[100]=i+1;const x=await importFileDetailed(new File([b],`Sintética ${i}.wav`,{type:'audio/wav'}),new AbortController().signal,()=>{},{backend:'idb',...(i===4?{libraryMode:'cache' as const}:{})});if(x.kind!=='confirmed')throw Error('fixture import');await editTrack(x.result.track.id,x.result.track.revision,{album:i<3?'Álbum sintético':'Otro álbum',artist:'Artista sintético',favorite:i===2,...(i===3?{title:'Título extraordinariamente largo sin espacios '+('Música'.repeat(20))}:{})});rows.push({track:x.result.track.id,asset:await readRecord('assets',x.result.track.assetId!)});}const plain=await setManualLyrics(rows[2].track,'Línea original de prueba\nSegunda línea propia','plain',0);const timed=await setManualLyrics(rows[4].track,'[00:00.00]Inicio de prueba\n[00:04.00]Segunda línea propia','lrc',0);if(plain.state!=='ready'||timed.state!=='ready')throw Error('synthetic lyrics setup');const list=await createPlaylist('Playlist protegida');await changePlaylist(list.id,1,{type:'add',trackId:rows[2].track});sessionStorage.setItem('test-own-fixture',JSON.stringify({rows,list:list.id}));}});

// Additional, opt-in playlist fixture; the original interface fixture is unchanged.
Object.assign(window,{setupPlaylistDesignFixture:async()=>{
 await (window as unknown as {setupCollectionFixture:()=>Promise<void>}).setupCollectionFixture();
 const fixture=JSON.parse(sessionStorage.getItem('test-own-fixture')!);
 const titles=['Antes de salir','Luz de madrugada','Todo a su tiempo','Después de la lluvia'];
 const colors=['#1b6680','#94523d','#2e6456','#6d516e'];
 for(let i=0;i<4;i++){
  const track=(await readRecord<Track>('tracks',fixture.rows[i].track))!;
  await editTrack(track.id,track.revision,{title:titles[i],artist:i===3?'Río Claro':'Luna Norte'});
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const ctx=canvas.getContext('2d')!;
  ctx.fillStyle=colors[i];ctx.fillRect(0,0,128,128);ctx.strokeStyle='#ffffff88';ctx.lineWidth=2;ctx.beginPath();ctx.arc(100,98,70,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(100,98,48,0,Math.PI*2);ctx.stroke();
  const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!),'image/png'));
  const previous=await readArtwork(track.id);await setManualArtwork(track.id,new Blob([new Uint8Array(await blob.arrayBuffer())],{type:'image/png'}),previous.revision);
 }
 let list=(await readRecord<Playlist>('playlists',fixture.list))!;
 await changePlaylist(list.id,list.revision,{type:'rename',name:'Cuando baja el ruido'});list=(await readRecord<Playlist>('playlists',fixture.list))!;
 for(const i of [0,1,3]){await changePlaylist(list.id,list.revision,{type:'add',trackId:fixture.rows[i].track});list=(await readRecord<Playlist>('playlists',fixture.list))!;}
 const empty=await createPlaylist('Para después');fixture.emptyList=empty.id;
 sessionStorage.setItem('test-own-fixture',JSON.stringify(fixture));
}});
