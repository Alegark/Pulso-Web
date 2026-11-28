import type {Track} from './library';
import type {AvailabilityRecord} from './shell-selectors';

type Copy={state:'available'|'missing'|'unknown';trackId:string|null;inLibrary:boolean|null};

/** A completed inspection always wins over the last verified availability. */
export function effectiveAlbumCopy(copy:Copy|undefined,resolvedId:string|null,localTrack:Track|undefined,availability:ReadonlyMap<string,AvailabilityRecord>|undefined,libraryTrackIds:ReadonlySet<string>|undefined):Copy|undefined{
 if(copy!==undefined)return copy;
 if(!resolvedId||!localTrack?.assetId||availability?.get(resolvedId)?.state!=='available')return undefined;
 return {state:'available',trackId:resolvedId,inLibrary:libraryTrackIds?libraryTrackIds.has(resolvedId):null};
}
