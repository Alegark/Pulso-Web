import './album-metadata.css';

export interface AlbumMetadataInfoProps {
  track: { current: number | null; total: number | null } | null;
  disc: { current: number | null; total: number | null } | null;
  albumArtist: string | null;
  compilation: boolean | null;
}

function ordinal(value: AlbumMetadataInfoProps['track']): string {
  if (value === null) return 'No indicado';
  const current = value.current === null ? 'Número no indicado' : `Número ${value.current}`;
  return value.total === null ? current : `${current}; total declarado ${value.total}`;
}

export function AlbumMetadataInfo({ track, disc, albumArtist, compilation }: AlbumMetadataInfoProps) {
  if (track === null && disc === null && albumArtist === null && compilation === null) return null;

  return (
    <section className="album-metadata-info" aria-label="Datos declarados en el archivo">
      <p>Datos declarados en el archivo</p>
      <dl>
        <div><dt>Pista</dt><dd>{ordinal(track)}</dd></div>
        <div><dt>Disco</dt><dd>{ordinal(disc)}</dd></div>
        <div><dt>Artista del álbum</dt><dd>{albumArtist ?? 'No indicado'}</dd></div>
        <div><dt>Recopilación</dt><dd>{compilation === null ? 'No indicado' : compilation ? 'Sí' : 'No'}</dd></div>
      </dl>
    </section>
  );
}
