/** Shared validators for the closed Telegram worker messages. */
export const uuid = (v:unknown):v is string => typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
// Maximum 16 keys per object, depth <= 3, UTF-16 strings <= 1024.
// At most ~8 KiB UTF-8 including envelopes; no JSON stringify/sort of unknown input.
export function record(v:unknown, allowed:readonly string[], required:readonly string[]=allowed):v is Record<string,unknown> {
 if(!v || typeof v!=='object' || Array.isArray(v) || Object.getPrototypeOf(v)!==Object.prototype) return false;
 let n=0; for(const k in v){if(++n>16 || !allowed.includes(k))return false; const d=Object.getOwnPropertyDescriptor(v,k);if(!d || !('value' in d))return false;}
 // Check ordinary enumerable key budget first, before reflecting the full own-key shape.
 if(Object.getOwnPropertyNames(v).length!==n||Object.getOwnPropertySymbols(v).length) return false;
 return required.every(k=>Object.hasOwn(v,k));
}
