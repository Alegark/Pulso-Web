/** TESTONLY pre-MAIN importer entry. Native IDB/OPFS, actual import algorithm.
 * Runs in its own realm before MAIN: no product guards or capabilities replaced. */
import {importFileDetailed} from '../../../src/imports/import-file';
import {editTrack,createPlaylist,changePlaylist} from '../../../src/library/library';
import {rememberSongAlias} from '../../../src/library/selected-song';
import {libraryMembershipKey,makeLibraryMembership} from '../../../src/library/library-membership';
import {readRecord} from '../../../src/storage/database';
import type {Track} from '../../../src/library/library';
export async function seed(forceIdb=false){
 const tracks=[];
 for(const [i,name] of ['tone.wav','tone.mp3'].entries()){
  const bytes=await(await fetch('/__musicflow/'+name)).arrayBuffer();
  const r=await importFileDetailed(new File([bytes],name,{type:i?'audio/mpeg':'audio/wav'}),new AbortController().signal,()=>{},{backend:i&&!forceIdb?'opfs':'idb'});
  if(r.kind!=='confirmed')throw Error('MUSIC_FLOW importer not confirmed '+JSON.stringify(r.outcome));
  await editTrack(r.result.track.id,r.result.track.revision,{title:i?'MUSIC_FLOW Alternate':'MUSIC_FLOW Song (Live version)',artist:'MUSIC_FLOW Artist',album:i?null:'MUSIC_FLOW Album'});
  tracks.push(r.result.track.id);
 }
 let p=await createPlaylist('MUSIC_FLOW own audio');for(const id of tracks){await changePlaylist(p.id,p.revision,{type:'add',trackId:id});p={...p,revision:p.revision+1};}
 return {tracks,entry:'actual importFileDetailed IDB+OPFS, then metadata API; no device picker'};
}
export async function seedAmbiguous(){
 const ids:string[]=[];
 for(const [i,name] of ['tone.wav','tone.mp3'].entries()){
  const bytes=await(await fetch('/__musicflow/'+name)).arrayBuffer();
  const r=await importFileDetailed(new File([bytes],name,{type:i?'audio/mpeg':'audio/wav'}),new AbortController().signal,()=>{},{backend:i?'opfs':'idb'});
  if(r.kind!=='confirmed')throw Error('ambiguous seed import failed');
  ids.push(r.result.track.id);
  await editTrack(r.result.track.id,r.result.track.revision,{title:'MUSIC_FLOW Song (Live version)',artist:'MUSIC_FLOW Artist',album:'MUSIC_FLOW Album'});
 }
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('tracks','readwrite'),store=tx.objectStore('tracks'),get=store.get(ids[1]);get.onsuccess=()=>{const row=get.result;store.put({...row,assetId:null,revision:row.revision+1},ids[1]);};tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}finally{db.close();}
 return ids;
}
export async function seedExactAlias(){
 const ids=await seedAmbiguous();const track=await readRecord<Track>('tracks',ids[0]);if(!track?.audioFingerprint)throw Error('missing seeded fingerprint');
 await rememberSongAlias({id:'itunes:42:1:1:81',source:'itunes',title:'MUSIC_FLOW Song (Live version)',artist:'MUSIC_FLOW Artist',album:'MUSIC_FLOW Album',duration:45},ids[0],track.audioFingerprint.sha256,track.audioFingerprint.bytes,()=>true);
}
export async function seedSingleExactAlias(){
 const bytes=await(await fetch('/__musicflow/tone.wav')).arrayBuffer();
 const r=await importFileDetailed(new File([bytes],'tone.wav',{type:'audio/wav'}),new AbortController().signal,()=>{},{backend:'idb'});
 if(r.kind!=='confirmed')throw Error('single exact-alias import failed');
 await editTrack(r.result.track.id,r.result.track.revision,{title:'MUSIC_FLOW Song (Live version)',artist:'MUSIC_FLOW Artist',album:'MUSIC_FLOW Album'});
 const track=await readRecord<Track>('tracks',r.result.track.id);if(!track?.audioFingerprint)throw Error('single alias fingerprint missing');
 await rememberSongAlias({id:'itunes:42:1:1:81',source:'itunes',title:'MUSIC_FLOW Song (Live version)',artist:'MUSIC_FLOW Artist',album:'MUSIC_FLOW Album',duration:45},track.id,track.audioFingerprint.sha256,track.audioFingerprint.bytes,()=>true);
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('settings','readwrite');tx.objectStore('settings').put(makeLibraryMembership(track.id,false),libraryMembershipKey(track.id));tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}finally{db.close();}
 return [track.id];
}
export async function seedTwoTrackAliasPlaylist(forceIdb=false){
 const seeded=await seed(forceIdb);const track=await readRecord<Track>('tracks',seeded.tracks[0]);
 if(!track?.audioFingerprint||!seeded.tracks[1])throw Error('two-track playlist fixture incomplete');
 await rememberSongAlias({id:'itunes:42:1:1:81',source:'itunes',title:'MUSIC_FLOW Song (Live version)',artist:'MUSIC_FLOW Artist',album:'MUSIC_FLOW Album',duration:45},track.id,track.audioFingerprint.sha256,track.audioFingerprint.bytes,()=>true);
 return seeded;
}
export async function seedAliasWithOtherValidAsset(){
 const seeded=await seed();const first=await readRecord<Track>('tracks',seeded.tracks[0]);
 const bytes=await(await fetch('/__musicflow/second.mp3')).arrayBuffer();
 const imported=await importFileDetailed(new File([bytes],'second.mp3',{type:'audio/mpeg'}),new AbortController().signal,()=>{},{backend:'idb'});
 if(imported.kind!=='confirmed')throw Error('second valid asset fixture import failed');
 const second=await readRecord<Track>('tracks',imported.result.track.id);
 if(!first?.audioFingerprint||!second?.assetId||first.assetId===second.assetId)throw Error('expected two distinct valid assets');
 await rememberSongAlias({id:'itunes:42:1:1:81',source:'itunes',title:'MUSIC_FLOW Song (Live version)',artist:'MUSIC_FLOW Artist',album:'MUSIC_FLOW Album',duration:45},first.id,first.audioFingerprint.sha256,first.audioFingerprint.bytes,()=>true);
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('tracks','readwrite'),store=tx.objectStore('tracks'),get=store.get(first.id);get.onsuccess=()=>{const row=get.result;store.put({...row,assetId:second.assetId,revision:row.revision+1},first.id);};tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}finally{db.close();}
 return [...seeded.tracks,second.id];
}
export async function seedCorruptManifest(){
 const seeded=await seed();const track=await readRecord<Track>('tracks',seeded.tracks[0]);if(!track?.assetId)throw Error('missing asset');
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('assets','readwrite'),store=tx.objectStore('assets'),get=store.get(track.assetId!);get.onsuccess=()=>{store.put({...get.result,sha256:'0'.repeat(64)},track.assetId!);};tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}
export async function seedPhysicalPurge(){
 const seeded=await seed();const track=await readRecord<Track>('tracks',seeded.tracks[0]);if(!track?.assetId)throw Error('missing asset');
 const asset=await readRecord<{storageKey:string;backend:string}>('assets',track.assetId);if(!asset||asset.backend!=='idb')throw Error('expected native IDB asset');
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open('pulso-web-local-v1');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
 try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('chunks','readwrite');tx.objectStore('chunks').delete(IDBKeyRange.bound([asset.storageKey,0],[asset.storageKey,Number.MAX_SAFE_INTEGER]));tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});}finally{db.close();}
}


