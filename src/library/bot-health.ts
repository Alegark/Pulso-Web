import {isBotSearchLimitError,type BotSearchError} from '../telegram/bot-search-protocol';

const RETRY_AFTER_MS=5*60_000;
type Health={latencyMs:number;failures:number;successes:number;retryAt:number};

export function createBotHealth(now=Date.now){
 const providers=new Map<string,Health>();
 return {
  order<T extends {providerRef:string}>(slots:readonly T[]):T[]{
   const at=now();
   const healthy=slots.some(slot=>{const row=providers.get(slot.providerRef);return !!row?.successes&&row.retryAt<=at;});
   if(!healthy)return [...slots];
   const delayed=(slot:T)=>(providers.get(slot.providerRef)?.retryAt??0)>at;
   return [...slots.filter(slot=>!delayed(slot)),...slots.filter(delayed)];
  },
  observe(ref:string,latencyMs:number,outcome:BotSearchError|'success'|'reply'|'metadata-rejected'){
   const row=providers.get(ref)??{latencyMs:0,failures:0,successes:0,retryAt:0};
   const failure=outcome==='metadata-rejected'||outcome==='timeout'||outcome==='unsupported'||outcome==='limit'||isBotSearchLimitError(outcome);
   if(!failure&&outcome!=='reply'&&outcome!=='success')return;
   row.latencyMs=latencyMs;
   if(failure){if(++row.failures>=2)row.retryAt=now()+RETRY_AFTER_MS;}
   else{row.failures=0;row.retryAt=0;if(outcome==='success')row.successes++;}
   providers.set(ref,row);
  },
 };
}

const sessions=new WeakMap<object,{scope:string;health:ReturnType<typeof createBotHealth>}>();
export function sessionBotHealth(client:object,scope:string){
 const found=sessions.get(client);if(found&&found.scope===scope)return found.health;
 const health=createBotHealth();sessions.set(client,{scope,health});return health;
}
