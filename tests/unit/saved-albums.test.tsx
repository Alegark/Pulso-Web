import React from "react";
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {copySavedAlbum,libraryAlbumCards,matchSavedAlbumTracks,readSavedAlbumsFrom,savedAlbumGroupKey} from '../../src/library/saved-albums';
import type {Track} from '../../src/library/library';
import {CollectionCover} from '../../src/ui/CollectionCover';

const date='2026-11-23T12:00:00.000Z';
const tracks=[1,2,3,4].map(position=>({
 releaseId:42,trackId:80+position,disc:1,position,title:'Pista '+position,artist:'Artista',durationMs:45000,
}));
const snapshot={version:1,savedAt:date,edition:{id:42,title:'Álbum',artist:'Artista',trackCount:4,releaseDate:null},tracks,failedTracks:[]};

function local(position:number,releaseId=42):Track {
 return {id:'local-'+position,assetId:'asset-'+position,createdAt:date,title:'Pista '+position,artist:'Artista',album:'Álbum',
  duration:45,favorite:false,revision:1,manualOverrides:{},catalogRelease:{
   source:'itunes',releaseId,trackId:80+position,disc:1,position,title:'Álbum',artist:'Artista',
  }};
}

test('El registro de álbum se valida al escribir y al leer y conserva el orden',()=>{
 const album=copySavedAlbum({...snapshot,tracks:[...tracks].reverse()},42);
 assert.deepEqual(album,snapshot);
 assert.notEqual(album?.tracks,tracks);
 for(const invalid of [
  {...snapshot,version:2},{...snapshot,savedAt:'ayer'},
  {...snapshot,tracks:tracks.slice(1)},
  {...snapshot,tracks:[tracks[0],...tracks.slice(0,3)]},
  {...snapshot,tracks:[{...tracks[0],releaseId:43},...tracks.slice(1)]},
  {...snapshot,edition:{...snapshot.edition,artworkUrl:'https://invalid.example/image'}},
  {...snapshot,failedTracks:['itunes:43:1:1:81']},
 ])assert.equal(copySavedAlbum(invalid,42),null);
 assert.equal(copySavedAlbum(snapshot,43),null);
});

test('La edición guardada existe con cero, algunas o todas las copias y absorbe solo identidades exactas',()=>{
 const album=copySavedAlbum(snapshot)!;
 assert.deepEqual(libraryAlbumCards([],[album]).map(card=>[card.key,card.count,card.trackIds]),[[savedAlbumGroupKey(42),4,[]]]);
 const copies=[local(4),local(2),local(1),local(3)];
 const other=local(9,43);
 const partial=matchSavedAlbumTracks(album,[other,copies[0],copies[2]]);
 assert.deepEqual(partial.map(row=>row.copies.map(track=>track.id)),[['local-1'],[],[],['local-4']]);
 assert.deepEqual(matchSavedAlbumTracks(album,copies).map(row=>row.copies.length),[1,1,1,1]);
 const [saved,loose]=libraryAlbumCards([other,...copies],[album]);
 assert.deepEqual(saved.trackIds,['local-1','local-2','local-3','local-4']);
 assert.equal(loose.editionId,43);
 assert.equal(loose.count,1);
 assert.equal(libraryAlbumCards([{...other,catalogRelease:undefined}],[])[0].editionId,undefined);
});

test('Una portada de álbum ocupa una sola celda y cuatro canciones de playlist forman mosaico',()=>{
 const trackIds=['a','b','c','d'];
 const album=renderToStaticMarkup(<CollectionCover variant="album" trackIds={trackIds}/>);
 const playlist=renderToStaticMarkup(<CollectionCover variant="playlist" trackIds={trackIds}/>);
 assert.doesNotMatch(album,/data-mosaic/);
 assert.equal(album.match(/collection-cover__tile/g)?.length,1);
 assert.match(playlist,/data-mosaic="true"/);
 assert.equal(playlist.match(/collection-cover__tile/g)?.length,4);
});

test('Una fila desconocida o corrupta queda aislada del resto de la lectura',async()=>{
 function response<T>(value:T):IDBRequest<T>{
  const request={result:value,onsuccess:null as (()=>void)|null};
  queueMicrotask(()=>request.onsuccess?.());
  return request as IDBRequest<T>;
 }
 const original=Object.getOwnPropertyDescriptor(globalThis,'IDBKeyRange');
 Object.defineProperty(globalThis,'IDBKeyRange',{configurable:true,value:{bound:(lower:IDBValidKey,upper:IDBValidKey)=>({lower,upper})}});
 try{
  const store={
   getAllKeys:(query:IDBKeyRange)=>{
    assert.deepEqual(query.lower,['saved-catalog-album','cuenta']);
    return response([['saved-catalog-album','cuenta',42],['saved-catalog-album','cuenta',43],['saved-catalog-album','cuenta',44]]);
   },
   getAll:()=>response([snapshot,{...snapshot,version:2},snapshot]),
  } as unknown as IDBObjectStore;
  assert.deepEqual(await readSavedAlbumsFrom(store,'cuenta'),[snapshot]);
 }finally{
  if(original)Object.defineProperty(globalThis,'IDBKeyRange',original);
  else Reflect.deleteProperty(globalThis,'IDBKeyRange');
 }
});
