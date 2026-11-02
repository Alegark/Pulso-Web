/** Presentation of existing root guards. Editing a local draft grants no authority. */
export type TelegramBlockReason='unsupported'|'acquiring'|'no-control'|'storage'|'busy'|'recovery'|null;
export function telegramBlockReason(state:{supported:boolean;owner:boolean;acquiring:boolean;storageReady:boolean;busy:boolean;reserved:boolean;recoveryPending:boolean;queuePending:boolean}):TelegramBlockReason {
 if(!state.supported)return 'unsupported';
 if(!state.storageReady)return 'storage';
 if(!state.owner)return state.acquiring?'acquiring':'no-control';
 if(state.busy||state.reserved||state.queuePending)return 'busy';
 if(state.recoveryPending)return 'recovery';
 return null;
}
export const telegramBlockText:Record<Exclude<TelegramBlockReason,null>,string>={
 unsupported:'Este navegador no ofrece el control exclusivo que necesita esta versión para conectar. Puedes escribir el número, pero el envío permanece detenido.',
 acquiring:'Estamos obteniendo el control de esta pestaña. Puedes escribir el número mientras termina.',
 'no-control':'Otra pestaña puede conservar el control de Pulso. Cierra las otras pestañas de Pulso y pulsa «Comprobar control». Tu número puede quedar escrito mientras tanto.',
 storage:'Hay que revisar el acceso al almacenamiento local antes de enviar el código. El aviso de la base local indica cómo continuar.',
 busy:'Hay una operación en curso. Puedes escribir el número; el envío estará disponible cuando termine.',
 recovery:'La biblioteca está terminando de abrirse o tiene una operación pendiente de revisar. Puedes escribir el número; enviar el código sigue en pausa.',
};
