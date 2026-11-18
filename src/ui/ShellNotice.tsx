import './shell-notice.css';

export function ShellNotice({message,onDismiss}:{message:string;onDismiss:()=>void}){
 return <div className="shell-notice">
  <p role="status" aria-atomic="true">{message}</p>
  {message&&<button type="button" aria-label="Cerrar aviso" onClick={onDismiss}>×</button>}
 </div>;
}
