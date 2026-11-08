/** Compatibility of declared file tags, never acoustic identity. A catalogue may
 * name one performer of a collaboration which the file stores as an artist list. */
const normalized=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function expectedAudioTagMismatch(tags:{title?:string;artist?:string;artists?:readonly string[]},expected:{title:string;artist:string|null}):'title'|'artist'|null {
 if(tags.title&&normalized(tags.title)!==normalized(expected.title))return 'title';
 if(!expected.artist||!tags.artist&&!tags.artists?.length)return null;
 const artist=normalized(expected.artist);
 const values=[...(tags.artists??[]),...(tags.artist?[tags.artist]:[])];
 // Compare complete declared names, not substrings or words inside a name.
 // Preserve punctuation used inside the requested name (AC/DC, Tyler, The Creator).
 const delimiters=['\u0000',';','/',','].filter(d=>!expected.artist!.includes(d));
 const members=(value:string)=>delimiters.reduce<string[]>((parts,d)=>parts.flatMap(p=>p.split(d)),[value]);
 return values.some(value=>normalized(value)===artist||members(value).some(name=>normalized(name)===artist))?null:'artist';
}
