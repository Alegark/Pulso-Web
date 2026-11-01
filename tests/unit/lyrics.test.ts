import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseLyrics,LyricsError,LYRICS_LIMITS as L} from '../../src/library/lyrics-parser';
const fails=(text:string,format:'plain'|'lrc',code:string)=>assert.throws(()=>parseLyrics(text,format),(e:unknown)=>e instanceof LyricsError&&e.code===code);
test('absence/plain: preserves original Unicode and inert hostile text, normalizes BOM/CRLF',()=>{
 assert.deepEqual(parseLyrics(' \r\n','plain'),{kind:'absent'});
 assert.deepEqual(parseLyrics('\uFEFFniño 😀\r\n<script>javascript:alert(1)</script>\rfin','plain'),{kind:'plain',text:'niño 😀\n<script>javascript:alert(1)</script>\nfin'});
});
test('LRC multiple explicit times, stable ordering, metadata and signed offset',()=>{
 const r=parseLyrics('[ti:Original]\r\n[offset:-250]\r\n[00:02.5][00:01.250]ñ\r\n[00:01.250]eco','lrc');
 assert.equal(r.kind,'timed');if(r.kind!=='timed')return;
 assert.deepEqual(r.cues,[{timeMs:1000,text:'ñ'},{timeMs:1000,text:'eco'},{timeMs:2250,text:'ñ'}]);assert.equal(r.offsetMs,-250);
});
test('no inferred sync or silent truncation',()=>{
 for(const t of ['palabras','[00:01','[00:01]a\n[00:','[ti:Solo metadata]'])assert.throws(()=>parseLyrics(t,'lrc'),LyricsError);
 assert.deepEqual(parseLyrics('[00:01]literal','plain'),{kind:'plain',text:'[00:01]literal'});
});
test('invalid timestamps and offset are actionable',()=>{
 for(const t of ['[00:60]a','[1441:00]a','[00:01.1234]a','[00:01]a\n[offset:-1001]'])fails(t,'lrc','timestamp');
 for(const t of ['[offset:600001]\n[00:01]a','[offset:1]\n[offset:2]\n[00:01]a','[offset:abc]\n[00:01]a'])fails(t,'lrc','offset');
});
test('size/lines/line/cue budgets checked without truncation',()=>{
 fails('a'.repeat(L.bytes+1),'plain','size');fails('😀'.repeat(32769),'plain','size');
 fails('\n'.repeat(L.lines),'plain','lines');fails('a'.repeat(L.lineCharacters+1),'plain','line-size');
 assert.equal(parseLyrics('a'.repeat(L.lineCharacters),'plain').kind,'plain');
 fails('[00:01]'.repeat(17)+'a','lrc','cues');
 fails(('[00:01][00:02]a\n').repeat(2001).trimEnd(),'lrc','cues');
 assert.equal(parseLyrics(('[00:01]a\n').repeat(4000).trimEnd(),'lrc').kind,'timed');
});
test('reject invalid Unicode/control, keep combining Unicode intact',()=>{
 for(const t of ['\ud800','\udc00','a\0b','\u007f'])fails(t,'plain','unicode');
 assert.deepEqual(parseLyrics('e\u0301\tñ','plain'),{kind:'plain',text:'e\u0301\tñ'});
});
