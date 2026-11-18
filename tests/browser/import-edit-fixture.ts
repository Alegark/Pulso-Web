import type {Track} from '../../src/library/library';
import {closeDatabase,committed,openDatabase,request} from '../../src/storage/database';

// Test-only competing writer. editTrack would wait for the import's Web Lock,
// so use a native IDB transaction to exercise the publication re-read itself.
export async function editDuringImport(id:string,patch:Pick<Track['manualOverrides'],'title'|'album'>,favorite?:boolean):Promise<void>{
 const db=await openDatabase();
 try{
 const tx=db.transaction('tracks','readwrite'),done=committed(tx),store=tx.objectStore('tracks');
 const track=await request<Track|undefined>(store.get(id));
 if(!track)throw new Error('Falta la ficha de prueba');
 store.put({...track,...patch,favorite:favorite??track.favorite,manualOverrides:{...track.manualOverrides,...patch},revision:track.revision+1},id);
 await done;
 }finally{closeDatabase(db);}
}
