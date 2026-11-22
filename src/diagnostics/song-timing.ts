import {appDiagnosticSession} from './session';
import {elapsedMs,networkTimingKeys,emptyImportTiming,emptyNetworkTiming,type DownloadResult,type DownloadTiming,type NetworkTiming} from './download-timing';
import type {BotDownloadedAudio} from '../telegram/bot-search-protocol';

const received=new WeakMap<BotDownloadedAudio,NonNullable<ReturnType<typeof beginSongTiming>>>();
export function beginSongTiming(){
 if(!appDiagnosticSession.getSnapshot().enabled)return;
 const current=appDiagnosticSession.scope(),start=performance.now();
 const values:DownloadTiming={...emptyNetworkTiming(),...emptyImportTiming(),totalMs:0,waitMs:0,refreshMs:0,kBps:0,result:'failed'};
 let previous:Readonly<DownloadTiming>|undefined;
 const record={
  values,current,
  search(timing:Readonly<NetworkTiming>){Object.assign(values,legacy(timing));},
  download(timing:Readonly<NetworkTiming>){Object.assign(values,legacy(timing),{resolveMs:values.resolveMs+timing.resolveMs,sendMs:values.sendMs,searchPollMs:values.searchPollMs,searchReads:values.searchReads});},
  finish(result:DownloadResult){
   if(!current())return;
   values.kBps=values.transferMs?Math.round(values.bytes/values.transferMs):0;
   values.totalMs=elapsedMs(start);values.result=result;
   previous=appDiagnosticSession.recordDownload(values,previous);
  },
  attach(audio:BotDownloadedAudio){if(current())received.set(audio,record);},
 };
 return record;
}
export const songTiming=(audio:BotDownloadedAudio)=>received.get(audio);

const legacy=(timing:Readonly<NetworkTiming>)=>Object.fromEntries(networkTimingKeys.map(key=>[key,timing[key]]));
