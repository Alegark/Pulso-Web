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

import {phoneCountries} from './phone-countries';

export const internationalPhoneNumberErrorText:Readonly<Record<PhoneNumberError,string>>=Object.freeze({...phoneNumberErrorText,
 'number-required':'Escribe tu número completo con + y el prefijo internacional.',
 format:'Escribe +, el prefijo y tu número. Puedes usar espacios, guiones o paréntesis completos, sin extensiones.',
 length:'Revisa el prefijo y el número: deben incluir un código de país conocido y hasta 15 dígitos en total.',
});

/** Parse a complete international number without guessing a territory or numbering plan. */
export function normalizeInternationalTelegramPhone(raw:string):PhoneNumberResult {
 if(raw.length>64)return {ok:false,error:'length'};
 const value=raw.trim();
 if(!value)return {ok:false,error:'number-required'};
 if(!value.startsWith('+'))return {ok:false,error:'format'};
 const body=value.slice(1);
 if(!/^(?:[0-9]+|\([0-9]+\))(?:(?:[ \u00a0\u202f]+|[.-])(?:[0-9]+|\([0-9]+\)))*$/.test(body))return {ok:false,error:'format'};
 const digits=body.replace(/[ \u00a0\u202f().-]/g,'');
 if(digits.length>15)return {ok:false,error:'length'};
 const matches=phoneCountries.filter(item=>digits.startsWith(item.callingCode));
 const max=Math.max(0,...matches.map(item=>item.callingCode.length));
 if(!max||digits.length<=max)return {ok:false,error:'length'};
 return {ok:true,e164:`+${digits}`,nationalNumber:digits.slice(max),internationalPaste:true};
}

/** Longest matching pinned calling code; shared codes remain ambiguous. */
export function detectPhoneCountries(raw:string) {
 const value=raw.trim();
 if(!/^\+[0-9 ()\u00a0\u202f.-]*$/.test(value))return [];
 const digits=value.slice(1).replace(/[ \u00a0\u202f().-]/g,'');
 const matches=phoneCountries.filter(item=>digits.startsWith(item.callingCode));
 const max=Math.max(0,...matches.map(item=>item.callingCode.length));
 return matches.filter(item=>item.callingCode.length===max);
}

export function replacePhoneCountry(raw:string,iso:string):string {
 const country=getPhoneCountry(iso);
 if(!country)return raw;
 const matches=detectPhoneCountries(raw);
 const oldCode=matches[0]?.callingCode;
 const trimmed=raw.trim();
 // Preserve the national part verbatim only when the old international prefix is recognizable.
 if(oldCode&&trimmed.startsWith(`+${oldCode}`))return `+${country.callingCode}${trimmed.slice(oldCode.length+1)}`;
 if(oldCode)return `+${country.callingCode}${trimmed.slice(1).replace(/[ \u00a0\u202f().-]/g,'').slice(oldCode.length)}`;
 if(!trimmed)return `+${country.callingCode}`;
 if(!trimmed.startsWith('+'))return `+${country.callingCode} ${trimmed}`;
 // An unrecognized/incomplete international prefix has no known national part.
 return `+${country.callingCode}`;
}
