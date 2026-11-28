import {createAccountDataRouter} from './account-data.mjs';

const phone=value=>value===null||typeof value==='string'&&/^\+[1-9][0-9]{5,14}$/.test(value);

export function createAccountProfileRouter(options){
 return createAccountDataRouter({
  path:'/api/account-profile',table:'pulso_account_preferences',column:'telegram_phone',
  unavailableCode:'PROFILE_UNAVAILABLE',conflictCode:'PROFILE_CHANGED',
  extraHeaders:{Pragma:'no-cache'},inputMax:1024,resultMax:2048,
  parseInput(input){
   if(Object.keys(input).some(key=>!['accountId','telegramPhone','revision'].includes(key))||!phone(input.telegramPhone))throw Error('input');
   return input;
  },
  values:input=>({telegram_phone:input.telegramPhone}),
  formatRow(row,subject,respond){
   if(row&&!phone(row.telegram_phone))throw Error('response');
   return respond({accountId:subject,telegramPhone:row?.telegram_phone??null,revision:row?.revision??null});
  },
 },options);
}
export const accountProfile=createAccountProfileRouter();
