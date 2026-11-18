import type {Snapshot} from '../playback/queue-restore';

export const queuePositionKey='library-playback-position';
export type QueuePosition=Pick<Snapshot,'currentEntryId'|'position'|'repeat'>;

export function queuePositionRecord(base:Snapshot,value:QueuePosition){
 return {
  version:1,
  first:base.entries[0]?.id??null,
  last:base.entries.at(-1)?.id??null,
  count:base.entries.length,
  baseEntry:base.currentEntryId,
  basePosition:base.position,
  baseRepeat:base.repeat,
  ...value,
 };
}

export function withQueuePosition(base:Snapshot,raw:unknown):Snapshot{
 if(!raw||typeof raw!=='object')return base;
 const saved=raw as Record<string,unknown>;
 if(saved.version!==1||saved.first!==(base.entries[0]?.id??null)||saved.last!==(base.entries.at(-1)?.id??null)||
  saved.count!==base.entries.length||saved.baseEntry!==base.currentEntryId||saved.basePosition!==base.position||saved.baseRepeat!==base.repeat||
  typeof saved.position!=='number'||!Number.isFinite(saved.position)||saved.position<0||
  (saved.repeat!=='off'&&saved.repeat!=='one'&&saved.repeat!=='all')||
  (saved.currentEntryId!==null&&!base.entries.some(entry=>entry.id===saved.currentEntryId)))return base;
 return {...base,currentEntryId:saved.currentEntryId as string|null,position:saved.position,repeat:saved.repeat};
}
