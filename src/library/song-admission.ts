/** Await an actual admission transition. No timers, retries, IO or Activity token
 * held by the waiter: the operation it is waiting on owns its own settlement. */
export interface SongAdmissionWait {
 current():boolean;
 ready():boolean;
 subscribe(changed:()=>void):()=>void;
 signal:AbortSignal;
}
export function waitForSongAdmission(host:SongAdmissionWait):Promise<boolean>{
 return new Promise(resolve=>{
  let finished=false,unsubscribe=()=>{};
  const finish=(allowed:boolean)=>{if(finished)return;finished=true;unsubscribe();host.signal.removeEventListener('abort',abort);resolve(allowed);};
  const abort=()=>finish(false);
  const check=()=>{try{if(host.signal.aborted||host.current()!==true)finish(false);else if(host.ready()===true)finish(true);}catch{finish(false);}};
  check();if(finished)return;
  try{unsubscribe=host.subscribe(check);}catch{finish(false);return;}
  // A synchronous notification during subscribe must still remove its listener.
  if(finished){unsubscribe();return;}
  host.signal.addEventListener('abort',abort,{once:true});check();
 });
}
