import {readRecord} from '../storage/database';
import {AUDIO_FILE_MAX_BYTES} from '../storage/audio-limits';
import {readSongAlias,songChoiceKey,type SongChoice} from './selected-song';
import {readLibraryTrackIds} from './library-membership';
import {validAudioFingerprint,verifiedAssetDetailed,type Track} from './library';

export interface SongCopyStatus {state:'available'|'missing'|'unknown';trackId:string|null;inLibrary:boolean|null}
export interface SongCopyInspection {
 current():boolean;
 /** Read-only, no playback intent, import, membership write or Telegram request. */
 inspect(choice:SongChoice,signal:AbortSignal):Promise<SongCopyStatus>;
}
const unknown=():SongCopyStatus=>({state:'unknown',trackId:null,inLibrary:null});
const live=(current:()=>boolean)=>{try{return current()===true;}catch{return false;}};
export {compatibleSongMetadata} from './selected-song';
/** Caller holds its own Activity until this promise really settles, including
 * file verification. A view abort revokes publication, never invents IO settlement. */
export async function readSongCopyStatus(choice:SongChoice,current:()=>boolean):Promise<SongCopyStatus>{
 try{
  if(!songChoiceKey(choice)||!live(current))return unknown();
  const id=await readSongAlias(choice,()=>live(current));if(!live(current))return unknown();
  if(!id)return {state:'missing',trackId:null,inLibrary:false};
  const track=await readRecord<Track>('tracks',id);if(!live(current)||!track||track.id!==id)return unknown();
  const members=await readLibraryTrackIds([id],current);if(!live(current))return unknown();
  const inLibrary=members.has(id);
  if(track.assetId===null)return {state:'missing',trackId:id,inLibrary};
  // Verification has the same small-file bound as the remote acquisition lane.
  if(!validAudioFingerprint(track.audioFingerprint)||track.audioFingerprint.bytes>AUDIO_FILE_MAX_BYTES)return {state:'unknown',trackId:id,inLibrary};
  const checked=await verifiedAssetDetailed(track.assetId,true);if(!live(current))return unknown();
  const after=await readRecord<Track>('tracks',id);if(!live(current)||!after||after.revision!==track.revision||after.assetId!==track.assetId)return unknown();
  const freshMembers=await readLibraryTrackIds([id],current);if(!live(current))return unknown();
  const member=freshMembers.has(id);
  if(checked.state==='missing')return {state:'missing',trackId:id,inLibrary:member};
  if(checked.state!=='valid'||checked.asset.sha256!==track.audioFingerprint.sha256||checked.asset.bytes!==track.audioFingerprint.bytes)return {state:'unknown',trackId:id,inLibrary:member};
  return {state:'available',trackId:id,inLibrary:member};
 }catch{return unknown();}
}
