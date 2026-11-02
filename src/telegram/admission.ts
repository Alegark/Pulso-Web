/** RAM-only authentication never reads or writes the local music library.
 * Passive library recovery does not grant or revoke this separate authority. */
export type TelegramBlockReason='unsupported'|'acquiring'|'no-control'|'storage'|'busy'|null;
export function telegramBlockReason(state:{supported:boolean;owner:boolean;acquiring:boolean;storageReady:boolean;busy:boolean;reserved:boolean;queuePending:boolean}):TelegramBlockReason {
 if(!state.supported)return 'unsupported';
 if(!state.storageReady)return 'storage';
 if(!state.owner)return state.acquiring?'acquiring':'no-control';
 if(state.busy||state.reserved||state.queuePending)return 'busy';
 return null;
}
export const telegramBlockText:Record<Exclude<TelegramBlockReason,null>,string>={
 unsupported:'Este navegador no ofrece el control exclusivo que necesita esta versión para conectar. Puedes escribir el número, pero el envío permanece detenido.',
 acquiring:'Estamos obteniendo el control de esta pestaña. Puedes escribir el número mientras termina.',
 'no-control':'Otra pestaña puede conservar el control de Pulso. Cierra las otras pestañas de Pulso y pulsa «Comprobar control». Tu número puede quedar escrito mientras tanto.',
 storage:'Hay que revisar el acceso al almacenamiento local antes de enviar el código. El aviso de la base local indica cómo continuar.',
 busy:'Hay una operación en curso. Puedes escribir el número; el envío estará disponible cuando termine.',
};
