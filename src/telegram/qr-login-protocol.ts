import {record} from './auth-protocol';
/** Short-lived, user-visible authorization ticket. Never include in diagnostics or storage. */
export interface QrLoginChallenge {readonly url:string;readonly expiresAt:number}
export function parseQrLoginChallenge(value:unknown):QrLoginChallenge|null{
 try{if(!record(value,['url','expiresAt'])||typeof value.url!=='string'||!/^tg:\/\/login\?token=[A-Za-z0-9_-]{22,172}$/.test(value.url)||typeof value.expiresAt!=='number'||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=0||value.expiresAt>8640000000000000)return null;return Object.freeze({url:value.url,expiresAt:value.expiresAt});}catch{return null;}
}
