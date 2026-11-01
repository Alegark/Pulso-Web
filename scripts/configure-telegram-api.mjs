// node --import tsx scripts/configure-telegram-api.mjs --input PRIVATE_FILE
// Reads only the explicit private input; does not import or connect the SDK.
import {readFile,open,mkdir,rename,lstat,unlink,chmod} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {decodeTelegramApiIdentity,API_IDENTITY_INPUT_BYTES} from '../src/telegram/api-identity.ts';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const local=resolve(project,'.local'),directory=resolve(local,'telegram-owner'),target=resolve(directory,'api-identity.json');
const args=process.argv.slice(2);let temporary=null;
async function noLink(path){try{if((await lstat(path)).isSymbolicLink())throw Error('invalid');}catch(error){if(error?.code!=='ENOENT')throw Error('invalid');}}
async function boundedRead(path){const handle=await open(path,'r');try{const info=await handle.stat();if(!info.isFile()||info.size>API_IDENTITY_INPUT_BYTES)throw Error('invalid');return await handle.readFile('utf8');}finally{await handle.close();}}
try{
 await noLink(local);await noLink(directory);await noLink(target);
 if(args.length===1&&args[0]==='--status'){
  let configured=false;try{configured=!!decodeTelegramApiIdentity(await boundedRead(target));}catch{/* Status never discloses configuration data or raw errors. */}
  console.log(JSON.stringify({configured,connected:false,userSessionLoaded:false}));
 }else{
  if(args.length!==2||args[0]!=='--input')throw Error('invalid');
  const identity=decodeTelegramApiIdentity(await boundedRead(args[1]));if(!identity)throw Error('invalid');
  await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700);
  temporary=resolve(directory,`identity-${randomUUID()}.tmp`);
  const handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(JSON.stringify({api_id:identity.apiId,api_hash:identity.apiHash})+'\n');await handle.sync();}finally{await handle.close();}
  await noLink(target);await rename(temporary,target);temporary=null;
  console.log(JSON.stringify({configured:true,connected:false,userSessionLoaded:false,storage:'private-local-file'}));
 }
}catch{
 console.error('No se pudo configurar la identidad API. Usa un archivo privado válido con api_id y api_hash. No incluyas teléfono, código ni contraseña.');process.exitCode=1;
}finally{if(temporary)await unlink(temporary).catch(()=>{});}
