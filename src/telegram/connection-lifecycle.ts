export const TELEGRAM_CONNECTION_IDLE_MS=3*60_000;
const reconnectWindowMs=60_000;
const reconnectLimit=4;
const warmDebounceMs=1_000;

/** A suspended transport can be warmed without replacing the authenticated worker or its drivers. */
export class TelegramConnection {
 private ready=true;
 private opening:Promise<void>|null=null;
 private closing:Promise<void>|null=null;
 private timer:ReturnType<typeof setTimeout>|null=null;
 private attempts:number[]=[];
 private warmEpoch=0;

 constructor(private readonly signal:AbortSignal,private readonly disconnect:()=>Promise<void>,private readonly reconnect:()=>Promise<void>,private readonly cooldown:()=>number|null){
  signal.addEventListener('abort',()=>this.cancelWarm(),{once:true});
 }

 get available(){return this.ready&&!this.signal.aborted;}

 private cancelWarm(){
  if(this.timer!==null)clearTimeout(this.timer);
  this.timer=null;
 }

 suspend(){
  this.warmEpoch++;
  this.cancelWarm();
  if(this.closing)return this.closing;
  if(!this.ready&&!this.opening)return Promise.resolve();
  this.ready=false;
  const closing=Promise.resolve(this.opening).catch(()=>{}).then(async()=>{
   this.ready=false;
   await this.disconnect();
  }).finally(()=>{this.closing=null;});
  this.closing=closing;
  return closing;
 }

 private nextAttempt(now:number){
  this.attempts=this.attempts.filter(at=>at+reconnectWindowMs>now);
  return Math.max(this.cooldown()??0,this.attempts.length>=reconnectLimit?this.attempts[0]+reconnectWindowMs:0);
 }

 warm(){
  if(this.signal.aborted||this.timer!==null||this.available)return;
  if(this.closing){
   const epoch=this.warmEpoch;
   void this.closing.then(()=>{if(this.warmEpoch===epoch)this.warm();},()=>{});
   return;
  }
  if(this.opening)return;
  const now=Date.now();
  const last=this.attempts.at(-1);
  const due=Math.max(this.nextAttempt(now),last===undefined?0:last+warmDebounceMs);
  if(due>now){
   this.timer=setTimeout(()=>{this.timer=null;this.warm();},Math.min(due-now,2_147_483_647));
   return;
  }
  void this.ensureAvailable().catch(()=>{});
 }

 async ensureAvailable(){
  if(this.closing)await this.closing;
  if(this.signal.aborted)throw Error('cancelled');
  if(this.ready)return;
  if(this.opening)return this.opening;
  const now=Date.now(),due=this.nextAttempt(now);
  if(due>now)throw {text:'FLOOD_WAIT',seconds:Math.ceil((due-now)/1000)};
  this.cancelWarm();
  this.attempts.push(now);
  const opening=this.reconnect().then(()=>{if(!this.closing)this.ready=true;}).finally(()=>{this.opening=null;});
  this.opening=opening;
  return opening;
 }
}
