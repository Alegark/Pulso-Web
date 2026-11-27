import {MB_UUID,musicBrainzId,spotifyArtworkUrl,type CatalogId} from './catalog-id';
import {artworkUrl} from './player-artwork-provider';
import type {Track} from './library';
import {musicCatalogKey} from './music-search-catalog';

interface ReleaseFields {title:string; artist:string|null; artworkUrl?:string}
export type CatalogRelease=ReleaseFields&(
 {source:'itunes';releaseId:number;trackId:number;disc:number;position:number}|
 {source:'spotify';releaseId:string;trackId:string;position:number;itunesReleaseId?:number}
);
const spotifyId=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9]{22}$/.test(value);
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
const text=(value:unknown):value is string=>typeof value==='string'&&!!value.trim()&&value.length<=300&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);

export function copyCatalogRelease(value:unknown):CatalogRelease|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const row=value as CatalogRelease;
 if(Object.keys(row).some(key=>!['source','releaseId','trackId','disc','position','title','artist','artworkUrl','itunesReleaseId'].includes(key))||
  !positive(row.position)||row.position>200||!text(row.title)||!(text(row.artist)||row.artist===null))return null;
 const image=row.artworkUrl===undefined?null:
  row.source==='spotify'?(spotifyArtworkUrl(row.artworkUrl)??(positive(row.itunesReleaseId)?artworkUrl(row.artworkUrl):null)):artworkUrl(row.artworkUrl);
 if(row.artworkUrl!==undefined&&!image)return null;
 const fields={title:row.title,artist:row.artist,position:row.position,...(image?{artworkUrl:image}:{})};
 if(row.source==='spotify'&&spotifyId(row.releaseId)&&spotifyId(row.trackId)&&!Object.hasOwn(row,'disc')&&
  (row.itunesReleaseId===undefined||positive(row.itunesReleaseId)))
  return {...fields,source:'spotify',releaseId:row.releaseId,trackId:row.trackId,...(row.itunesReleaseId?{itunesReleaseId:row.itunesReleaseId}:{})};
 if(row.source==='itunes'&&positive(row.releaseId)&&positive(row.trackId)&&positive(row.disc)&&row.disc<=20&&!Object.hasOwn(row,'itunesReleaseId'))
  return {...fields,source:'itunes',releaseId:row.releaseId,trackId:row.trackId,disc:row.disc};
 return null;
}

/** Manual album/recording edits and contradictory embedded labels take priority. */
export function trackCatalogRelease(track:Track):CatalogRelease|null {
 if(Object.keys(track.manualOverrides??{}).length)return null;
 const release=copyCatalogRelease(track.catalogRelease);
 return release&&(!track.album?.trim()||musicCatalogKey(track.album)===musicCatalogKey(release.title))?release:null;
}

export function displayTrackAlbum(track:Track):string|null {
 if(Object.hasOwn(track.manualOverrides??{},'album'))return track.album;
 const choice=albumEditionId(track)!==null?searchedAlbumChoice(track):null;
 return choice?.album??(track.album?.trim()?track.album:trackCatalogRelease(track)?.title??null);
}

function searchedAlbumChoice(track:Track){
 const choice=track.catalogChoice;
 return choice&&(choice.source==='itunes'||choice.source==='musicbrainz')&&choice.album?.trim()&&
  !Object.keys(track.manualOverrides??{}).length?choice:null;
}

export function searchedITunesRelease(track:Track):number|null {
 if(Object.keys(track.manualOverrides??{}).length||track.catalogChoice?.source!=='itunes'||!track.catalogChoice.album?.trim())return null;
 const id=Number(/^itunes:([1-9][0-9]*):[1-9][0-9]*:[1-9][0-9]*:[1-9][0-9]*$/.exec(track.catalogChoice.id)?.[1]);
 return positive(id)?id:null;
}

export function catalogChoiceOrder(track:Track):{disc:number;track:number}|null {
 const choice=searchedAlbumChoice(track);
 if(!choice||albumEditionId(track)===null)return null;
 const match=choice.source==='itunes'?/^itunes:[1-9][0-9]*:([1-9][0-9]*):([1-9][0-9]*):[1-9][0-9]*$/.exec(choice.id):
  /^musicbrainz:[0-9a-f-]+:([1-9][0-9]*):([1-9][0-9]*):[0-9a-f-]+$/.exec(choice.id);
 if(!match)return null;
 const disc=Number(match[1]),position=Number(match[2]);
 return positive(disc)&&positive(position)?{disc,track:position}:null;
}

/** Exact recording IDs are shared by choices and locally attached releases. */
export function catalogRecordingId(track:Track):string|null {
 const release=trackCatalogRelease(track);
 if(release?.source==='itunes')return `itunes:${release.releaseId}:${release.disc}:${release.position}:${release.trackId}`;
 return searchedAlbumChoice(track)?.id??null;
}

export function albumEditionId(track:Track):CatalogId|null {
 const release=trackCatalogRelease(track);
 if(release?.source==='itunes')return release.releaseId;
 if(release?.source==='spotify'&&release.itunesReleaseId)return release.itunesReleaseId;
 const id=searchedITunesRelease(track);
 if(id!==null)return id;
 const choice=searchedAlbumChoice(track);
 if(choice?.source!=='musicbrainz')return null;
 const match=/^(musicbrainz:[0-9a-f-]+):([1-9][0-9]{0,2}):([1-9][0-9]{0,2}):([0-9a-f-]+)$/.exec(choice.id);
 return match&&musicBrainzId(match[1])&&Number(match[2])<=200&&Number(match[3])<=200&&MB_UUID.test(match[4])?match[1]:null;
}
