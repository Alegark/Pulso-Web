import test from 'node:test';
import assert from 'node:assert/strict';
import {phoneCountries,getPhoneCountry} from '../../src/telegram/phone-countries';
import {normalizeTelegramPhone as normalize} from '../../src/telegram/phone-number';

// Fictional syntax fixtures only: these tests perform no SDK/client or network work.
test('country selection is explicit and ISO values must be known',()=>{
 assert.deepEqual(normalize('','123456'),{ok:false,error:'country-required'});
 for(const iso of ['ZZ','001','es','+34','toString','__proto__'])assert.deepEqual(normalize(iso,'123456'),{ok:false,error:'unknown-country'});
 assert.equal(getPhoneCountry('ZZ'),undefined);
});
test('metadata includes 245 unique territories, Spanish sorting and shared calling codes',()=>{
 assert.equal(phoneCountries.length,245);assert.equal(new Set(phoneCountries.map(x=>x.iso)).size,245);
 const compare=new Intl.Collator('es').compare;
 phoneCountries.forEach((country,i)=>{
  assert.match(country.iso,/^[A-Z]{2}$/);assert.match(country.callingCode,/^[1-9][0-9]{0,2}$/);
  assert.ok(country.name);if(i)assert.ok(compare(phoneCountries[i-1].name,country.name)<=0);
  assert.ok(Object.isFrozen(country));
 });
 assert.ok(Object.isFrozen(phoneCountries));
 assert.equal(getPhoneCountry('ES')?.name,'España');
 for(const iso of ['US','CA','PR','DO'])assert.equal(getPhoneCountry(iso)?.callingCode,'1');
 assert.equal(getPhoneCountry('VE')?.callingCode,'58');assert.equal(getPhoneCountry('ES')?.callingCode,'34');
});
test('+58 and +34 are added exactly once to national digits',()=>{
 assert.equal(normalize('VE','4121234567').ok,true);
 assert.deepEqual(normalize('VE','4121234567'),{ok:true,e164:'+584121234567',nationalNumber:'4121234567',internationalPaste:false});
 assert.deepEqual(normalize('ES','612345678'),{ok:true,e164:'+34612345678',nationalNumber:'612345678',internationalPaste:false});
});
test('shared +1 does not claim to resolve the country from national digits',()=>{
 for(const iso of ['US','CA','PR'])assert.deepEqual(normalize(iso,'2025550100'),{ok:true,e164:'+12025550100',nationalNumber:'2025550100',internationalPaste:false});
});
test('bounded presentation separators normalize without changing digits',()=>{
 for(const value of [' (212) 555-0100 ','212.555.0100','212\u00a0555\u202f0100','212  555 0100'])assert.deepEqual(normalize('US',value),{ok:true,e164:'+12125550100',nationalNumber:'2125550100',internationalPaste:false});
});
test('invalid punctuation, incomplete parentheses, controls, Unicode digits and extensions fail',()=>{
 for(const value of ['1'.repeat(63)+'x','abc','123x4','123#4','123/4','123\t4','123\n4','１２３','١٢٣','(123','123)','((123))','()123','123--4','-123','123.','++34123','123+4','+ 34123'])assert.deepEqual(normalize('ES',value),{ok:false,error:'format'});
});
test('empty number is distinguished from invalid formatting',()=>{
 for(const value of ['',' ','\u00a0\u202f'])assert.deepEqual(normalize('ES',value),{ok:false,error:'number-required'});
});
test('same-prefix international paste is explicit and retains national zeros',()=>{
 assert.deepEqual(normalize('ES','+34 (012) 345-678'),{ok:true,e164:'+34012345678',nationalNumber:'012345678',internationalPaste:true});
 assert.deepEqual(normalize('VE','+58 412 1234567'),{ok:true,e164:'+584121234567',nationalNumber:'4121234567',internationalPaste:true});
 assert.deepEqual(normalize('CA','+1 202 555 0100'),{ok:true,e164:'+12025550100',nationalNumber:'2025550100',internationalPaste:true});
});
test('different or unknown pasted prefix never concatenates silently',()=>{
 for(const [iso,value] of [['ES','+58 4121234567'],['VE','+34 612345678'],['US','+999123456'],['ES','+034123']])assert.deepEqual(normalize(iso,value),{ok:false,error:'different-prefix'});
});
test('E.164 total length includes calling code and never truncates',()=>{
 assert.equal(normalize('US','12345678901234').ok,true);
 assert.equal(normalize('ES','1234567890123').ok,true);
 for(const [iso,value] of [['US','123456789012345'],['ES','12345678901234'],['ES','+3412345678901234'],['ES','+34']])assert.deepEqual(normalize(iso,value),{ok:false,error:'length'});
 assert.deepEqual(normalize('ES','1'.repeat(65)),{ok:false,error:'length'});
});
test('national zeros and apparent calling codes are not guessed or removed',()=>{
 assert.deepEqual(normalize('IT','0212345678'),{ok:true,e164:'+390212345678',nationalNumber:'0212345678',internationalPaste:false});
 assert.deepEqual(normalize('VE','04121234567'),{ok:true,e164:'+5804121234567',nationalNumber:'04121234567',internationalPaste:false});
 assert.deepEqual(normalize('ES','341234'),{ok:true,e164:'+34341234',nationalNumber:'341234',internationalPaste:false});
 assert.deepEqual(normalize('ES','0034123456'),{ok:false,error:'format'});
});
test('normalization is deterministic and leaves inputs and country data unchanged',()=>{
 const before=JSON.stringify(phoneCountries),value='+34 012-345';
 const first=normalize('ES',value);assert.deepEqual(normalize('ES',value),first);
 assert.equal(value,'+34 012-345');assert.equal(JSON.stringify(phoneCountries),before);
});
