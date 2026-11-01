import assert from 'node:assert/strict';
// No Player, resource, Activity or IDB replacement. Only observers and explicit wait barriers.
export function instrument(snapshot,records){return {name:'R110-TESTONLY-observers-and-barriers',enforce:'pre',transform(source,id){const file=id.startsWith(snapshot+'/')?id.slice(snapshot.length+1):'';let code=source;
 const once=(needle,replacement,label)=>{assert.equal(code.split(needle).length-1,1,`R110 exact anchor ${file} ${label}`);code=code.replace(needle,replacement);records.push({file,label,needle});};
 if(file==='src/main.tsx'){
  once('function insertionStatus(value:InsertionStatus){','function insertionStatus(value:InsertionStatus){globalThis.h110.statuses??=[];globalThis.h110.statuses.push(structuredClone(value));','observe-root-status');
  once('startSources:startLocalSourcePreparation,saveLatestQueue:current=>saveLatestQueue(current),','startSources:(...args)=>{globalThis.h110.producers??=[];globalThis.h110.producers.push(args[0].map(asset=>({...asset})));return startLocalSourcePreparation(...args);},saveLatestQueue:current=>saveLatestQueue(current),','observe-native-producer-missing-unique');
  once("const saved=snapshot()??(allowEmpty?", "await globalThis.h110.step('save-execution');const saved=snapshot()??(allowEmpty?",'save-execution-before-latest-snapshot');
  code+=`\n/* R110-TESTONLY read-only private root observer. No root mutators exported. */\nwindow.r110={marker:'R110-TESTONLY',state:()=>({owner:control.owner,busy,status,databaseState,databaseGeneration,scopeId,activity:control.activity.count,idle:control.activity.idle,resolved:control.activity.resolved,pending:queueInsertions.pendingCount,uncertain:queueInsertionUncertain,configuring,queueSaveTokens,lastSave,protection:sourceProtection.getReadonlySnapshot(),structure:player.structure(),generation:player.generation,listeners:player.listeners.map(([type,fn])=>({type,id:globalThis.h110.id(fn)})),currentEntryId:player.current?.id??null,state:player.state,error:player.error,repeat:player.repeat,shuffleOrder:player.shuffleOrder===null?null:[...player.shuffleOrder],tracks:tracks.map(t=>({...t})),playlists:playlists.map(p=>({...p}))})};\n`;
 }
 if(file==='src/playback/queue-insertion-controller.ts'){
  once('const selected=await host.resolveSelection(r.intent.selection,()=>current(r),r.abort.signal);check(r);',"const selected=await host.resolveSelection(r.intent.selection,()=>current(r),r.abort.signal);await globalThis.h110.step('selection-resolved');check(r);",'after-native-selection');
  once('const produced=await r.producer.result;',"const produced=await r.producer.result;await globalThis.h110.step('producer-result');",'after-native-producer-result-before-stage');
 }
 if(file==='src/storage/asset-reader.ts'){once('const hash=integrity?sha256.create():null;',"globalThis.h110?.verifications.push({asset:{...asset},integrity});const hash=integrity?sha256.create():null;",'observe-actual-hash-pass');}
 if(code!==source)return {code,map:null};
 }};}
