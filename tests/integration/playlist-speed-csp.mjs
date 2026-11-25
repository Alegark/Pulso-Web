import {readFile} from 'node:fs/promises';
import {SourceMap} from 'node:module';
import {dirname,relative,resolve} from 'node:path';

const speedCspBaseRevisions=new Set([
 '086aaac62f330bbbb911b2a3b287fae2dc325171', // v60
 'd718b9dfaf82795bc1d5d4d3ae84c8268410c0c7', // v61
]);
export const isSpeedCspBaseRevision=revision=>speedCspBaseRevisions.has(revision);
export const speedCspPrefix='TESTONLY playlist CSP ';
const webkitStyleMessage="Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy.";
const profileFields=['engine','mode','requestedBackend','backend','delayMs','count','existingCount','rpcMs','serviceWorker'];

export function captureSpeedCsp(prefix){
 let sequence=0;
 document.addEventListener('securitypolicyviolation',event=>{
  const element=event.target instanceof Element?event.target:null;
  const target=[];
  for(let node=element;node&&target.length<4;node=node.parentElement)
   target.push([node.localName,node.id,node.getAttribute('class'),node.getAttribute('aria-label'),node.getAttribute('name')]);
  if(element instanceof HTMLSelectElement)target.push([...element.options].map(option=>option.value));
  console.debug(prefix+JSON.stringify({sequence:++sequence,
   directive:event.effectiveDirective,blockedURI:event.blockedURI,sourceFile:event.sourceFile,
   line:event.lineNumber,column:event.columnNumber,disposition:event.disposition,policy:event.originalPolicy,
   sample:event.sample,target,
  }));
 });
}

export function speedCspDiagnostics(bundle,origin,revision,reference){
 const maps=new Map();
 const normalize=value=>value.startsWith(origin+'/')?value.slice(origin.length):value;
 async function sourceFor(event){
  const source=normalize(event.sourceFile);
  const generated=`${source}:${event.line}:${event.column}`;
  if(!/^\/assets\/[^/]+\.js$/.test(source)||!event.line||!event.column)return generated;
  const path=resolve(bundle,'.'+source+'.map');
  if(!maps.has(path))maps.set(path,readFile(path,'utf8').then(json=>new SourceMap(JSON.parse(json))).catch(error=>{
   if(error.code!=='ENOENT')throw error;
   return null;
  }));
  const entry=(await maps.get(path))?.findEntry(event.line-1,event.column-1);
  if(!entry?.originalSource)return generated;
  const absolute=resolve(dirname(path),entry.originalSource);
  const dependency=absolute.lastIndexOf('/node_modules/');
  const name=dependency<0?relative(process.cwd(),absolute):absolute.slice(dependency+1);
  return `${name}:${entry.originalLine+1}:${entry.originalColumn+1}`;
 }
 const signature=({directive,blockedURI,source,disposition,policy,sample,target})=>
  JSON.stringify([directive,blockedURI,source,disposition,policy,sample,target]);
 return async (profile,events,consoleErrors)=>{
  const observed=await Promise.all(events.map(async event=>({...event,blockedURI:normalize(event.blockedURI),source:await sourceFor(event)})));
  // WebKit also emits a generic console error for the structured style event.
  const errors=consoleErrors.filter(text=>!(profile.engine==='webkit'&&text===webkitStyleMessage&&
   observed.some(event=>event.directive==='style-src-attr'||event.directive==='style-src-elem')));
  const inherited=[],novel=[];
  const recordingBase=isSpeedCspBaseRevision(revision)&&!reference;
  const matches=reference?.cases.filter(item=>item.status==='PASS'&&profileFields.every(field=>item[field]===profile[field]));
  if(reference&&!matches.length)errors.push('No completed CSP reference for this speed profile');
  const known=new Set(matches?.flatMap(item=>item.csp.observed.map(signature)));
  for(const event of observed){
   if(!recordingBase)(known.has(signature(event))?inherited:novel).push(event);
  }
  return {errors,csp:{observed,inherited,novel}};
 };
}
