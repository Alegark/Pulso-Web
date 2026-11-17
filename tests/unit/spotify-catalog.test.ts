import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Track} from '../../src/library/library';
import {copyCatalogRelease,displayTrackAlbum} from '../../src/library/catalog-release';
import {validateTrack} from '../../src/library/local-copy-removal-snapshot';
import {groupAlbums} from '../../src/library/groups';
import {matchSpotifyCatalogRelease} from '../../src/playlists/spotify-catalog';

const track:Track={id:'11111111-1111-4111-8111-111111111111',title:'Canción',artist:'Artista, Invitada',album:null,duration:180,
 assetId:null,revision:1,createdAt:'2026-01-01',favorite:false,manualOverrides:{}};
const appleCover='https://is1-ssl.mzstatic.com/image/100x100bb.jpg';
const spotifyCover='https://image-cdn-fa.spotifycdn.com/image/'+'0'.repeat(40);
const exact={source:'spotify' as const,releaseId:'x'.repeat(22),trackId:'y'.repeat(22),position:2,title:'Álbum',artist:'Artista',artworkUrl:spotifyCover};
const item={wrapperType:'track',kind:'song',collectionId:21,trackId:42,discNumber:1,trackNumber:2,trackName:'Canción',
 artistName:'Artista & Invitada',collectionName:'Álbum',trackTimeMillis:181000,artworkUrl100:appleCover};
const rows=(...results:unknown[])=>({resultCount:results.length,results});

test('Buscar matches only the same recording and a single compatible release',()=>{
 assert.equal(matchSpotifyCatalogRelease(track,rows(item))?.trackId,42);
 assert.equal(matchSpotifyCatalogRelease(track,rows(item,{...item,trackId:43,collectionId:22,collectionName:'Otra edición'})),null);
 assert.equal(matchSpotifyCatalogRelease(track,rows(item,{...item,trackId:43,collectionId:22,collectionName:'Otra edición'}),exact)?.releaseId,21);
 assert.equal(matchSpotifyCatalogRelease(track,rows({...item,artistName:'Artista'}),exact),null);
 assert.equal(matchSpotifyCatalogRelease(track,rows({...item,trackTimeMillis:173000}),exact),null);
 assert.equal(matchSpotifyCatalogRelease(track,rows({...item,trackName:'Canción (En vivo)'}),exact),null);
 assert.equal(matchSpotifyCatalogRelease(track,rows({...item,trackNumber:3}),exact),null);
 assert.equal(matchSpotifyCatalogRelease({...track,album:'Mi edición',manualOverrides:{album:'Mi edición'}},rows(item)),null);
 assert.equal(matchSpotifyCatalogRelease(track,rows(...Array(200).fill(item))),null);
});

test('a verified Apple bridge joins an existing Buscar album without collapsing conflicting editions',()=>{
 const fromSpotify={...track,catalogRelease:{...exact,itunesReleaseId:21}};
 const fromSearch:Track={...track,id:'22222222-2222-4222-8222-222222222222',album:'Álbum',catalogChoice:
  {source:'itunes',id:'itunes:21:1:1:55',artist:'Artista',album:'Álbum',title:'Otra canción',duration:180}};
 const group=groupAlbums([fromSearch,fromSpotify]);
 assert.equal(group.length,1);assert.deepEqual(group[0].trackIds,[fromSearch.id,track.id]);
 assert.equal(displayTrackAlbum(fromSpotify),'Álbum');
 assert.equal(displayTrackAlbum({...fromSpotify,album:null,manualOverrides:{album:null}}),null);
 const differentEdition={...fromSpotify,id:'33333333-3333-4333-8333-333333333333',catalogRelease:{...exact,releaseId:'s'.repeat(22),itunesReleaseId:21}};
 assert.equal(groupAlbums([fromSearch,fromSpotify,differentEdition]).length,3);
 assert.equal(copyCatalogRelease({...exact,artworkUrl:spotifyCover+'?secret=yes'}),null);
 assert.equal(copyCatalogRelease({...exact,artworkUrl:appleCover}),null);
 assert.equal(copyCatalogRelease({...exact,itunesReleaseId:21,artworkUrl:appleCover})?.artworkUrl,appleCover);
});

test('a metadata-only Spotify row with unknown duration does not block playlist or copy removal',()=>{
 const pending={...track,duration:0};
 assert.deepEqual(validateTrack(pending,pending.id),pending);
 assert.throws(()=>validateTrack({...pending,assetId:'22222222-2222-4222-8222-222222222222'},pending.id));
});
