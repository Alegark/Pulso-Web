import type {ReactNode} from 'react';
import './collection-detail.css';

export interface CollectionHeaderProps {
 title:string;kind:string;count:number;duration:number|null;artwork:ReactNode;
 playing:boolean;canPlay:boolean;busy:boolean;onPlay:()=>void;
 shuffle:boolean;canShuffle:boolean;onShuffle:()=>void;
}
export function CollectionHeader(props:CollectionHeaderProps){
 const minutes=props.duration===null?null:Math.floor(props.duration/60);
 const length=minutes===null?null:minutes>=60?`${Math.floor(minutes/60)} h ${minutes%60} min`:minutes===0?`${Math.floor(props.duration!)} s`:`${minutes} min`;
 return <div className="collection-header">
  <div className="collection-header__art">{props.artwork}</div>
  <div className="collection-header__info"><p className="collection-header__kind">{props.kind}</p><h3>{props.title}</h3><p className="collection-header__meta">{props.count} {props.count===1?'canción':'canciones'}{length&&` · ${length}`}</p></div>
  <div className="collection-header__controls">
   <span className="collection-header__hint" role="status">{props.busy?'Preparando audio…':null}</span>
   <button className="collection-shuffle" type="button" aria-label="Reproducción aleatoria" aria-pressed={props.shuffle} disabled={!props.canShuffle} onClick={props.onShuffle}><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h4c4 0 5 14 10 14h4m-4-4 4 4-4 4M3 19h4c1 0 2-1 3-3m4-8c1-2 2-3 4-3h3m-4-4 4 4-4 4"/></svg></button>
   <button className="collection-play" type="button" aria-label={props.playing?'Pausar playlist':'Reproducir playlist'} disabled={!props.canPlay} onClick={props.onPlay}><svg viewBox="0 0 24 24" aria-hidden="true" fill={props.playing?'none':'currentColor'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d={props.playing?'M8 5v14M16 5v14':'m8 4 12 8-12 8Z'}/></svg></button>
  </div>
 </div>;
}
