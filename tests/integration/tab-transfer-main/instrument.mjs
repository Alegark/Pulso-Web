import assert from 'node:assert/strict';
// DRAFT anchors deliberately fail closed if the shared product changes.
// TESTONLY exports read-only snapshots. Only delays AFTER real awaited work;
// no exposed product mutator, substituted Activity, media, storage or ownership.
export function instrument(snapshot,records){return {name:'R136-TESTONLY-readonly-and-after-await',enforce:'pre',transform(source,id){const file=id.split('?')[0].startsWith(snapshot+'/')?id.split('?')[0].slice(snapshot.length+1):'';let code=source;
const once=(a,b,label)=>{assert.equal(code.split(a).length-1,1,`R136 DRAFT anchor ${file}:${label}`);code=code.replace(a,b);records.push({file,label,anchor:a});};
if(file==='src/main.tsx'){
 once('try{await work(...args);}catch(error)',"try{await work(...args);await globalThis.h136.step('admitted-work');}catch(error)",'real-operation-complete-active-token');
 once('await writes;\n if(saved)await writeRecord',"await writes;await globalThis.h136.step('prepare-writes');\n if(saved)await writeRecord",'prepare-after-native-resource-release-and-writes');
 once('void queue([],restore.saved,restore.warnings).finally',"void (async()=>{await queue([],restore.saved,restore.warnings);await globalThis.h136.step('startup-queue-complete');})().finally",'after-real-startup-queue-fully-resolved-before-own-finally');
 once('const db=await openExistingDatabase();let record:',"const db=await openExistingDatabase();await globalThis.h136.step('save-database-open');let record:",'native-connection-before-guarded-save');
 code+=`\n/* R136 TESTONLY: snapshots only; no callable product mutators. */\nwindow.r136={state:()=>({owner:control.owner,state:control.state,transfer:control.transferState,proof:control.proof,tabId:control.tabId,busy,status,databaseState,databaseGeneration,scopeId,activity:control.activity.count,idle:control.activity.idle,resolved:control.activity.resolved,queueSaveTokens,queuePending:queueInsertions.pendingCount,deferred:!!deferredQueueRestore,startup:!!startupQueueAttempt,structure:player.structure(),snapshot:snapshot(),playerState:player.state,protection:sourceProtection.getReadonlySnapshot()})};\n`;
}
if(file==='src/playback/ownership.ts'){
 once("try { await this.acquired(); finish(","try { await this.acquired(); await globalThis.h136.step('acquired-callback'); finish(",'after-complete-acquired-callback');
 once('await this.release();\n      const requests',"await this.release();await globalThis.h136.step('released-before-ack');\n      const requests",'after-both-native-locks-release-before-ACK');
}
if(code!==source)return {code,map:null};
}};}
