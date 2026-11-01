import assert from 'node:assert/strict';
export function instrumentation(snapshot,records){return {name:'R98-TESTONLY-private-closure-hooks',enforce:'pre',transform(code,id){
 const file=id.startsWith(snapshot+'/')?id.slice(snapshot.length+1):'';
 const once=(needle,replacement,label)=>{assert.equal(code.split(needle).length-1,1,'exact anchor '+file+' '+label);code=code.replace(needle,replacement);records.push({file,label,needle});};
 if(file==='src/main.tsx'){
 once('async function refresh(force=false,updateQueueTitles=true,parent?:Handle|null,failurePhase?:\'refresh\'){',`async function refresh(force=false,updateQueueTitles=true,parent?:Handle|null,failurePhase?:'refresh'){globalThis.h98.refreshes.push({force,updateQueueTitles,parentNull:parent===null});`,'observe-real-refresh');
 once('refresh:()=>refresh(true,false,null),changed:()=>{},',`refresh:async()=>{await globalThis.h98.step('root-refresh');return refresh(true,false,null);},changed:()=>{},`,'hold-own-refresh-before-native-refresh');
 once('captureRaw:captureRemovalRaw,reserve:target=>sourceReview.reserve(target),',`captureRaw:captureRemovalRaw,reserve:target=>{globalThis.h98.reservation.push({activity:control.activity.count,idle:control.activity.idle});return sourceReview.reserve(target);},`,'read-token-ended-before-reserve');
 code+=`\n// R98 private root observation/commands. No handles or proof are serialized.\nwindow.r98={state:()=>({owner:control.owner,busy,status,databaseState,databaseGeneration,activity:control.activity.count,pending:copyRemovalPending,blocked:copyRemovalBlocked(),reserved:sourceReview.hasReservation(),protection:sourceProtection.getReadonlySnapshot(),entries:player.entries.map(e=>({...e})),repeat:player.repeat,shuffle:player.shuffleOrder,tracks:tracks.map(t=>({...t})),playlists:playlists.map(p=>({...p}))}),\n refresh:()=>refresh(true,false,null),bypass:async()=>{await queueWork(tracks.map(t=>t.id));await actWork(()=>{throw Error('R98 mutator wrongly admitted');});savePosition();},\n closeDB:async()=>{const db=await r98Open();db.dispatchEvent(new Event('close'));},activityABA:()=>{control.activity.invalidate();control.activity.open();},\n queueForBarrier:ids=>queue(ids), cede:()=>cede()};\n`;
 code=`import {openDatabase as r98Open} from './storage/database';\n`+code;
 once('let restored=saved;let missing=0;',`let restored=saved;let missing=0;await globalThis.h98.step('queue-pending');`,'pending-queue-barrier');
 }
 if(file==='src/ui/LocalCopyRemovalController.tsx'){
 once('const view=controller.getView(),callbacks=controller.callbacks(view);',`const view=controller.getView(),callbacks=controller.callbacks(view);r98Current={view,callbacks,controller};globalThis.h98.view={state:view.state,working:view.working,reason:view.reason,revision:view.revision,outcome:view.outcome,pendingCount:view.pendingCount};`,'observe-and-private-react-callback-map');
 code+=`\nlet r98Current;const r98Captured=new Map();\nglobalThis.h98.reactCommand=(command,key)=>{if(command==='capture'){r98Captured.set(key,r98Current);return;}const cap=r98Captured.get(key);if(!cap)return;const {view,callbacks,controller}=cap;if(command==='confirm')return callbacks.confirm({planRevision:view.revision,declaration:'external-copy-declared',confirmRemoveThisCopy:true});if(command==='unmount')return controller.dispose();if(command==='close')return callbacks.close();};\n`;
 }
 if(file==='src/library/local-copy-removal.ts'){
 once('await verifyPublished(d.target,c);const after=await scan(c);',`await globalThis.h98.step('plan-before-worker');await verifyPublished(d.target,c);await globalThis.h98.step('plan-after-worker');const after=await scan(c);`,'native-worker-plan-barriers');
 once('check(owned,d.target);await verifyPublished(d.target,owned);',`check(owned,d.target);await globalThis.h98.step('confirm-before-worker');await verifyPublished(d.target,owned);await globalThis.h98.step('confirm-after-worker');`,'native-worker-confirm-barriers');
 once('j=await prepare(d,consent,owned);',`await globalThis.h98.step('before-prepared');j=await(async()=>{const value=await prepare(d,consent,owned);await globalThis.h98.step('prepared-ack');return value;})();await globalThis.h98.step('after-prepared');`,'prepared-ack-before-assignment-and-after-native-commit');
 once('j=await detach(j,owned);',`j=await detach(j,owned);await globalThis.h98.step('after-detach');`,'detach-native-settlement');
 once('try{await dir.removeEntry(j.target.storageKey);}',`try{await globalThis.h98.step('opfs-before-delete');await dir.removeEntry(j.target.storageKey);await globalThis.h98.step('opfs-after-delete');}`,'native-opfs-syscall-boundaries');
 once('const value=await fn(tx);await done;return value;',`const value=await fn(tx);await done;return value;`,'assert-native-transaction-unchanged');
 }
 if(code&&['src/main.tsx','src/ui/LocalCopyRemovalController.tsx','src/library/local-copy-removal.ts'].includes(file))return {code,map:null};
 }};}
