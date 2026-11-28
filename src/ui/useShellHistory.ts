import {useLayoutEffect,useRef} from 'react';

const stateKey='pulsoShell';

/** Same-document entries preserve the exact release URL and the updater's state. */
export function useShellHistory(layers:readonly (()=>void)[]){
 const session=useRef<string|null>(null);
 const committed=useRef(layers);
 const returning=useRef(false);
 const depth=(state:unknown)=>{
  const marker=(state as Record<string,{session?:string;depth?:number}>|null)?.[stateKey];
  return marker?.session===session.current&&Number.isSafeInteger(marker.depth)?marker.depth!:0;
 };
 function reconcile(){
  if(returning.current)return;
  const current=depth(history.state),next=committed.current.length;
  if(current>next){
   returning.current=true;history.go(next-current);
  }else{
   for(let i=current+1;i<=next;i++)history.pushState({...history.state,[stateKey]:{session:session.current,depth:i}},'');
  }
 }
 useLayoutEffect(()=>{
  session.current??=crypto.randomUUID();
  const onPop=(event:PopStateEvent)=>{
   const next=depth(event.state),current=committed.current;
   if(returning.current){returning.current=false;reconcile();return;}
   if(next<current.length){
    for(let i=current.length-1;i>=next;i--)current[i]();
   }else if(next>current.length){
    // A forward entry may refer to a collection that was closed or replaced.
    history.replaceState({...history.state,[stateKey]:{session:session.current,depth:current.length}},'');
   }
  };
  window.addEventListener('popstate',onPop);
  return()=>window.removeEventListener('popstate',onPop);
 },[]);
 useLayoutEffect(()=>{committed.current=layers;reconcile();});
}
