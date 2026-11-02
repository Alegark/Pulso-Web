import {getPhoneCountry} from './phone-countries';

export type PhoneNumberError='country-required'|'unknown-country'|'number-required'|'format'|'different-prefix'|'length';
export type PhoneNumberResult={ok:true;e164:string;nationalNumber:string;internationalPaste:boolean}|{ok:false;error:PhoneNumberError};
export const phoneNumberErrorText:Readonly<Record<PhoneNumberError,string>>=Object.freeze({
 'country-required':'Elige el país y prefijo para enviar el código.',
 'unknown-country':'Elige un país y prefijo de la lista.',
 'number-required':'Escribe el número nacional para enviar el código.',
 format:'Usa dígitos, espacios, guiones, puntos o paréntesis completos. No incluyas extensiones ni un prefijo de salida como 00.',
 'different-prefix':'El prefijo internacional pegado no coincide. Elige el país y prefijo correctos.',
 length:'El número internacional debe tener como máximo 15 dígitos, incluido el prefijo, y un número nacional.',
});

// Syntax only: this does not validate a country's numbering plan or remove trunk zeros.
// A leading + explicitly marks an international paste. Bare digits are always national.
export function normalizeTelegramPhone(countryIso:string,raw:string):PhoneNumberResult {
 if(!countryIso)return {ok:false,error:'country-required'};
 const country=getPhoneCountry(countryIso);
 if(!country)return {ok:false,error:'unknown-country'};
 if(raw.length>64)return {ok:false,error:'length'};
 const value=raw.replace(/^[ \u00a0\u202f]+|[ \u00a0\u202f]+$/g,'');
 if(!value)return {ok:false,error:'number-required'};
 const internationalPaste=value.startsWith('+'),body=internationalPaste?value.slice(1):value;
 if(!/^(?:[0-9]+|\([0-9]+\))(?:(?:[ \u00a0\u202f]+|[.-])(?:[0-9]+|\([0-9]+\)))*$/.test(body))return {ok:false,error:'format'};
 const digits=body.replace(/[ \u00a0\u202f().-]/g,'');
 if(internationalPaste&&!digits.startsWith(country.callingCode))return {ok:false,error:'different-prefix'};
 // 00 is an ambiguous international exit prefix: ask for the explicit + form.
 if(!internationalPaste&&digits.startsWith('00'))return {ok:false,error:'format'};
 const nationalNumber=internationalPaste?digits.slice(country.callingCode.length):digits;
 const e164=`+${country.callingCode}${nationalNumber}`;
 if(!nationalNumber||!/^\+[1-9][0-9]{0,14}$/.test(e164))return {ok:false,error:'length'};
 return {ok:true,e164,nationalNumber,internationalPaste};
}
