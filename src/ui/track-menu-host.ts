import type {Playlist, Track} from '../library/library';
export interface TrackMenuHost {
 canOrganize: boolean; canAppend: boolean; playlists: readonly Playlist[];
 libraryTrackIds: ReadonlySet<string>; tracksById: ReadonlyMap<string, Track>; removalEligibleTracks: ReadonlySet<string>;
 onToggleFavorite: (trackId: string) => void; onAddToLibrary: (trackId: string) => void;
 onAddToPlaylist: (playlistId: string, trackId: string) => void;
 onQueueNext: (trackId: string) => void; onQueueLater: (trackId: string) => void;
 onOpenRemoval: (trackId: string, opener: HTMLButtonElement) => void;
 onPlayTracks: (trackIds: readonly string[], shuffle?: boolean) => void; onTogglePlayPause: () => void;
}
