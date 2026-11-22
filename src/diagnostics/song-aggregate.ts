import {songTimeKeys,type SongAggregate,type SongRejection} from './contract';
import {elapsedMs,type NetworkTiming} from './download-timing';
import {appDiagnosticSession,type DiagnosticSession} from './session';

export function beginSongAggregate(session:DiagnosticSession=appDiagnosticSession){
 const songSeq=session.beginSong();if(songSeq===undefined)return;
 const start=performance.now(),current=session.scope(),bots=new Set<number>();
 const rejections:Partial<Record<SongRejection,number>>={};
 const times=Object.fromEntries(songTimeKeys.map(key=>[key,0])) as Pick<SongAggregate,typeof songTimeKeys[number]>;
 const values:SongAggregate={...times,songSeq,botsTried:0,winningBotSlot:null,flow:'none',candidatesTried:0,candidatesDownloaded:0,candidatesRejected:0,timeoutCount:0,rejections};
 let finished=false;
 return {
  values,
  bot(slot:number){bots.add(slot);values.botsTried=bots.size;},
  candidate(menu:boolean){values.candidatesTried++;if(menu||values.flow==='none')values.flow=menu?'callback-menu':'direct-audio';},
  rejection(reason:SongRejection,ms=0){
   rejections[reason]=(rejections[reason]??0)+1;
   if(reason==='timeout'){values.timeoutCount++;values.timeoutMs+=ms;}
  },
  network(timing:Readonly<NetworkTiming>){
   for(const key of ['firstBotReplyMs','searchPollMs','callbackPollMs','transferMs'] as const)values[key]+=timing[key]??0;
  },
  finish(){
   if(finished||!current())return;
   finished=true;
   values.totalMs=elapsedMs(start);
   session.recordSong(values);
  },
 };
}
export type SongMeasurement=ReturnType<typeof beginSongAggregate>;
