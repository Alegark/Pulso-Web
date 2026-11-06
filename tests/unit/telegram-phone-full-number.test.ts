import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {detectPhoneCountries,normalizeInternationalTelegramPhone as normalize,replacePhoneCountry} from '../../src/telegram/phone-number';
test('international numbers identify only unambiguous pinned countries',()=>{
 assert.equal(detectPhoneCountries('+584120001234')[0]?.iso,'VE');
 assert.ok(detectPhoneCountries('+15550000123').length>1);
 assert.equal(normalize('+15550000123').ok,true);
 assert.deepEqual(normalize('+58004120001234'),{ok:true,e164:'+58004120001234',nationalNumber:'004120001234',internationalPaste:true});
});
test('country replacement preserves national digits and formatting',()=>{
 assert.equal(replacePhoneCountry('+58 0412 0001234','ES'),'+34 0412 0001234');
 assert.equal(replacePhoneCountry('','VE'),'+58');
 assert.equal(replacePhoneCountry('0412','VE'),'+58 0412');
});
test('rejects incomplete, extra symbols, extensions and overlong values',()=>{
 for(const value of ['+58','+','+58 123 ext 4','+58/123','0058123','+5812345678901234'])assert.equal(normalize(value).ok,false,value);
 assert.equal(normalize('+581234567890123').ok,true);
});


test('country choice updates a spaced or partial calling prefix without losing recognized national zeros',()=>{
 assert.equal(replacePhoneCountry('+5 8 00412','ES'),'+3400412');
 assert.equal(replacePhoneCountry('+','VE'),'+58');
 assert.equal(replacePhoneCountry('+5','VE'),'+58');
 assert.equal(replacePhoneCountry('+999','VE'),'+58');
});
