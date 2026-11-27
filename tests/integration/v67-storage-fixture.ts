import './interface-main-fixture';
import {writeRecord,openDatabase,closeDatabase} from '../../src/storage/database';
import {changePlaylist,editTrack,type Track} from '../../src/library/library';
import {importFileDetailed} from '../../src/imports/import-file';
import {readRecord} from '../../src/storage/database';
import {previewCollectionRemoval,releaseCollectionRemovalPreview} from '../../src/library/collection-removal';
Object.assign(window,{checkV67QueuedPreview:async()=>{
 const fixture=JSON.parse(sessionStorage.getItem('test-own-fixture')!),trackId=fixture.rows[4].track;
 await writeRecord('settings','library-playback',{version:1,entries:[{id:'test-entry',trackId}],currentEntryId:'test-entry',position:0,repeat:'off',shuffleOrder:null});
 const context={signal:new AbortController().signal,current:()=>true},selection={kind:'cache' as const,scope:'global-listening-cache' as const};
 try{
  const protectedPreview=await previewCollectionRemoval(selection,context,{evictQueued:false});releaseCollectionRemovalPreview(protectedPreview.token);
  const evictPreview=await previewCollectionRemoval(selection,context,{evictQueued:true});releaseCollectionRemovalPreview(evictPreview.token);
  return {trackId,protectedCopies:protectedPreview.copiesEligible,protectedQueue:protectedPreview.queuedTrackIds,evictCopies:evictPreview.copiesEligible,evictQueue:evictPreview.queuedTrackIds};
 }finally{const db=await openDatabase();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('settings','readwrite');tx.objectStore('settings').delete('library-playback');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});closeDatabase(db);}
}});

Object.assign(window,{setupV67QueuePlaylist:async()=>{
 await (window as unknown as {setupCollectionFixture:()=>Promise<void>}).setupCollectionFixture();
 const f=JSON.parse(sessionStorage.getItem('test-own-fixture')!);
 const track=(await readRecord<Track>('tracks',f.rows[4].track))!;
 await editTrack(track.id,track.revision,{album:'Álbum solo caché uno'});
 await changePlaylist(f.list,2,{type:'add',trackId:track.id});
 const b=new Uint8Array(160044),v=new DataView(b.buffer);const text=(s:string,p:number)=>[...s].forEach((c,i)=>b[p+i]=c.charCodeAt(0));
 text('RIFF',0);v.setUint32(4,b.length-8,true);text('WAVEfmt ',8);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,8000,true);v.setUint32(28,16000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text('data',36);v.setUint32(40,b.length-44,true);b[100]=42;
 const imported=await importFileDetailed(new File([b],'Solo playlist.wav',{type:'audio/wav'}),new AbortController().signal,()=>{},{backend:'idb',libraryMode:'cache'});
 if(imported.kind!=='confirmed')throw Error('fixture import');
 const second=imported.result.track;await editTrack(second.id,second.revision,{album:'Álbum solo caché dos',artist:'Artista sintético'});
 f.rows.push({track:second.id,asset:await readRecord('assets',second.assetId!)});sessionStorage.setItem('test-own-fixture',JSON.stringify(f));
 await changePlaylist(f.list,3,{type:'add',trackId:second.id});
 const {saveAlbumRecord}=await import('../../src/library/saved-albums');
 const {rememberSongAlias}=await import('../../src/library/selected-song');
 const {albumTrackChoice}=await import('../../src/library/album-acquisition');
 const album={edition:{id:986,title:'Álbum guardado para gestión',artist:'Artista sintético',trackCount:1,releaseDate:null},tracks:[{releaseId:986,trackId:899,disc:1,position:1,title:'Sintética 0',artist:'Artista sintético',durationMs:30000}]};
 let saved=(await readRecord<Track>('tracks',f.rows[0].track))!;await editTrack(saved.id,saved.revision,{album:album.edition.title});saved=(await readRecord<Track>('tracks',saved.id))!;
 if(!saved.audioFingerprint)throw Error('fixture fingerprint');await rememberSongAlias(albumTrackChoice(album.tracks[0],album.edition.title),saved.id,saved.audioFingerprint.sha256,saved.audioFingerprint.bytes,()=>true);
 if(!await saveAlbumRecord('11111111-1111-4111-8111-111111111111',album,()=>true))throw Error('fixture album');
}});

Object.assign(window,{setupV67SavedAlbum:async()=>{
 await (window as unknown as {setupCollectionFixture:()=>Promise<void>}).setupCollectionFixture();
 const f=JSON.parse(sessionStorage.getItem('test-own-fixture')!);
 const {saveAlbumRecord}=await import('../../src/library/saved-albums');
 const {rememberSongAlias}=await import('../../src/library/selected-song');
 const {albumTrackChoice}=await import('../../src/library/album-acquisition');
 const ids=[2,0,4],detail={edition:{id:987,title:'Álbum guardado propio',artist:'Artista sintético',trackCount:3,releaseDate:null},tracks:ids.map((n,i)=>({releaseId:987,trackId:900+i,disc:1,position:i+1,title:`Sintética ${n}`,artist:'Artista sintético',durationMs:30000}))};
 for(const [i,song] of detail.tracks.entries()){
  let track=(await readRecord<Track>('tracks',f.rows[ids[i]].track))!;
  await editTrack(track.id,track.revision,{album:detail.edition.title,artist:detail.edition.artist});
  track=(await readRecord<Track>('tracks',track.id))!;const fp=track.audioFingerprint;
  if(!fp)throw Error('fixture fingerprint');
  await rememberSongAlias(albumTrackChoice(song,detail.edition.title),track.id,fp.sha256,fp.bytes,()=>true);
 }
 if(!await saveAlbumRecord('11111111-1111-4111-8111-111111111111',detail,()=>true))throw Error('fixture album');
}});

Object.assign(window,{setupV67CacheFixture:async()=>{
 await (window as unknown as {setupCollectionFixture:()=>Promise<void>}).setupCollectionFixture();
 const {saveAlbumRecord}=await import('../../src/library/saved-albums');
 const album={edition:{id:985,title:'Álbum conservado',artist:'Artista sintético',trackCount:1,releaseDate:null},tracks:[{releaseId:985,trackId:898,disc:1,position:1,title:'Sintética 0',artist:'Artista sintético',durationMs:30000}]};
 if(!await saveAlbumRecord('11111111-1111-4111-8111-111111111111',album,()=>true))throw Error('fixture album');

}});
