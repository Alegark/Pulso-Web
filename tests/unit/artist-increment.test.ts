import {test} from 'node:test'
import {strict as assert} from 'node:assert'
import {AlbumCatalog} from '../../src/library/album-catalog'
const request=()=>({signal:new AbortController().signal,current:()=>true})
test('artist search returns closed ID DTOs and separates homonyms',async()=>{
 const catalog=new AlbumCatalog(async url=>{const u=new URL(String(url));assert.equal(u.searchParams.get('entity'),'musicArtist');assert.equal(u.searchParams.get('country'),'US');return Response.json({resultCount:2,results:[{wrapperType:'artist',artistId:1,artistName:'Same',artistLinkUrl:'ignored'},{wrapperType:'artist',artistId:2,artistName:'Same'}]})})
 const result=await catalog.searchArtists('Same',request());assert.equal(result.ok,true);if(result.ok)assert.deepEqual(result.value,[{id:1,name:'Same'},{id:2,name:'Same'}])
 assert.deepEqual(await catalog.searchArtists('',request()),{ok:false,reason:'invalid'})
})
test('artist lookup rejects mismatched artist ID and stale requests without extra IO',async()=>{
 let calls=0;const catalog=new AlbumCatalog(async url=>{calls++;assert.equal(new URL(String(url)).searchParams.get('entity'),'album');return Response.json({resultCount:1,results:[{wrapperType:'artist',artistId:99,artistName:'Same'}]})})
 assert.deepEqual(await catalog.artistAlbums(1,{...request(),current:()=>false}),{ok:false,reason:'cancelled'});assert.equal(calls,0)
 assert.deepEqual(await catalog.artistAlbums(1,request()),{ok:false,reason:'invalid'})
})
test('artist albums retain associated releases with different primary credits',async()=>{
 const results=[{wrapperType:'artist',artistId:1,artistName:'Requested'},
  {wrapperType:'collection',collectionType:'Album',collectionId:10,collectionName:'Own album',artistId:1,artistName:'Requested',trackCount:3},
  {wrapperType:'collection',collectionType:'Album',collectionId:20,collectionName:'Shared release',artistId:2,artistName:'Guest, Requested',trackCount:2}]
 let calls=0;const catalog=new AlbumCatalog(async()=>{calls++;return Response.json({resultCount:results.length,results})})
 const value=await catalog.artistAlbums(1,request());assert.equal(value.ok,true)
 if(value.ok)assert.deepEqual(value.value.map(row=>[row.id,row.artist]),[[10,'Requested'],[20,'Guest, Requested']])
 assert.deepEqual(await catalog.artistAlbums(1,request()),value);assert.equal(calls,1)
})
test('artist lookup keeps rejecting malformed credit identities and duplicate editions',async()=>{
 const artist={wrapperType:'artist',artistId:1,artistName:'Requested'}
 const album={wrapperType:'collection',collectionType:'Album',collectionId:10,collectionName:'Album',artistId:2,artistName:'Guest, Requested',trackCount:3}
 for(const albums of [[{...album,artistId:null}],[album,{...album,artistId:3}]]){
  const results=[artist,...albums],catalog=new AlbumCatalog(async()=>Response.json({resultCount:results.length,results}))
  assert.deepEqual(await catalog.artistAlbums(1,request()),{ok:false,reason:'invalid'})
 }
})