// Existing completed setup fixture for catalogue-only cases. The browser test
// suppresses reconnection, so even the synthetic SDK is idle.
export async function seedArtistCatalogueSetup(){
 const {sessionLease,saveTelegramSession}=await import('../../../src/telegram/saved-session.ts');
 if(!await saveTelegramSession(await sessionLease(),'MUSIC_FLOW_SYNTHETIC_AUTH_ONLY'))throw Error('test setup');
 localStorage.setItem('pulso:setup:v1:11111111-1111-4111-8111-111111111111','complete');
}

export async function importArtistFixture(){
 const bytes=await(await fetch('/__musicflow/second.mp3')).arrayBuffer();
 const attempt=await importFileDetailed(new File([bytes],'second.mp3',{type:'audio/mpeg'}),new AbortController().signal,()=>{},{backend:'idb'});
 if(attempt.kind!=='confirmed'||attempt.result.track.artist!=='MUSIC_FLOW Artist')throw Error('artist fixture import');
 return attempt.result.track.id;
}

export async function playlistWithLocalCopies(ids:string[]){
 let playlist=await createPlaylist('MUSIC_FLOW Portadas');
 for(const trackId of ids){
  await changePlaylist(playlist.id,playlist.revision,{type:'add',trackId});
  playlist={...playlist,revision:playlist.revision+1};
 }
}

