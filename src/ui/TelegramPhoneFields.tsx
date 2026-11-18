import React from 'react';
import {phoneCountries} from '../telegram/phone-countries';
import {detectPhoneCountries,replacePhoneCountry} from '../telegram/phone-number';
import './TelegramPhoneFields.css';

interface Props {phone:string;country:string;disabled:boolean;helpId:string;reasonId?:string;invalid:boolean;onPhone:(value:string)=>void;onCountry:(value:string)=>void}
export function TelegramPhoneFields({phone,country,disabled,helpId,reasonId,invalid,onPhone,onCountry}:Props){
 const [open,setOpen]=React.useState(false),[query,setQuery]=React.useState(''),[index,setIndex]=React.useState(-1);
 const listId=React.useId(),phoneInput=React.useRef<HTMLInputElement>(null),focusPhone=React.useRef(false);
 React.useLayoutEffect(()=>{if(focusPhone.current&&!disabled){focusPhone.current=false;phoneInput.current?.focus();const n=phoneInput.current?.value.length??0;phoneInput.current?.setSelectionRange(n,n);}});
 const committed=React.useRef<object|null>(null),token={};
 React.useLayoutEffect(()=>{committed.current=token;return()=>{if(committed.current===token)committed.current=null;};});
 const active=()=>committed.current===token&&!disabled;
 const fold=(v:string)=>v.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('es');
 const matches=detectPhoneCountries(phone);
 const selected=matches.find(item=>item.iso===country)??(matches.length===1?matches[0]:undefined);
 const options=phoneCountries.filter(item=>fold(`${item.name} ${item.iso} +${item.callingCode}`).includes(fold(query).trim()));
 const choose=(iso:string)=>{if(!active())return;onCountry(iso);onPhone(replacePhoneCountry(phone,iso));focusPhone.current=true;setOpen(false);setQuery('');setIndex(-1);};
 const activeOption=options[index];
 const activeId=open&&activeOption?`${listId}-${activeOption.iso}`:undefined;
 const activeRow=React.useRef<HTMLLIElement>(null);
 React.useLayoutEffect(()=>{
  if(activeId)activeRow.current?.scrollIntoView({block:'nearest'});
 },[activeId]);
 return <div className="telegram-phone-row">
  <div className="telegram-country-field">
   <label htmlFor={`${listId}-input`}>País y prefijo</label>
   <input id={`${listId}-input`} role="combobox" autoComplete="off" aria-expanded={open} aria-controls={open?listId:undefined} aria-activedescendant={activeId}
    value={open?query:selected?`${selected.name} (+${selected.callingCode})`:matches.length>1?'Prefijo compartido':''} placeholder="Buscar país o código" disabled={disabled}
    onFocus={()=>{setOpen(true);setQuery('');setIndex(-1);}}
    onBlur={()=>setOpen(false)}
    onChange={e=>{setQuery(e.target.value);setOpen(true);setIndex(-1);}}
    onKeyDown={e=>{
     if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      e.preventDefault();setOpen(true);
      const step=e.key==='ArrowDown'?1:-1;
      setIndex(i=>options.length?Math.max(0,Math.min(i+step,options.length-1)):-1);
     }else if(e.key==='Enter'&&open){
      e.preventDefault();
      const option=activeOption??(query.trim()?options[0]:undefined);
      if(option)choose(option.iso);else setOpen(false);
     }else if(e.key==='Escape'){e.preventDefault();setOpen(false);}
    }}/>
   {open&&<div className="telegram-country-popup">
    <ul id={listId} role="listbox" aria-label="Países y prefijos" className="telegram-country-list">
     {options.map((item,i)=><li id={`${listId}-${item.iso}`} key={item.iso} ref={i===index?activeRow:undefined} role="option" aria-selected={i===index}
      onPointerDown={e=>{e.preventDefault();choose(item.iso);}}>{item.name} (+{item.callingCode})</li>)}
    </ul>
    {options.length===0&&<p role="status">No hay países coincidentes.</p>}
   </div>}
  </div>
  <label>Número de teléfono<input ref={phoneInput} type="tel" autoComplete="tel" placeholder="+ y número internacional" value={phone}
   onChange={e=>{if(active())onPhone(e.target.value);}} maxLength={128} required disabled={disabled}
   aria-describedby={`${helpId}${reasonId?` ${reasonId}`:''}`} aria-invalid={invalid}/></label>
 </div>;
}
