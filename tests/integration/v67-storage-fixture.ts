import './interface-main-fixture';
import {writeRecord,openDatabase,closeDatabase} from '../../src/storage/database';
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
