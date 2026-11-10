/** Original quiet two-note tone, generated locally; never a catalogue recording. */
export function demoAudioUrl() {
  const rate=22050,seconds=8,count=rate*seconds,buffer=new ArrayBuffer(44+count*2),view=new DataView(buffer);
  const text=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,36+count*2,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,count*2,true);
  for(let i=0;i<count;i++){const t=i/rate,envelope=Math.min(t/.25,1,(seconds-t)/.25);view.setInt16(44+i*2,Math.sin(t*2*Math.PI*220)*Math.sin(t*2*Math.PI*.25)**2*envelope*1300,true);}
  return URL.createObjectURL(new Blob([buffer],{type:'audio/wav'}));
}
