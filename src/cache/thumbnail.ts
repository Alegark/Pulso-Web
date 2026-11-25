import {validateArtwork,type ArtworkInspection} from '../imports/artwork';
import {fitsThumbnail,THUMBNAIL_PIXELS} from './artwork-policy';

export type ValidatedArtwork=Extract<ArtworkInspection,{state:'ready'}>;

export async function artworkThumbnail(artwork:ValidatedArtwork):Promise<ValidatedArtwork|null>{
 if(fitsThumbnail({...artwork,byteLength:artwork.blob.size}))return artwork;
 try{
  const bitmap=await createImageBitmap(artwork.blob,{imageOrientation:'none'});
  const canvas=document.createElement('canvas'),scale=Math.min(1,THUMBNAIL_PIXELS/Math.max(bitmap.width,bitmap.height));
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));
  canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  try{
   const context=canvas.getContext('2d');
   if(!context)return null;
   context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  }finally{bitmap.close();}
  for(const mime of [artwork.mime,'image/jpeg']){
   const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,mime,0.82));
   if(!blob||!fitsThumbnail({width:canvas.width,height:canvas.height,byteLength:blob.size}))continue;
   return await validateArtwork(blob);
  }
 }catch{/* The original validated image can still be displayed for this session. */}
 return null;
}
