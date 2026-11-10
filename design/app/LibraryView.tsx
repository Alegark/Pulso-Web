import {useLayoutEffect,type ReactNode} from 'react';
import {PlaylistForm} from './PlaylistScreens';

export type LibraryFilter='Playlists'|'Álbumes'|'Artistas'|null;
export interface LibraryItem {id:string;name:string;subtitle:string;kind:Exclude<LibraryFilter,null>;cover:ReactNode;pinned?:boolean;onOpen:()=>void}
interface LibraryViewProps {
  items:LibraryItem[];
  filter:LibraryFilter;
  onFilter:(filter:LibraryFilter)=>void;
  query:string;
  onQuery:(value:string)=>void;
  searchOpen:boolean;
  alphabetical:boolean;
  onSort:()=>void;
  list:boolean;
  onLayout:()=>void;
  creating:boolean;
  onCreate:(name:string,description:string)=>void;
  onCancelCreate:()=>void;
}
export function LibraryView(props:LibraryViewProps){
  useLayoutEffect(()=>{if(props.searchOpen)document.getElementById('library-search')?.focus();},[props.searchOpen]);
  const normalize=(value:string)=>value.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  const items=props.items.filter(item=>(!props.filter||item.kind===props.filter)&&normalize(item.name+' '+item.subtitle).includes(normalize(props.query))).sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||(props.alphabetical?a.name.localeCompare(b.name,'es'):0));
  return <div className="library-browser">
    <div className="filter-row library-filters" aria-label="Ver biblioteca">{(['Playlists','Álbumes','Artistas'] as const).map(filter=><button type="button" key={filter} aria-pressed={props.filter===filter} onClick={()=>props.onFilter(props.filter===filter?null:filter)}>{filter}</button>)}</div>
    {props.searchOpen&&<div className="library-search"><label htmlFor="library-search">Buscar en tu biblioteca</label><input id="library-search" type="search" value={props.query} onChange={event=>props.onQuery(event.target.value)} placeholder="Playlists, álbumes o artistas"/></div>}
    {props.creating&&<PlaylistForm onSave={props.onCreate} onCancel={props.onCancelCreate}/>}
    <div className="library-toolbar"><button type="button" className="text-button" aria-label={`Ordenar biblioteca: ${props.alphabetical?'nombre':'recientes'}`} onClick={props.onSort}><span aria-hidden="true">↕</span> {props.alphabetical?'Nombre':'Recientes'}</button><button type="button" className="round-button" aria-label={props.list?'Ver biblioteca en cuadrícula':'Ver biblioteca en lista'} onClick={props.onLayout}><svg viewBox="0 0 24 24" aria-hidden="true">{props.list?<path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h6v6h-6z" fill="currentColor"/>:<path d="M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1" stroke="currentColor" strokeWidth="2"/>}</svg></button></div>
    {items.length?<div className={`library-grid${props.list?' library-grid--list':''}`} aria-label="Contenido de tu biblioteca">{items.map(item=><button type="button" id={item.id} key={item.id} className="library-card" data-kind={item.kind} onClick={item.onOpen}>{item.cover}<span className="library-card__text"><strong>{item.name}</strong><span>{item.pinned&&<span className="library-pin" aria-label="Fijada">◆ </span>}{item.subtitle}</span></span></button>)}</div>:<div className="empty-state"><h2>{props.query?'Sin coincidencias en tu biblioteca':'Todavía no hay elementos aquí'}</h2><p>{props.query?'Prueba otro nombre o cambia el filtro.':'Los elementos que añadas aparecerán en este apartado.'}</p></div>}
  </div>;
}
