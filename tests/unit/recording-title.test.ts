import test from 'node:test';
import assert from 'node:assert/strict';
import {collaboratorRecordingMatch as match} from '../../src/library/recording-title';
import {expectedAudioTagMismatch} from '../../src/imports/expected-audio-metadata';
import {botOptionDurationMismatch,matchingSongRows,type BotSearchRow} from '../../src/telegram/bot-search-protocol';
const target={title:'Get Lucky',artist:'Daft Punk, Pharrell Williams & Nile Rodgers',album:'Random Access Memories',durationSeconds:369.629};
const option=(label:string):BotSearchRow=>({kind:'option',rowRef:'test',correlation:'reply',label});
test('D01 collaborator credits preserve version and complete performer identity',()=>{
 const good=['Get Lucky (feat. Pharrell Williams and Nile Rodgers) — Daft Punk & Pharrell Williams & Nile Rodgers','Get Lucky feat. Pharrell Williams and Nile Rodgers — Daft Punk','2. Daft Punk - Get Lucky (feat. Pharrell Williams and Nile Rodgers)','7. Daft Punk - Get Lucky (feat. Pharrell Williams and Nile Rodgers)'];
 for(const label of good)assert.equal(matchingSongRows([option(label)],target).length,1,label);
 const bad=['• 4:09 • Get Lucky (feat. Pharrell Williams & Nile Rodgers) — Daft Punk','Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers) — Daft Punk & Pharrell Williams & Nile Rodgers','1. Daft Punk - Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers)','3. Daft Punk - Get Lucky (Daft Punk Remix)','4. Daft Punk - Get Lucky (Drumless Edition) (ft. Pharrell Williams and Nile Rodgers)','Get Lucky Trailer (Long Version) @ Coachella ...','Get Lucky (Single Version - Originally Performed By Daft Punk) — A.C.T','Get Lucky — Flash Mob Jazz','Get Lucky (Karaoke Version) — Daft Punk','Get Lucky (Live) — Daft Punk','Get Lucky (Cover) — Daft Punk'];
 for(const label of bad.slice(1))assert.equal(matchingSongRows([option(label)],target).length,0,label);
 assert.equal(botOptionDurationMismatch(option(bad[0]),target),true);
 for(const feat of ['feat.','ft.','featuring'])assert(match(`Get Lucky (${feat} Pharrell Williams & Nile Rodgers)`,'Daft Punk',target.title,target.artist,target.album,target.durationSeconds));
 assert(!match('Get Lucky (feat. Pharrell & Nile Rodgers)','Daft Punk',target.title,target.artist,target.album,target.durationSeconds));
 assert(!match('Get Lucky (feat. Daft Punk & Pharrell Williams)','Nile Rodgers',target.title,target.artist,target.album,target.durationSeconds));
 assert.equal(expectedAudioTagMismatch({title:'Get Lucky (feat. Pharrell Williams & Nile Rodgers)',artist:'Daft Punk'},target,369.629),null);
 assert.equal(expectedAudioTagMismatch({title:'Get Lucky (feat. Pharrell Williams & Nile Rodgers)',artist:'Daft Punk'},target,249),'title');
});
