import React from "react";
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {albumRemovalMembership,copySavedAlbum,libraryAlbumCards,resolvedAlbumTracks,readSavedAlbumsFrom,savedAlbumGroupKey} from '../../src/library/saved-albums';
import {createSongResolver,readSongAliasesFrom,songChoiceKey} from '../../src/library/selected-song';
import {groupStorageDownloads} from "../../src/library/storage-groups";
import {indexCopyProtection} from '../../src/library/listening-cache';
import type {LocalAsset} from "../../src/library/library";
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
  {...snapshot,version:2},{...snapshot,savedAt:'ayer'},{...snapshot,edition:{...snapshot.edition,title:'Álbum\u0001'}},
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
 const partial=resolvedAlbumTracks(album,createSongResolver([other,copies[0],copies[2]]));
 assert.deepEqual(partial.map(row=>row.trackId),['local-1',null,null,'local-4']);
 assert.deepEqual(resolvedAlbumTracks(album,createSongResolver(copies)).map(row=>row.trackId),['local-1','local-2','local-3','local-4']);
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

test('MusicBrainz conserva la URL de la misma edición y acepta espacios válidos del catálogo',()=>{
 const id='musicbrainz:11111111-1111-4111-8111-111111111111';
 const recording='musicbrainz:22222222-2222-4222-8222-222222222222';
 const artworkUrl='/catalog/musicbrainz/artwork?id='+id.slice(12);
 const origin='https://pulso.test';
 const previous=Object.getOwnPropertyDescriptor(globalThis,'location');
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin}});
 try{
  const record={...snapshot,edition:{...snapshot.edition,id,trackCount:1,title:'Título\nválido',artworkUrl},
   tracks:[{...tracks[0],releaseId:id,trackId:recording,title:'Pista\tválida'}]};
  const copied=copySavedAlbum(record,id);
  assert.equal(copied?.edition.artworkUrl,origin+artworkUrl);
  assert.equal(copied.tracks[0].title,'Pista\tválida');
  assert.equal(libraryAlbumCards([{
   ...local(1),album:' ',catalogRelease:undefined,
   catalogChoice:{id:'musicbrainz:'+id.slice(12)+':1:1:'+recording.slice(12),source:'musicbrainz',
    title:'Pista',artist:'Artista',album:'Título',duration:45},
  }],[])[0]?.editionId,id);
  assert.equal(copySavedAlbum({...record,edition:{...record.edition,artworkUrl:artworkUrl.replace(id.slice(12),recording.slice(12))}},id),null);
 }finally{
  if(previous)Object.defineProperty(globalThis,'location',previous);else Reflect.deleteProperty(globalThis,'location');
 }
});

test('Los alias válidos conservan la edición anterior y respetan las correcciones manuales',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const fingerprint={sha256:'a'.repeat(64),bytes:123};
 const choice={id:'itunes:42:1:1:81',source:'itunes' as const,title:'Pista 1',artist:'Artista',album:'Álbum',duration:45};
 const track:Track={...local(1,43),id,audioFingerprint:{algorithm:'sha256',...fingerprint}};
 const key=songChoiceKey(choice)!;
 const aliases=new Map([[key,{...fingerprint,key,trackId:id,version:1}]]);
 assert.equal(createSongResolver([track],aliases)(choice),id);
 for(const edited of [{title:'Otra canción'},{artist:'Otro intérprete'},{album:'Otra edición'}]){
  const correction={...track,...edited,manualOverrides:edited};
  assert.equal(createSongResolver([correction],aliases)(choice),null);
 }
 assert.equal(createSongResolver([{...track,title:'Otra canción',manualOverrides:{title:'Otra canción'}}])(choice),null);
 assert.equal(createSongResolver([{...local(1),album:'Otra edición',title:'Otro título'}])(choice),null);
});

test('Almacenamiento muestra la copia Spotify asociada por alias en el álbum guardado',()=>{
 const album=copySavedAlbum(snapshot)!;
 const id='11111111-1111-4111-8111-111111111111';
 const fingerprint={sha256:'b'.repeat(64),bytes:123};
 const track:Track={...local(1),id,audioFingerprint:{algorithm:'sha256',...fingerprint},
  catalogRelease:{source:'spotify',releaseId:'A'.repeat(22),trackId:'B'.repeat(22),itunesReleaseId:42,position:1,title:'Álbum',artist:'Artista'}};
 const key=songChoiceKey({id:'itunes:42:1:1:81',source:'itunes',title:'Pista 1',artist:'Artista',album:'Álbum',duration:45})!;
 const aliases=new Map([[key,{...fingerprint,key,trackId:id,version:1}]]);
 const groups=groupStorageDownloads([track],[],[{id:track.assetId,bytes:123} as LocalAsset],[album],aliases);
 assert.deepEqual(groups.map(group=>[group.id,group.trackIds]),[['album:'+savedAlbumGroupKey(42),[id]]]);
});


