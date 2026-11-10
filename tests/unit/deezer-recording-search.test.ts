import test from 'node:test';
import assert from 'node:assert/strict';
import {matchingSongRows,parseBotDownloadedAudio,type BotSearchRow} from '../../src/telegram/bot-search-protocol';
const target={title:'Synthetic song',artist:'Own artist',album:'Own album',durationSeconds:100};
const option=(label:string):BotSearchRow=>({rowRef:'00000000-0000-4000-8000-000000000001',kind:'option',correlation:'recent',label});
test('artist-first numbered menu preserves exact title, complete performer and explicit album-version context',()=>{
 for(const label of ['Own artist - Synthetic song','1. Own artist - Synthetic song (Album Version)','1 . Own artist - Synthetic song (Album Version)','Synthetic song - Own artist'])assert.equal(matchingSongRows([option(label)],target).length,1,label);
 for(const label of ['Own artist & Guest - Synthetic song (Album Version)','Own artist - Synthetic song (Live)','Own artist - Synthetic song (Remix)','Own artist - Synthetic song (Album-Version)','Own artist - Synthetic song (Album Version) (Live)','Tracks','Albums','Artists','Close'])assert.equal(matchingSongRows([option(label)],target).length,0,label);
 for(const missing of [{...target,album:null},{...target,durationSeconds:null}])assert.equal(matchingSongRows([option('Own artist - Synthetic song (Album Version)')],missing).length,0);
});
test('alias audio tightens duration to one second and ordinary recordings retain five seconds',()=>{
 const audio:BotSearchRow={rowRef:'00000000-0000-4000-8000-000000000002',kind:'audio',correlation:'recent',title:'Synthetic song (Album Version)',performer:'Own artist',durationSeconds:100.5,mimeType:'audio/mpeg',bytes:100};
 assert.equal(matchingSongRows([audio],target).length,1);
 assert.equal(matchingSongRows([{...audio,durationSeconds:101.01}],target).length,0);
 assert.equal(matchingSongRows([{...audio,title:target.title,durationSeconds:105}],target).length,1);
 assert.equal(matchingSongRows([{...audio,title:target.title,durationSeconds:105.01}],target).length,0);
});
test('downloaded alias DTO is detached, bounded and requires complete catalogue context',()=>{
 const raw={blob:new Blob(['x'],{type:'audio/mpeg'}),bytes:1,mime:'audio/mpeg',sha256:'a'.repeat(64),target,recordingTitle:'Synthetic song (Album Version)'};
 const parsed=parseBotDownloadedAudio(raw);assert.equal(parsed?.recordingTitle,raw.recordingTitle);assert.notEqual(parsed?.target,raw.target);
 for(const recordingTitle of [null,undefined,'','Other song','Synthetic song (Live)','Synthetic song (Album Version) (Remix)'])assert.equal(parseBotDownloadedAudio({...raw,recordingTitle}),null);
 for(const badTarget of [{...target,album:null},{...target,durationSeconds:null}])assert.equal(parseBotDownloadedAudio({...raw,target:badTarget}),null);
 assert.equal(parseBotDownloadedAudio({...raw,extra:true}),null);
 let getters=0;assert.equal(parseBotDownloadedAudio(Object.defineProperty({...raw},'recordingTitle',{get(){getters++;return raw.recordingTitle;}})),null);assert.equal(getters,0);
 const {recordingTitle,...plain}=raw;void recordingTitle;assert.ok(parseBotDownloadedAudio(plain));
});
