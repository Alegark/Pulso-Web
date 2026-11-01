import {committed} from './database';
// A synchronous put/add exception can exit before await done. Observe abort immediately;
// returning the original promise still propagates any commit failure to the caller.
export function transactionDone(tx:IDBTransaction):Promise<void>{
 const done=committed(tx);void done.catch(()=>{});return done;
}
