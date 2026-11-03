import React from 'react';
import './music-search.css';

export interface MusicSearchSuggestionRow {
  id: string;
  kind: 'track' | 'artist' | 'album';
  title: string;
  subtitle: string | null;
  source: 'local' | 'lrclib';
}
export interface MusicSearchProviderRow {
  id: string;
  username: string;
  label: string;
  supported: boolean;
}
export interface MusicSearchResultRow {
  id: string;
  kind: 'audio' | 'option' | 'message';
  title: string;
  subtitle: string | null;
  correlation: 'reply' | 'recent' | 'unknown';
  match: 'compatible' | 'conflict' | 'unknown';
}
export interface MusicSearchPanelProps {
  query: string;
  onQueryChange: (query: string) => void;
  suggestions: readonly MusicSearchSuggestionRow[];
  suggestionsPending: boolean;
  suggestionsError?: string | null;
  suggestionsNotice?: string | null;
  onRetrySuggestions?: () => void;
  externalConsent: boolean;
  onExternalConsentChange: (consent: boolean) => void;
  providerRows: readonly MusicSearchProviderRow[];
  selectedProviderId: string | null;
  onProviderChange: (id: string) => void;
  sessionReady: boolean;
  canSearch: boolean;
  searchPending: boolean;
  botConsent: boolean;
  onBotConsentChange: (consent: boolean) => void;
  onSearch: () => void;
  onChooseSuggestion: (id: string) => void;
  onCancel: () => void;
  results: readonly MusicSearchResultRow[];
  status?: string | null;
  error?: string | null;
  uncertain: boolean;
  selectedResultId: string | null;
  onSelectResult: (id: string) => void;
  /** Non-reviving guard captured by root for this render, never service authority. */
  current: () => boolean;
}

const groups = [['track', 'Canciones'], ['artist', 'Artistas'], ['album', 'Álbumes']] as const;
const correlationLabels = {
  reply: 'Respuesta a la consulta; identidad musical sin confirmar.',
  recent: 'Mensaje reciente; la proximidad temporal no confirma su identidad ni que responda a la consulta.',
  unknown: 'Relación con la consulta desconocida.',
};
const matchLabels = {
  compatible: 'Metadatos compatibles; identidad musical sin confirmar.',
  conflict: 'Conflicto: los metadatos no coinciden con la consulta.',
  unknown: 'Coincidencia musical desconocida.',
};

