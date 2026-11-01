/** Application identity only. This is not a user session or permission to
 * connect. Never include these values in diagnostics, errors or source receipts. */
export interface TelegramApiIdentity {readonly apiId:number;readonly apiHash:string}
export const API_IDENTITY_INPUT_BYTES=4096;

export function parseTelegramApiIdentity(value:unknown):TelegramApiIdentity|null {
 try{
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return null;
  // The CLI supplies bounded JSON through decodeTelegramApiIdentity below.
  // Reject inherited/hidden fields and never evaluate supplied accessors.
  let count=0;
  for(const key in value){if(++count>2||!Object.hasOwn(value,key)||!['api_id','api_hash'].includes(key))return null;}
  const keys=Reflect.ownKeys(value);if(keys.length!==2||keys.some(k=>k!=='api_id'&&k!=='api_hash'))return null;
  const id=Object.getOwnPropertyDescriptor(value,'api_id'),hash=Object.getOwnPropertyDescriptor(value,'api_hash');
  if(!id||!hash||!('value'in id)||!('value'in hash)||!id.enumerable||!hash.enumerable)return null;
  const raw=id.value;
  if(typeof raw!=='number'&&!(typeof raw==='string'&&/^[1-9][0-9]{0,9}$/.test(raw)))return null;
  const apiId=typeof raw==='number'?raw:Number(raw);
  if(!Number.isSafeInteger(apiId)||apiId<1||apiId>2147483647||typeof hash.value!=='string'||!/^[0-9a-fA-F]{32}$/.test(hash.value))return null;
  return Object.freeze({apiId,apiHash:hash.value.toLowerCase()});
 }catch{return null;}
}

export function decodeTelegramApiIdentity(text:unknown):TelegramApiIdentity|null {
 if(typeof text!=='string'||text.length>API_IDENTITY_INPUT_BYTES||new TextEncoder().encode(text).length>API_IDENTITY_INPUT_BYTES)return null;
 try{return parseTelegramApiIdentity(JSON.parse(text));}catch{return null;}
}