test('Retirar una edición conserva la pertenencia y la copia que completa otra edición',()=>{
 const albumA=copySavedAlbum({...snapshot,edition:{...snapshot.edition,trackCount:1},tracks:[tracks[0]]})!;
 const albumB=copySavedAlbum({...albumA,edition:{...albumA.edition,id:99,title:'Álbum deluxe'},
  tracks:[{...albumA.tracks[0],releaseId:99}]})!;
 const id='11111111-1111-4111-8111-111111111111';
 const fingerprint={sha256:'a'.repeat(64),bytes:123};
 const track:Track={...local(1),id,audioFingerprint:{algorithm:'sha256',...fingerprint}};
 const key=songChoiceKey({id:'itunes:99:1:1:81',source:'itunes',title:'Pista 1',artist:'Artista',album:'Álbum deluxe',duration:45})!;
 const aliases=new Map([[key,{...fingerprint,key,trackId:id,version:1}]]);
 const cards=libraryAlbumCards([track],[albumA,albumB],aliases);
 const removal=albumRemovalMembership(cards,savedAlbumGroupKey(42));
 assert.deepEqual(removal.selected?.trackIds,[id]);
 assert.deepEqual([...removal.otherSavedTrackIds],[id]);
 assert.deepEqual(removal.detach,[]);
 const asset={id:track.assetId,...fingerprint} as LocalAsset;
 const protectsOtherAlbum=indexCopyProtection([track],row=>removal.otherSavedTrackIds.has(row.id));
 assert.equal(protectsOtherAlbum(asset),true);
 assert.deepEqual([asset].filter(protectsOtherAlbum).map(copy=>copy.bytes),[123]);
 const remaining=libraryAlbumCards([track],[albumB],aliases);
 assert.deepEqual(remaining.map(card=>[card.count,card.trackIds]),[[1,[id]]]);
});


test('Las pistas en caché compartidas entre álbumes guardados permanecen protegidas',()=>{
 const albumA=copySavedAlbum({...snapshot,edition:{...snapshot.edition,trackCount:1},tracks:[tracks[0]]})!;
 const albumB=copySavedAlbum({...albumA,edition:{...albumA.edition,id:99,title:'Álbum deluxe'},tracks:[{...albumA.tracks[0],releaseId:99}]})!;
 const id='11111111-1111-4111-8111-111111111111';
 const fingerprint={sha256:'a'.repeat(64),bytes:123};
 const track:Track={...local(1),id,audioFingerprint:{algorithm:'sha256',...fingerprint}};
 const key=songChoiceKey({id:'itunes:99:1:1:81',source:'itunes',title:'Pista 1',artist:'Artista',album:'Álbum deluxe',duration:45})!;
 const aliases=new Map([[key,{...fingerprint,key,trackId:id,version:1}]]);
 const shared=albumRemovalMembership(libraryAlbumCards([],[albumA,albumB],aliases,[track]),savedAlbumGroupKey(42));
 assert.ok(shared.selected?.saved);
 assert.deepEqual(shared.selected.coverTrackIds,[id]);
 const groups=groupStorageDownloads([track],[],[{id:track.assetId,bytes:123} as LocalAsset],[albumA],aliases,new Set());
 assert.deepEqual(groups.map(group=>[group.kind,group.trackIds]),[['album',[id]]]);
 assert.deepEqual([...shared.otherSavedTrackIds],[id]);
 assert.deepEqual(shared.detach,[]);
 const exclusive=albumRemovalMembership(libraryAlbumCards([],[albumA],aliases,[track]),savedAlbumGroupKey(42));
 assert.equal(exclusive.otherSavedTrackIds.size,0);
 assert.ok(exclusive.selected?.saved);
 assert.deepEqual(exclusive.selected.coverTrackIds,[id]);
});

test('Al superar la cota de alias se descarta la lectura completa y no se resuelve por etiquetas',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'IDBKeyRange');
 Object.defineProperty(globalThis,'IDBKeyRange',{configurable:true,value:{bound:()=>({})}});
 try{
  const response=(count:number,values:unknown[])=>{
   assert.equal(count,2001);
   const request={result:values,onsuccess:null as (()=>void)|null};
   queueMicrotask(()=>request.onsuccess?.());
   return request;
  };
  const rows=Array.from({length:2001},(_,index)=>index);
  const store={getAllKeys:(_:unknown,count:number)=>response(count,rows),getAll:(_:unknown,count:number)=>response(count,rows)} as unknown as IDBObjectStore;
  await assert.rejects(readSongAliasesFrom(store),/song-alias-limit/);
  const choice={id:'itunes:42:1:1:81',source:'itunes' as const,title:'Pista 1',artist:'Artista',album:'Álbum',duration:45};
  assert.equal(createSongResolver([local(1)],null)(choice),null);
 }finally{
  if(previous)Object.defineProperty(globalThis,'IDBKeyRange',previous);else Reflect.deleteProperty(globalThis,'IDBKeyRange');
 }
});
