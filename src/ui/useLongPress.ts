import {useEffect,useRef,type PointerEvent,type MouseEvent} from 'react';

export function useLongPress({onLongPress,disabled=false,delayMs=450,moveTolerancePx=10}:{onLongPress:()=>void;disabled?:boolean;delayMs?:number;moveTolerancePx?:number}) {
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null), reset=useRef<ReturnType<typeof setTimeout>|null>(null);
 const start=useRef<{x:number;y:number;id:number;touch:boolean}|null>(null),triggered=useRef(false),callback=useRef(onLongPress);
 callback.current=onLongPress;
 function clear(){if(timer.current!==null)clearTimeout(timer.current);timer.current=null;start.current=null;}
 useEffect(()=>()=>{clear();if(reset.current!==null)clearTimeout(reset.current);},[]);
 useEffect(()=>{if(disabled)clear();},[disabled]);
 return {
  onPointerDown:(event:PointerEvent<HTMLElement>)=>{if(disabled||!event.isPrimary||(event.pointerType==='mouse'&&event.button!==0))return;const target=event.target;if(target instanceof Element&&target.closest('.track-actions-trigger,dialog,button:not(.collection-track-main):not(.album-track-main),a,input,select,summary'))return;clear();if(reset.current!==null)clearTimeout(reset.current);triggered.current=false;start.current={x:event.clientX,y:event.clientY,id:event.pointerId,touch:event.pointerType==='touch'};timer.current=setTimeout(()=>{timer.current=null;triggered.current=true;reset.current=setTimeout(()=>{triggered.current=false;},1000);callback.current();},delayMs);},
  onPointerMove:(event:PointerEvent<HTMLElement>)=>{const point=start.current;if(point&&point.id===event.pointerId&&Math.hypot(event.clientX-point.x,event.clientY-point.y)>moveTolerancePx)clear();},
  onPointerUp:()=>{clear();if(triggered.current){if(reset.current!==null)clearTimeout(reset.current);reset.current=setTimeout(()=>{triggered.current=false;},500);}},
  onPointerCancel:()=>{clear();triggered.current=false;},
  onClickCapture:(event:MouseEvent<HTMLElement>)=>{if(event.target instanceof Element&&event.target.closest('dialog,.track-actions-trigger'))return;if(triggered.current){event.preventDefault();event.stopPropagation();triggered.current=false;if(reset.current!==null)clearTimeout(reset.current);}},
  onContextMenu:(event:MouseEvent<HTMLElement>)=>{if(triggered.current||start.current?.touch)event.preventDefault();},
 };
}