/** Controlled presentation. Every callback is an explicit gesture; no IO or draft state. */
export function MusicSearchPanel(props: MusicSearchPanelProps) {
  const committed = React.useRef<MusicSearchPanelProps | null>(null);
  React.useLayoutEffect(() => {
    committed.current = props;
    return () => { committed.current = null; };
  });
  const id = React.useId();
  const active = () => committed.current === props && props.current();
  const provider = props.providerRows.find(row => row.id === props.selectedProviderId);
  const ready = props.canSearch && props.sessionReady && !!provider?.supported && props.botConsent && !props.searchPending;
  const choose = (row: MusicSearchSuggestionRow) => {
    if (active() && !props.searchPending && (row.kind !== 'track' || ready)) props.onChooseSuggestion(row.id);
  };
  return <section className="music-search" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`}>Buscar música</h2>
    <form onSubmit={event => {
      event.preventDefault();
      if (active() && ready && props.query.trim()) props.onSearch();
    }}>
      <label htmlFor={`${id}-query`}>Canción, artista o álbum</label>
      <input id={`${id}-query`} type="search" autoComplete="off" maxLength={640} value={props.query}
        aria-describedby={`${id}-query-help`} onChange={event => {
          if (active()) props.onQueryChange(event.currentTarget.value);
        }} />
      <p id={`${id}-query-help`}>Escribir no envía mensajes a Telegram. Elegir una canción envía su título y artista al bot seleccionado si has dado permiso.</p>
      <label className="music-search-check"><input type="checkbox" checked={props.externalConsent}
        onChange={event => { if (active()) props.onExternalConsentChange(event.currentTarget.checked); }} />
        <span>Permitir sugerencias de LRCLIB: se envían la consulta, tu IP y el identificador de la app. Sólo usamos metadatos; no enviamos audio, letras ni datos de cuenta.</span></label>
      <p>Las sugerencias de LRCLIB muestran metadatos de canciones; no confirman disponibilidad en Telegram. <a href="https://lrclib.net/docs" target="_blank" rel="noopener noreferrer">Documentación de LRCLIB</a></p>
      <div className="music-search-suggestions" aria-label="Sugerencias musicales" aria-busy={props.suggestionsPending}>
        {groups.map(([kind, label]) => {
          const rows = props.suggestions.filter(row => row.kind === kind);
          return rows.length > 0 && <div key={kind}><h3>{label}</h3>
            <ul>{rows.map(row => <li key={row.id}><button type="button"
              data-suggestion-id={row.id} disabled={props.searchPending || (kind === 'track' && !ready)}
              onClick={() => choose(row)}>
              <strong><bdi dir="auto">{row.title}</bdi></strong>
              {row.subtitle && <span><bdi dir="auto">{row.subtitle}</bdi></span>}
              <small>{row.source === 'local' ? 'Biblioteca local' : 'LRCLIB'} · {kind === 'track' ? 'Elegir canción' : 'Refinar búsqueda'}</small>
            </button></li>)}</ul>
          </div>;
        })}
      </div>
      <p>Artistas y álbumes son sugerencias derivadas; no garantizan un catálogo ni un álbum completo.</p>
      <div role="status">{props.suggestionsPending ? 'Buscando sugerencias…' : props.suggestionsNotice}</div>
      {props.suggestionsError && <p role="alert">{props.suggestionsError}</p>}
      {props.onRetrySuggestions && props.externalConsent && props.query.trim().length >= 3 && <button type="button" disabled={props.suggestionsPending || props.searchPending}
        onClick={() => { if (active() && !props.suggestionsPending && !props.searchPending && props.externalConsent) props.onRetrySuggestions?.(); }}>{props.suggestionsError ? 'Reintentar sugerencias' : 'Actualizar sugerencias'}</button>}
      <label htmlFor={`${id}-provider`}>Bot para consultar</label>
      <select id={`${id}-provider`} value={props.selectedProviderId ?? ''} disabled={props.searchPending || props.providerRows.length === 0}
        onChange={event => { if (active() && !props.searchPending) props.onProviderChange(event.currentTarget.value); }}>
        <option value="">Elige un bot</option>
        {props.providerRows.map(row => <option key={row.id} value={row.id}>{row.label} · @{row.username.replace(/^@/, '')}{row.supported ? '' : ' · Adaptador pendiente'}</option>)}
      </select>
      {props.providerRows.length === 0 && <p>Aún no has añadido bots. Añádelos en el apartado «Bots de música» de tu conexión a Telegram.</p>}
      {provider && <p>Bot elegido: <bdi dir="auto">@{provider.username.replace(/^@/, '')}</bdi>. {provider.supported ? 'Adaptador de consulta disponible; no garantiza resultados.' : 'Adaptador pendiente: todavía no se puede consultar este bot.'}</p>}
      <label className="music-search-check"><input type="checkbox" checked={props.botConsent} disabled={props.searchPending}
        onChange={event => { if (active() && !props.searchPending) props.onBotConsentChange(event.currentTarget.checked); }} />
        <span>Permitir enviar un mensaje de consulta al bot elegido, visible en mi chat personal de Telegram, sólo al pulsar Buscar en Telegram o elegir una canción. Marcar esta casilla no envía mensajes.</span></label>
      {!props.sessionReady && <p>Conecta Telegram para consultar el bot. Puedes seguir viendo sugerencias musicales.</p>}
      {!props.canSearch && <p>La consulta al bot no está habilitada en este momento.</p>}
      <div className="music-search-actions"><button type="submit" disabled={!ready || !props.query.trim()}>Buscar en Telegram</button>
        {props.searchPending && <button type="button" onClick={() => {
          if (committed.current === props && props.searchPending) props.onCancel();
        }}>Cancelar consulta</button>}</div>
    </form>
    <div role="status">{props.searchPending ? 'Consultando el bot…' : props.status}</div>
    {props.error && <p role="alert">{props.error}</p>}
    {props.uncertain && <p>Resultado incierto: no se ha confirmado la respuesta del bot. No se reintentará ni cambiará de bot automáticamente.</p>}
    <h3>Resultados del bot</h3>
    <p>Elegir un resultado sólo lo selecciona en Pulso; no pulsa botones de Telegram ni obtiene audio.</p>
    <ul className="music-search-results">{props.results.map(row => <li key={row.id} data-result-id={row.id}>
      <strong><bdi dir="auto">{row.title}</bdi></strong>
      {row.subtitle && <p><bdi dir="auto">{row.subtitle}</bdi></p>}
      <p>{row.kind === 'audio' ? 'Referencia de audio; disponibilidad sin verificar.' : row.kind === 'option' ? 'Opción del bot; sin ejecutar.' : 'Mensaje del bot.'}</p>
      <p>{correlationLabels[row.correlation]}</p><p>{matchLabels[row.match]}</p>
      <button type="button" aria-pressed={props.selectedResultId === row.id} disabled={props.searchPending}
        onClick={() => { if (active() && !props.searchPending) props.onSelectResult(row.id); }}>Elegir opción</button>
      {props.selectedResultId === row.id && <p>Descarga y reproducción todavía no disponibles en este paso</p>}
    </li>)}</ul>
  </section>;
}