export async function seedSpotifyAlbum(forceIdb=false){
 const {writeRecord}=await import('../../../src/storage/database');
 const {activeLibraryAccount}=await import('../../../src/accounts/library-local');
 const {tracks:[id]}=await seed(forceIdb);
 const track=await readRecord<Track>('tracks',id);
 if(!track)throw Error('fixture track');
 const spotifyId='A'.repeat(22);
 const catalogChoice={source:'spotify' as const,id:'spotify:'+spotifyId,title:track.title,artist:track.artist,album:track.album,duration:track.duration};
 await writeRecord('tracks',id,{...track,manualOverrides:{},catalogChoice});
 const account=await activeLibraryAccount()??'11111111-1111-4111-8111-111111111111';
 const input=JSON.stringify([track.title,track.artist,track.album,catalogChoice.duration,catalogChoice.id,catalogChoice.source,
  catalogChoice.title,catalogChoice.artist,catalogChoice.album,catalogChoice.duration]);
 await writeRecord('settings',['spotify-catalog-release',1,account,id],{input,release:{
  source:'spotify',releaseId:'B'.repeat(22),trackId:spotifyId,position:1,itunesReleaseId:42,title:track.album,artist:track.artist,
 }});
}

export async function savedAlbumContracts(){
 const {saveAlbumRecord,readSavedAlbums,savedAlbumKey,savedAlbumGroupKey}=await import('../../../src/library/saved-albums');
 const {ACTIVE_LIBRARY_ACCOUNT,activeLibraryAccount}=await import('../../../src/accounts/library-local');
 const {writeRecord}=await import('../../../src/storage/database');
 const {WRITER_LOCK}=await import('../../../src/storage/asset-reader');
 const {previewCollectionRemoval,confirmCollectionRemoval}=await import('../../../src/library/collection-removal');
 const account=await activeLibraryAccount();
 if(!account)throw Error('fixture account');
 const id=77;
 const detail={edition:{id,title:'Synthetic',artist:'Artist',trackCount:1,releaseDate:null},
  tracks:[{releaseId:id,trackId:78,disc:1,position:1,title:'Song',artist:'Artist',durationMs:45000}]};
 const ensure=(value:unknown)=>{if(!value)throw Error('saved album contract');};
 let active=true,queued!:Promise<unknown>;
 await navigator.locks.request(WRITER_LOCK,async()=>{
  queued=saveAlbumRecord(account,detail,()=>active).catch(error=>error.message);
  ensure((await navigator.locks.query()).pending?.some(lock=>lock.name===WRITER_LOCK));
  active=false;
 });
 ensure(await queued==='account-changed');
 await writeRecord('settings',ACTIVE_LIBRARY_ACCOUNT,'22222222-2222-4222-8222-222222222222');
 try{ensure(await saveAlbumRecord(account,detail,()=>true).catch(error=>error.message)==='account-changed');}
 finally{await writeRecord('settings',ACTIVE_LIBRARY_ACCOUNT,account);}
 const saved=await saveAlbumRecord(account,detail,()=>true);
 if(!saved)throw Error('save failed');
 const update={savedAt:saved.savedAt,failedTracks:['itunes:77:1:1:78']};
 const changed=await saveAlbumRecord(account,detail,()=>true,update);
 ensure(changed?.savedAt===saved.savedAt&&changed?.failedTracks.length===1);
 const context={current:()=>true,signal:new AbortController().signal};
 const selection={kind:'album' as const,scope:'global-library' as const,key:savedAlbumGroupKey(id)};
 const consent={confirm:true as const,acceptPossibleOnlyCopyLoss:true as const};
 const unused=()=>{throw Error('no copies to clean');};
 const host={readContext:unused,reserve:unused,record:unused,forget:unused};
 const stale=await previewCollectionRemoval(selection,context);
 await saveAlbumRecord(account,detail,()=>true,{...update,failedTracks:[]});
 ensure((await confirmCollectionRemoval(stale.token,consent,context,host)).reason==='collection-changed');
 const fresh=await previewCollectionRemoval(selection,context);
 ensure((await confirmCollectionRemoval(fresh.token,consent,context,host)).metadata==='committed');
 ensure(await saveAlbumRecord(account,detail,()=>true,update)===null);
 await writeRecord('settings',savedAlbumKey(account,id),{...saved,version:2});
 ensure(!(await readSavedAlbums(account)).some(album=>album.edition.id===id));
 ensure(await saveAlbumRecord(account,detail,()=>true,update)===null);
 ensure((await saveAlbumRecord(account,detail,()=>true))?.version===1);
 return {lock:true,account:true,failures:true,conflict:true,removed:true,corrupt:true};
}
