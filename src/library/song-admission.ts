/** Await admission without taking an Activity token from the settling operation. */
export interface SongAdmissionWait {
 current():boolean;
 ready():boolean;
 subscribe(changed:()=>void):()=>void;
 signal:AbortSignal;
 timeoutMs?:number;
}
export function waitForSongAdmission(host:SongAdmissionWait):Promise<boolean>{
 return new Promise(resolve=>{
  let finished=false,unsubscribe=()=>{};
  let timer:ReturnType<typeof setTimeout>|undefined;
  const finish=(allowed:boolean)=>{if(finished)return;finished=true;clearTimeout(timer);unsubscribe();host.signal.removeEventListener('abort',abort);resolve(allowed);};
  const abort=()=>finish(false);
  const check=()=>{try{if(host.signal.aborted||host.current()!==true)finish(false);else if(host.ready()===true)finish(true);}catch{finish(false);}};
  check();if(finished)return;
  try{unsubscribe=host.subscribe(check);}catch{finish(false);return;}
  // A synchronous notification during subscribe must still remove its listener.
  if(finished){unsubscribe();return;}
  if(host.timeoutMs!==undefined)timer=setTimeout(abort,host.timeoutMs);
  host.signal.addEventListener('abort',abort,{once:true});check();
 });
}
