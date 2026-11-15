/** TESTONLY login fixture. No Telegram transport, session keys or real accounts. */
import {createSourcesDriver} from '../../src/telegram/sources-driver';
import {createBotProvidersDriver} from '../../src/telegram/bot-providers-driver';
import type {TemporaryTelegramDriver} from '../../src/telegram/temporary-sdk';
import type {AccountBinding} from '../../src/telegram/sources-protocol';

export async function openTemporaryTelegram(_identity:unknown,signal:AbortSignal):Promise<TemporaryTelegramDriver>{
 let closed=false,binding:AccountBinding|null=null;
 const current=(attempt:AbortSignal)=>{signal.throwIfAborted();attempt.throwIfAborted();if(closed)throw Error('cancelled');};
 const unavailable=async()=>{throw Error('TESTONLY: remote operation prohibited');};
 return {
  async begin(_phone,attempt){current(attempt);return 'app';},
  async code(_phone,_code,attempt){current(attempt);binding={accountRef:crypto.randomUUID(),accountEpoch:1};},
  password:unavailable,
  async logout(attempt){current(attempt);binding=null;closed=true;},
  async close(){binding=null;closed=true;},
  getAccountBinding:()=>closed?null:binding,
  createSources(sessionId){if(!binding||closed)throw Error('TESTONLY: disconnected');return createSourcesDriver(binding,sessionId,{invalidateSession:()=>{binding=null;closed=true;},getDialogs:unavailable});},
  createBotProviders(sessionId){if(!binding||closed)throw Error('TESTONLY: disconnected');return createBotProvidersDriver(binding,sessionId,{invalidateSession:()=>{binding=null;closed=true;},resolveIdentity:unavailable});},
 };
}
