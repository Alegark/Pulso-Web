import test from 'node:test';import assert from 'node:assert/strict';
import {compatibleSongMetadata} from '../../src/library/song-copy-status';
import type {Track} from '../../src/library/library';
import type {SongChoice} from '../../src/library/selected-song';
const choice:SongChoice={id:'itunes:1:1:1:2',source:'itunes',title:'Own song (Live)',artist:'Own Artist',album:'Own album',duration:100};
const track:Track={id:'00000000-0000-4000-8000-000000000001',assetId:null,audioFingerprint:{algorithm:'sha256',sha256:'a'.repeat(64),bytes:300},title:'Own song (Live)',artist:'Own Artist; Guest',album:'Own album',duration:104,favorite:false,revision:1,createdAt:'2026-11-08',manualOverrides:{}};
test('album metadata can identify a detached library track independently of physical availability',()=>{assert.equal(compatibleSongMetadata(track,choice),true);assert.equal(compatibleSongMetadata({...track,assetId:'00000000-0000-4000-8000-000000000002'},choice),true);});
test('badge matching never selects unknown performers, different versions, or imprecise duration',()=>{for(const delta of [{artist:null},{artist:'Other Artist'},{title:'Own song (Remix)'},{duration:106},{audioFingerprint:null}])assert.equal(compatibleSongMetadata({...track,...delta},choice),false);assert.equal(compatibleSongMetadata(track,{...choice,duration:null}),false);});

test('primary bot search artist cannot substitute a different full credit during inspection',()=>{
 const credited={...choice,artist:'Own Artist; Other Artist',searchArtist:'Own Artist'};
 assert.equal(compatibleSongMetadata({...track,artist:'Own Artist'},credited),false);
 assert.equal(compatibleSongMetadata({...track,artist:'Own Artist; Other Artist'},credited),true);
});
