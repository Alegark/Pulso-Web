export function SaveTrackButton({saved,onToggle,label}:{saved:boolean;onToggle:()=>void;label:string}){
  return <button type="button" className="round-button save-track-button" aria-label={label} aria-pressed={saved} title={saved?'Añadida a Favoritos':'Añadir a Favoritos'} onClick={onToggle}>
    <span className="save-track-button__badge" aria-hidden="true"><svg viewBox="0 0 24 24"><path d={saved?'m5 12 4.5 4.5L19 7':'M12 5v14M5 12h14'} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
  </button>;
}
