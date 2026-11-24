import assert from 'node:assert/strict';
import {test} from 'node:test';
import {albumDownloadKey,createCollectionDownloadQueue,libraryDownloadKey,type CollectionDownloadJob} from '../../src/library/collection-download-queue';
import {copyLibraryDownloadCheckpoint} from '../../src/library/library-download-checkpoint';

const id=(index:number)=>String(index).padStart(8,'0')+'-1111-4111-8111-111111111111';
const library=(index:number):CollectionDownloadJob=>({
 kind:'library',id:id(index),key:libraryDownloadKey('playlist:'+id(index)),title:'Playlist '+index,
 request:{id:id(index),trackIds:[id(5)],title:'Playlist '+index,play:false},
});
const album:CollectionDownloadJob={
 kind:'album',id:id(20),key:albumDownloadKey(20),title:'Álbum B',
 album:{version:1,edition:{id:20,title:'Álbum B',artist:'Vera Sol',trackCount:1,releaseDate:null},
  tracks:[{releaseId:20,trackId:30,disc:1,position:1,title:'Luz',artist:'Vera Sol',durationMs:2000}],
  savedAt:'2026-11-24T00:00:00.000Z',failedTracks:[]},
};
function storageFixture(){
 const values=new Map<string,string>();
 return {
  getItem:(key:string)=>values.get(key)??null,
  setItem:(key:string,value:string)=>{values.set(key,value);},
  removeItem:(key:string)=>{values.delete(key);},
 };
}
test('la cola conserva el orden de alta y quitar un elemento intermedio preserva el resto',()=>{
 const queue=createCollectionDownloadQueue(storageFixture(),id(9));
 assert.equal(queue.add(library(1)),1);
 assert.equal(queue.add(album),2);
 assert.equal(queue.add(library(3)),3);
 queue.remove(album.key);
 assert.deepEqual(queue.read(),[library(1),library(3)]);
});
test('al liquidar el primer elemento, por finalización o por cancelación, avanza el siguiente',()=>{
 for(const reason of ['finished','stopped']){
  const queue=createCollectionDownloadQueue(storageFixture(),id(9));
  const first=library(1);
  queue.add(first);queue.add(album);
  queue.remove(first.key);
  assert.deepEqual(queue.read()[0],album,reason);
 }
});
test('la cola se restaura por cuenta sin duplicar el álbum o la playlist al volver a pulsar',()=>{
 const storage=storageFixture(),account=id(9);
 const first=createCollectionDownloadQueue(storage,account);
 first.add(library(1));first.add(album);
 const restored=createCollectionDownloadQueue(storage,account);
 const duplicate=library(1);
 if(duplicate.kind!=='library')throw Error('fixture');
 duplicate.id=duplicate.request.id=id(2);
 assert.equal(restored.add(duplicate),1);
 assert.equal(restored.add(album),2);
 assert.deepEqual(restored.read(),[library(1),album]);
 const other=createCollectionDownloadQueue(storage,id(8));
 assert.deepEqual(other.read(),[]);
 other.add(library(3));restored.remove(album.key);
 assert.deepEqual(other.read(),[library(3)]);
 assert.deepEqual(first.read(),[library(1)]);
});
test('el checkpoint conserva la identidad de la colección que reclamó de la cola',()=>{
 const checkpoint={id:id(1),trackIds:[id(5)],cursor:0,pending:null,collectionKey:library(2).key,queueId:id(3)};
 assert.deepEqual(copyLibraryDownloadCheckpoint(checkpoint),checkpoint);
 assert.equal(copyLibraryDownloadCheckpoint({...checkpoint,queueId:'otra'}),null);
});

test('terminar una admisión antigua no retira la selección que volvió a encolarse',()=>{
 const queue=createCollectionDownloadQueue(storageFixture(),id(9));
 const first=library(1);
 queue.add(first);queue.remove(first.key,first.id);
 const second=library(1);
 if(second.kind!=='library')throw Error('fixture');
 second.id=second.request.id=id(2);
 queue.add(second);
 queue.remove(first.key,first.id);
 assert.deepEqual(queue.read(),[second]);
});
