import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const uuid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111';
export const accountId='11111111-1111-4111-8111-111111111111';
export const bots=['kdmusic_bot','deezermusicbot','lydbot'].map((username,index)=>({
 username,label:username,id:101+index,low:3,high:101+index,
}));
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

const songs=[
 ['Luz de estación','Vera Sol'],
 ['Días sin prisa','Elías Sur','preexisting'],
 ['A través del río','Sara Montes','bot-2'],
 ['Cielo de papel','Luna Norte','bot-3'],
 ['Bajo las acacias','Jardín Azul','corrupt-same-bot'],
 ['Último andén','Vera Sol','empty-next-bot'],
 ['Mapa del silencio','Bruma','truncated-next-bot'],
 ['Vuelvo a casa','Elías Sur','wrong-live'],
 ['Sábado lunar','Luna Norte','wrong-remix'],
 ['Pequeñas órbitas','Bruma','wrong-artist'],
 ['Respira (feat. Inés Mar)','Vera Sol feat. Inés Mar','menu'],
 ['Otra manera de ver','Jardín Azul','menu'],
 ['Faro de niebla','Sara Montes','mp3'],
 ['Rosas del sur','Elías Sur','m4a'],
 ['Sin perder el norte','Vera Sol','flood'],
 ['Horas de agua','Bruma','network'],
 ['La primera lluvia','Jardín Azul','write'],
 ['Algo de sal','Sara Montes'],
 ['Canción del viento (versión acústica)','Luna Norte'],
 ['Donde las nubes bajan despacio y las luces de la ciudad se reflejan en el río antes del amanecer','Elías Sur','long-title'],
 ['Cinco minutos más','Bruma'],
 ['Temblor de verano','Sara Montes','bot-2'],
 ['Abril no termina','Luna Norte','bot-3'],
 ['Los días de colores','Jardín Azul'],
 ['Paréntesis (para dos)','Vera Sol'],
 ['Estrellas en el patio','Bruma'],
 ['Árboles de cobre','Elías Sur'],
 ['Salgo hacia el mar','Vera Sol','wrong-duration'],
 ['Después de la tormenta','Sara Montes'],
];
const mp3=readFileSync(new URL('../../public/fixtures/A.mp3',import.meta.url));
const m4a=readFileSync(new URL('../../public/fixtures/B.m4a',import.meta.url));

function wav(seed,large=false){
 const sampleRate=large?48000:8000,channels=large?2:1,duration=large?3:2;
 const block=channels*2,bytes=Buffer.alloc(44+sampleRate*block*duration);
 bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);
 bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(channels,22);bytes.writeUInt32LE(sampleRate,24);
 bytes.writeUInt32LE(sampleRate*block,28);bytes.writeUInt16LE(block,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);
 bytes.writeUInt32LE(bytes.length-44,40);
 for(let at=44;at<bytes.length;at+=2)bytes.writeInt16LE(Math.round(2000*Math.sin((at-44)/2*(0.04+seed*0.003))),at);
 return bytes;
}

export function playlistFixture(mode){
 const short=mode==='missing'||mode==='stale-checkpoint';
 const source=short?[...songs.slice(0,4),['Avenida de cristal','Iria Río','missing'],...songs.slice(5,10)]:songs;
 const candidates=new Map(),replies=new Map();
 const tracks=source.map(([title,artist,scenario='normal'],index)=>{
  const track={id:uuid(index+1),title,artist,album:null,duration:2,favorite:false,inLibrary:true,
   createdAt:'2026-11-19T00:00:00Z',localAlbum:null,catalog:null};
  const large=['network','truncated-next-bot'].includes(scenario);
  const bytes=scenario==='mp3'?mp3:scenario==='m4a'?m4a:wav(index+1,large);
  const mime=scenario==='mp3'?'audio/mpeg':scenario==='m4a'?'audio/mp4':'audio/wav';
  track.duration=large?3:mime==='audio/wav'?2:4;
  const candidate=(variant,payload,override={},fault=null)=>{
   const key=(index+1)*10+variant;
   const descriptor={key,title,artist,duration:track.duration,mime,bytes:payload.length,...override};
   candidates.set(key,{trackId:track.id,payload,fault});
   return descriptor;
  };
  const good=candidate(1,bytes,{},scenario==='network'||scenario==='flood'?scenario:null);
  const bad=(fault,payload=bytes)=>candidate(2,payload,{},fault);
  const reply={audio:[good]},empty={audio:[]};
  const plan=[reply,empty,empty];
  const version=(suffix,override={})=>candidate(2,wav(100+index),{title:title+suffix,...override});
  switch(scenario){
   case 'missing':plan[0]=empty;break;
   case 'bot-2':plan.splice(0,2,empty,reply);break;
   case 'bot-3':plan.splice(0,3,empty,empty,reply);break;
   case 'corrupt-same-bot':plan[0]={audio:[bad('corrupt',Buffer.alloc(bytes.length)),good]};break;
   case 'empty-next-bot':plan.splice(0,2,{audio:[bad('empty')]},reply);break;
   case 'truncated-next-bot':plan.splice(0,2,{audio:[bad('truncated')]},reply);break;
   case 'wrong-live':plan[0]={audio:[version(' (Live)'),good]};break;
   case 'wrong-remix':plan[0]={audio:[version(' (Remix)'),good]};break;
   case 'wrong-artist':plan[0]={audio:[version('',{artist:'Otro intérprete'}),good]};break;
   case 'wrong-duration':plan[0]={audio:[version('',{duration:180}),good]};break;
   case 'menu':{
    const live=version(' (Live)');
    plan[0]={audio:[],menu:[
     {label:`1. ${artist} - ${live.title}`,audio:live},
     {label:`2. ${artist} - ${title} (0:02)`,audio:good},
     {label:'3. Otra artista - Otra canción',audio:good},
    ]};
    break;
   }
  }
  replies.set(title+' '+artist,{trackId:track.id,plan});
  return {track,scenario,expected:scenario==='missing'?null:{bytes:bytes.length,sha256:digest(bytes),mime},goodKey:good.key};
 });
 const entries=tracks.map(({track})=>track.id);
 if(!short)entries.splice(23,0,tracks[0].track.id);
 return {tracks,entries,replies,candidates};
}
