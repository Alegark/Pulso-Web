import {useEffect,useReducer,type ReactNode} from 'react';
import type {PlayerChange} from '../playback/player';

/** The media clock updates its controls, without rebuilding the library/search tree. */
export function PlaybackProgress({subscribe,enabled=true,children}:{
 subscribe:(changed:(change:PlayerChange)=>void)=>()=>void;
 enabled?:boolean;
 children:()=>ReactNode;
}){
 const [,render]=useReducer(n=>n+1,0);
 useEffect(()=>{
  if(!enabled)return;
  let frame:number|null=null;
  const update=()=>{
   if(document.visibilityState==='hidden'||frame!==null)return;
   frame=requestAnimationFrame(()=>{frame=null;render();});
  };
  const unsubscribe=subscribe(change=>{if(change==='progress')update();});
  document.addEventListener('visibilitychange',update);
  return()=>{unsubscribe();document.removeEventListener('visibilitychange',update);if(frame!==null)cancelAnimationFrame(frame);};
 },[subscribe,enabled]);
 return children();
}
