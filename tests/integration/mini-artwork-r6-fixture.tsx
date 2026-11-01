// Own canary host; production never imports this module.
import {createRoot} from 'react-dom/client';
import {MiniArtwork} from '../../src/ui/MiniArtwork';
import {Activity} from '../../src/playback/ownership';
import {openDatabase, committed} from '../../src/storage/database';
import {setManualArtwork, readArtwork} from '../../src/library/artwork';
const root=createRoot(document.getElementById('root')!);
const activity=new Activity();activity.open();
let trackId='A',refreshToken=0,key=0;
function render(){root.render(<MiniArtwork key={key} activity={activity} trackId={trackId} title="Título adyacente" refreshToken={refreshToken}/>);}
async function seed(){
 const bytes=new Uint8Array(320044),d=new DataView(bytes.buffer),str=(o:number,s:string)=>[...s].forEach((c,i)=>d.setUint8(o+i,c.charCodeAt(0)));
 str(0,'RIFF');d.setUint32(4,bytes.length-8,true);str(8,'WAVE');str(12,'fmt ');d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);d.setUint32(24,8000,true);d.setUint32(28,16000,true);d.setUint16(32,2,true);d.setUint16(34,16,true);str(36,'data');d.setUint32(40,bytes.length-44,true);
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const asset={id:crypto.randomUUID(),namespace:'local',storageKey:crypto.randomUUID(),bytes:bytes.length,sha256,mime:'audio/wav',chunks:Math.ceil(bytes.length/65536),state:'complete',revision:1,chunkSize:65536,retention:'kept',backend:'idb'};
 const db=await openDatabase(),tx=db.transaction(['tracks','assets','chunks'],'readwrite'),done=committed(tx);
 for(const id of ['A','B','absent','hidden','corrupt','invalid','null'])tx.objectStore('tracks').put({id,assetId:id==='null'?null:asset.id,audioFingerprint:null,title:id==='A'?'Título largo '.repeat(25).slice(0,300):id,artist:'Canario propio',album:null,duration:20,favorite:false,revision:1,createdAt:new Date().toISOString(),manualOverrides:{}},id);
 tx.objectStore('assets').put(asset,asset.id);for(let i=0;i<asset.chunks;i++)tx.objectStore('chunks').put(bytes.slice(i*65536,(i+1)*65536),[asset.storageKey,i]);await done;db.close();
 for(const [id,color]of [['A','red'],['B','blue'],['corrupt','green']]){const c=document.createElement('canvas');c.width=24;c.height=16;const g=c.getContext('2d')!;g.fillStyle=color;g.fillRect(0,0,24,16);const blob=await new Promise<Blob>(r=>c.toBlob(b=>r(b!),'image/png'));await setManualArtwork(id,blob,0);}
 await setManualArtwork('hidden',null,0);
 for(const id of ['corrupt','invalid']){const a=id==='corrupt'?await readArtwork(id):await readArtwork('A');const db=await openDatabase(),tx=db.transaction('settings','readwrite'),done=committed(tx);tx.objectStore('settings').put(id==='corrupt'?{...a,blob:new Blob(['damaged'],{type:'image/png'})}:{...a,trackId:id,version:999},`artwork:v1:${id}`);await done;db.close();}
}
Object.assign(window,{miniHost:{activity,seed,render,select:(id:string)=>{trackId=id;render();},refresh:()=>{refreshToken++;render();},close:()=>{activity.close();render();},cede:()=>{activity.invalidate();render();},acquire:()=>{activity.open();key++;render();},unmount:()=>root.unmount(),tick:render}});
render();
