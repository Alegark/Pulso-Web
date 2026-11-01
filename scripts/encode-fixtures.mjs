import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const ffmpeg='node_modules/@ffmpeg-installer/linux-x64/ffmpeg';
const fixtures=[];
for(const [letter,ext,codec,mime] of [['A','mp3','libmp3lame','audio/mpeg'],['B','m4a','aac','audio/mp4'],['C','mp3','libmp3lame','audio/mpeg']]) {
 execFileSync(ffmpeg,['-y','-i',`public/fixtures/${letter}.wav`,'-codec:a',codec,...(codec==='aac'?['-profile:a','aac_low']:[]),`public/fixtures/${letter}.${ext}`],{stdio:'ignore'});
 const bytes=readFileSync(`public/fixtures/${letter}.${ext}`);
 fixtures.push({id:`fixture-${letter}`,file:`/fixtures/${letter}.${ext}`,mime,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
writeFileSync('src/fixtures.ts','import type {Fixture} from "./storage/assets";\nexport const fixtures: Fixture[] = '+JSON.stringify(fixtures,null,2)+';\n');
