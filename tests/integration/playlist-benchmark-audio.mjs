// Tag-free MPEG-1 Layer III silence, 417 bytes/frame at 128 kbit/s and 44.1 kHz.
export const benchmarkBytes=Math.floor(8*1024**2/417)*417;
export function benchmarkPart(key,offset=0,limit=benchmarkBytes){
 const end=Math.min(benchmarkBytes,offset+limit),data=new Uint8Array(end-offset);
 const header=[0xff,0xfb,0x90,0x64];
 for(let frame=Math.floor(offset/417)*417;frame<end;frame+=417)
  for(let i=0;i<header.length;i++)if(frame+i>=offset&&frame+i<end)data[frame+i-offset]=header[i];
 if(end===benchmarkBytes)data[data.length-1]=key;
 return data;
}
