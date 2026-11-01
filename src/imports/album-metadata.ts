import {copyLocalAlbumMetadata,normalizeOrdinalTag,copyOrdinal,unknownLocalAlbum,unknownSlot,type LocalAlbumMetadataV1,type SourceSlot,type Ordinal,type EmbeddedEvidence,type UnknownReason} from '../library/album-metadata';
export interface AlbumTag {id:string;value:unknown}
/** Payloads come only from the existing global-budget MP4 preflight. */
export interface Mp4AlbumTag {tag:string;payload:Uint8Array|null}
const mapping={track:['TRCK','trkn'],disc:['TPOS','disk'],albumArtist:['TPE2','aART'],compilation:['TCMP','cpil']} as const;
function mp4Value(tag:string,b:Uint8Array|null):unknown {
 if(!b||b.length<8)return undefined;
 const v=new DataView(b.buffer,b.byteOffset,b.byteLength),kind=v.getUint32(0);
 if(v.getUint32(4)!==0)return undefined; // locale/reserved must be zero
 const p=b.subarray(8);
 if(tag==='trkn'||tag==='disk'){
  // trkn has a trailing reserved word; disk permits the six-byte form too.
  if(kind!==0||!(p.length===8||tag==='disk'&&p.length===6)||p[0]||p[1]||p.length===8&&(p[6]||p[7]))return undefined;
  return copyOrdinal({current:(p[2]*256+p[3])||null,total:(p[4]*256+p[5])||null});
 }
 if(tag==='cpil')return kind===21&&p.length===1&&(p[0]===0||p[0]===1)?Boolean(p[0]):undefined;
 if(tag==='aART'&&kind===1){try{return new TextDecoder('utf-8',{fatal:true}).decode(p);}catch{return undefined;}}
 return undefined;
}
/** Reuses the successful parse's native ID3 values, never common's coerced ordinals.
 * MP4 values require direct corroboration; installed parser truncates trkn to UINT8. */
export function extractLocalAlbumMetadata(native:Record<string,readonly AlbumTag[]>,mime:string,mp4:readonly Mp4AlbumTag[],coverage:UnknownReason|null=null):LocalAlbumMetadataV1 {
 if(coverage)return unknownLocalAlbum(coverage);
 const out=unknownLocalAlbum('absent'),isMp4=mime==='audio/mp4';
 const candidates=isMp4?mp4.map(x=>({id:x.tag,value:mp4Value(x.tag,x.payload)})):
  Object.entries(native).filter(([key])=>key==='ID3v2.3'||key==='ID3v2.4').flatMap(([,tags])=>tags);
 const kind:EmbeddedEvidence['kind']=isMp4?'embedded-mp4':mime==='audio/wav'?'embedded-riff-id3':'embedded-id3';
 for(const field of ['track','disc','albumArtist','compilation'] as const){
  const tag=mapping[field][isMp4?1:0],actual=candidates.filter(x=>x.id===tag);
  if(!actual.length)continue;
  let chosen:unknown,invalid=false,conflict=false;
  for(const candidate of actual){
   let value=candidate.value;
   if(field==='track'||field==='disc')value=isMp4?copyOrdinal(value):normalizeOrdinalTag(value);
   else if(field==='compilation')value=isMp4?(typeof value==='boolean'?value:undefined):value==='0'?false:value==='1'?true:undefined;
   else if(typeof value!=='string'||value.length>300||!value.trim())value=undefined;
   if(value===undefined||value===null){invalid=true;continue;}
   if(chosen!==undefined&&JSON.stringify(chosen)!==JSON.stringify(value))conflict=true;
   chosen=value;
  }
  const slot:SourceSlot<Ordinal|string|boolean>=conflict?unknownSlot('conflict'):invalid?unknownSlot('invalid'):chosen===undefined?unknownSlot('invalid'):{state:'known',value:chosen as Ordinal|string|boolean,evidence:{kind,tag}};
  // Field association is checked by the closed copier below.
  Object.assign(out.source,{[field]:slot});
 }
 return copyLocalAlbumMetadata(out)??unknownLocalAlbum('invalid');
}
