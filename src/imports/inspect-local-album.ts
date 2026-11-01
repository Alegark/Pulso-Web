import {parseBlob} from 'music-metadata';
import {fail,fromKnownError,AppFailure} from '../errors/app-failure';
import {copyLocalAlbumMetadata,type LocalAlbumMetadataV1,type UnknownReason} from '../library/album-metadata';
import {METADATA_RESCAN_LIMIT} from '../library/metadata-rescan-protocol';
import {audioMetadataView,AudioMetadataLimitError,ArtworkError,MAX_ID3_BYTES,MAX_AUDIO_TABLE_ENTRIES} from './artwork';
import {extractLocalAlbumMetadata,type Mp4AlbumTag} from './album-metadata';
/** Only examines an already verified, bounded File in the read-only worker.
 * No importer, audio element, cover/lyrics decoder, retry or duration calculation. */
export async function inspectLocalAlbumFile(file:File,mime:'audio/mpeg'|'audio/mp4'|'audio/wav',check:()=>void):Promise<LocalAlbumMetadataV1> {
 check();if(!file.size||file.size>METADATA_RESCAN_LIMIT)fail('validate','internal','limit-exceeded','none');
 try{
 const h=new Uint8Array(await file.slice(0,16).arrayBuffer());check();
 const ascii=(a:number,b:number)=>String.fromCharCode(...h.subarray(a,b));
 const detected=ascii(0,3)==='ID3'||h[0]===255&&(h[1]&224)===224?'audio/mpeg':ascii(4,8)==='ftyp'?'audio/mp4':ascii(0,4)==='RIFF'&&ascii(8,12)==='WAVE'?'audio/wav':null;
 if(detected!==mime)fail('validate','integrity','metadata-invalid','none');
 let coverage:UnknownReason|null=null;const tags:Mp4AlbumTag[]=[];
 const view=await audioMetadataView(file,mime,false,code=>{coverage=code==='tag-size'?'omitted':code==='tag-unsupported'?'not-inspected':'invalid';},tag=>tags.push(tag));check();
 const metadata=await parseBlob(view,{skipCovers:true,duration:false,maxMemoryAllocation:MAX_ID3_BYTES,maxMetadataEntries:mime==='audio/mp4'?MAX_AUDIO_TABLE_ENTRIES:128,maxChapterCount:1});check();
 const result=copyLocalAlbumMetadata(extractLocalAlbumMetadata(metadata.native,mime,tags,coverage));
 if(!result)fail('parse','integrity','metadata-invalid','none');return result;
 }catch(error){
 if(error instanceof AudioMetadataLimitError)fail('parse','internal','limit-exceeded','none');
 if(error instanceof ArtworkError)fail('parse','integrity','metadata-invalid','none');
 throw AppFailure.create(fromKnownError(error,{phase:'parse',backend:'none'}));
 }
}
