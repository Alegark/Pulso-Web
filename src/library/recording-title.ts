const musicIdentityText=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const albumVersion=/\s+\(album version\)$/iu;
const validDuration=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=86400;
const fullText=(s:string)=>s.normalize('NFC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('es');
const validAlbum=(v:unknown):v is string=>typeof v==='string'&&!!v.trim();
/** Equality retains existing title normalization. Alias requires only the exact terminal edition marker. */
export function recordingTitleCandidate(actual:string,expected:string,expectedAlbum:string|null|undefined,expectedDuration:number|null|undefined):boolean {
 if(!actual.trim()||!expected.trim())return false;
 if(musicIdentityText(actual)===musicIdentityText(expected))return true;
 if(!validAlbum(expectedAlbum)||!validDuration(expectedDuration))return false;
 const left=albumVersion.test(actual),right=albumVersion.test(expected);if(left===right)return false;
 const baseLeft=left?actual.replace(albumVersion,''):actual,baseRight=right?expected.replace(albumVersion,''):expected;
 return !!musicIdentityText(baseLeft)&&musicIdentityText(baseLeft)===musicIdentityText(baseRight);
}
export function recordingTitlesEquivalent(actual:string,expected:string,context:{actualAlbum:string|null|undefined;expectedAlbum:string|null|undefined;actualDurationSeconds:number|null|undefined;expectedDurationSeconds:number|null|undefined}):boolean {
 if(!actual.trim()||!expected.trim())return false;
 if(musicIdentityText(actual)===musicIdentityText(expected))return true;
 return recordingTitleCandidate(actual,expected,context.expectedAlbum,context.expectedDurationSeconds)&&validAlbum(context.actualAlbum)&&validAlbum(context.expectedAlbum)&&fullText(context.actualAlbum)===fullText(context.expectedAlbum)&&validDuration(context.actualDurationSeconds)&&validDuration(context.expectedDurationSeconds)&&Math.abs(context.actualDurationSeconds-context.expectedDurationSeconds)<=1;
}
