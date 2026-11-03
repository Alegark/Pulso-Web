/** TESTONLY pre-MAIN importer entry. Native IDB/OPFS, actual import algorithm.
 * Runs in its own realm before MAIN: no product guards or capabilities replaced. */
import {importFileDetailed} from '../../../src/imports/import-file';
import {editTrack,createPlaylist,changePlaylist} from '../../../src/library/library';
export async function seed(){
 const tracks=[];
 for(const [i,name] of ['tone.wav','tone.mp3'].entries()){
  const bytes=await(await fetch('/__musicflow/'+name)).arrayBuffer();
  const r=await importFileDetailed(new File([bytes],name,{type:i?'audio/mpeg':'audio/wav'}),new AbortController().signal,()=>{},{backend:i?'opfs':'idb'});
  if(r.kind!=='confirmed')throw Error('MUSIC_FLOW importer not confirmed '+JSON.stringify(r.outcome));
  await editTrack(r.result.track.id,r.result.track.revision,{title:i?'MUSIC_FLOW Alternate':'MUSIC_FLOW Song (Live version)',artist:'MUSIC_FLOW Artist',album:i?null:'MUSIC_FLOW Album'});
  tracks.push(r.result.track.id);
 }
 let p=await createPlaylist('MUSIC_FLOW own audio');for(const id of tracks){await changePlaylist(p.id,p.revision,{type:'add',trackId:id});p={...p,revision:p.revision+1};}
 return {tracks,entry:'actual importFileDetailed IDB+OPFS, then metadata API; no device picker'};
}
