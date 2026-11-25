import test from 'node:test';
import assert from 'node:assert/strict';
import {isBotWakeupUpdate} from '../../src/telegram/bot-wakeup-update';

test('only incoming new or edited messages in the exact approved private peer wake the poll',()=>{
 const bot=101;
 const message={_:'message',peerId:{_:'peerUser',userId:bot}};
 const edit={_:'updateEditMessage',message};
 assert(isBotWakeupUpdate({_:'updateShortMessage',userId:bot},bot));
 assert(isBotWakeupUpdate({_:'updateShort',update:edit},bot));
 assert(isBotWakeupUpdate({_:'updates',updates:[{...edit,_:'updateNewMessage'}]},bot));
 assert(isBotWakeupUpdate({_:'updatesCombined',updates:[edit]},bot));
 for(const update of [
  {_:'updatesTooLong'},
  {_:'updateShortMessage',userId:bot+1},
  {_:'updateShortMessage',userId:bot,out:true},
  {_:'updates',updates:[{_:'updateUserTyping',userId:bot}]},
  {_:'updates',updates:[{...edit,message:{...message,out:true}}]},
  {_:'updates',updates:[{...edit,message:{...message,fromId:{_:'peerUser',userId:bot+1}}}]},
  {_:'updates',updates:[{...edit,message:{...message,peerId:{_:'peerChannel',channelId:bot}}}]},
  {_:'updates',updates:[...Array(64).fill(null),edit]},
 ])assert(!isBotWakeupUpdate(update,bot));
 let getters=0;
 assert(!isBotWakeupUpdate({_:'updateShort',get update(){++getters;return edit;}},bot));
 assert(!isBotWakeupUpdate({_:'updateShortMessage',userId:bot,get out(){++getters;return true;}},bot));
 assert(!isBotWakeupUpdate({_:'updateShort',update:{...edit,message:{...message,get fromId(){++getters;return message.peerId;}}}},bot));
 assert.equal(getters,0);
});
