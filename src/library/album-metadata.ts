/** File declarations only; neither musical authenticity nor collection completeness. */
export interface Ordinal {current:number|null;total:number|null}
export type UnknownReason='legacy'|'absent'|'not-inspected'|'omitted'|'invalid'|'conflict';
export interface EmbeddedEvidence {kind:'embedded-id3'|'embedded-riff-id3'|'embedded-mp4';tag:'TRCK'|'TPOS'|'TPE2'|'TCMP'|'trkn'|'disk'|'aART'|'cpil'}
export type SourceSlot<T>={state:'known';value:T;evidence:EmbeddedEvidence}|{state:'unknown';reason:UnknownReason};
export interface LocalAlbumMetadataV1 {version:1;source:{track:SourceSlot<Ordinal>;disc:SourceSlot<Ordinal>;albumArtist:SourceSlot<string>;compilation:SourceSlot<boolean>}}
const fields=['track','disc','albumArtist','compilation'] as const;
const tags={track:['TRCK','trkn'],disc:['TPOS','disk'],albumArtist:['TPE2','aART'],compilation:['TCMP','cpil']} as const;
export const unknownSlot=(reason:UnknownReason):{state:'unknown';reason:UnknownReason}=>({state:'unknown',reason});
export function unknownLocalAlbum(reason:UnknownReason):LocalAlbumMetadataV1 {return {version:1,source:{track:unknownSlot(reason),disc:unknownSlot(reason),albumArtist:unknownSlot(reason),compilation:unknownSlot(reason)}};}
function data(value:unknown,keys:readonly string[]):Record<string,unknown>|null {
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return null;
 // Reject ordinary oversized corrupt records before materializing a key list.
 let count=0;for(const key in value){if(!Object.hasOwn(value,key))continue;if(++count>keys.length||!keys.includes(key))return null;}
 // JS has no bounded iterator for nonenumerable/symbol keys. This final exact-shape
 // check is not a heap guarantee for arbitrary objects; 4KiB bounds accepted JSON.
 if(Reflect.ownKeys(value).length!==keys.length)return null;
 const result:Record<string,unknown>={};
 for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!('value'in d))return null;result[key]=d.value;}return result;
}
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=1&&n<=65535;
export function copyOrdinal(value:unknown):Ordinal|null {
 const o=data(value,['current','total']);if(!o||!(o.current===null||positive(o.current))||!(o.total===null||positive(o.total))||o.current===null&&o.total===null||typeof o.current==='number'&&typeof o.total==='number'&&o.total<o.current)return null;
 return {current:o.current as number|null,total:o.total as number|null};
}
/** Strict text grammar; binary zero is handled only by the bounded MP4 adapter. */
export function normalizeOrdinalTag(raw:unknown):Ordinal|null {
 if(typeof raw!=='string'||raw.length>64)return null;
 const s=raw.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g,'');
 if(!/^[0-9]+(?:\/[0-9]+)?$/.test(s))return null;
 const parts=s.split('/');return copyOrdinal({current:Number(parts[0]),total:parts.length===2?Number(parts[1]):null});
}
export function copyLocalAlbumMetadata(value:unknown):LocalAlbumMetadataV1|null {
 try{
 const root=data(value,['version','source']);if(!root||root.version!==1)return null;
 const source=data(root.source,fields);if(!source)return null;
 const out=unknownLocalAlbum('invalid');
 for(const field of fields){
  const s=source[field];const state=s&&typeof s==='object'?Object.getOwnPropertyDescriptor(s,'state'):null;
  if(!state||!('value'in state))return null;
  if(state.value==='unknown'){
   const slot=data(s,['state','reason']);if(!slot||!['legacy','absent','not-inspected','omitted','invalid','conflict'].includes(slot.reason as string))return null;
   out.source[field]=unknownSlot(slot.reason as UnknownReason);continue;
  }
  const slot=data(s,['state','value','evidence']);if(!slot||slot.state!=='known')return null;
  const e=data(slot.evidence,['kind','tag']);if(!e||!['embedded-id3','embedded-riff-id3','embedded-mp4'].includes(e.kind as string))return null;
  const allowed=tags[field];if(e.tag!==(e.kind==='embedded-mp4'?allowed[1]:allowed[0]))return null;
  const evidence={kind:e.kind,tag:e.tag} as EmbeddedEvidence;
  if(field==='track'||field==='disc'){const ordinal=copyOrdinal(slot.value);if(!ordinal)return null;out.source[field]={state:'known',value:ordinal,evidence};}
  else if(field==='albumArtist'){if(typeof slot.value!=='string'||slot.value.length>300||!slot.value.trim())return null;out.source.albumArtist={state:'known',value:slot.value,evidence};}
  else {if(typeof slot.value!=='boolean')return null;out.source.compilation={state:'known',value:slot.value,evidence};}
 }
 return new TextEncoder().encode(JSON.stringify(out)).length<=4096?out:null;
 }catch{return null;}
}
/** Invalid persisted values never acquire evidence; legacy absence is virtual, without backfill. */
export function resolveLocalAlbumMetadata(track:{localAlbum?:LocalAlbumMetadataV1}):LocalAlbumMetadataV1['source'] {
 return (track.localAlbum===undefined?unknownLocalAlbum('legacy'):copyLocalAlbumMetadata(track.localAlbum)??unknownLocalAlbum('invalid')).source;
}
