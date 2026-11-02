import type {BotsSnapshot,TelegramSessionClient} from '../telegram/session-client';
import {BotProvidersPanel} from './BotProvidersPanel';

/** Public DTO mapping only. The service owns admission, retained plans and confirmed ACKs. */
export function BotProvidersController({client,state,canConnect}:{client:TelegramSessionClient;state:BotsSnapshot;canConnect:boolean}){
 const current=client.captureBotsCurrent(),action=client.captureBotActionCurrent(),cancel=client.captureBotCancel();
 return <BotProvidersPanel rows={state.providers.map(row=>({id:row.providerRef,username:row.username,label:row.label,profileStatus:'verified',compatibility:'unverified'}))}
  revision={state.revision} pending={state.pending} canEdit={canConnect} scopeKey={state.scopeKey} current={current}
  error={state.error} notice={state.notice} onAdd={input=>client.addBot(input,action)}
  onMove={(id,direction)=>client.moveBot(id,direction,action)} onRemove={id=>client.removeBot(id,action)} onCancel={cancel}/>;
}
