# T32 · Borrado real de descargas de álbumes, gestión manual seleccionable y caché en dos modos (v67)

- **Método:** ODD (`doc/SPEC.md` §C.5 y §V.2)
- **Estado:** Validada en local (unitarias, Cloudflare, servidor, matrices Chromium+WebKit y revisión independiente `Seguro publicar v67`); pendiente de publicación en Cloudflare, verificación en vivo HTTPS y aceptación física en iPhone (`docs/IPHONE-ACEPTACION.md`, 16 pruebas NO EJECUTADAS).
- **Fecha:** 2026-11-27
- **Línea base:** v66 publicada (`/releases/c70c6318de067d99.html`, despliegue `2b4a6230-af7e-4ef7-8b89-7f978596d553`, versión 69, rama `release/v66`).
- **Requisitos SPEC vinculados:** W05, W06, W07, W08, W17, W18 · **Invariantes SPEC:** V11, V13–V16 (T13/T16 borrado verificado con CAS, valla de generación, recibo terminal y protección runtime), V21, V27, V29, V30, T26 (`A01`/`A02b` revocación de ObjectURLs y frontera de cuenta en `pulso-web-cache-v1`).
- **Evidencia de origen (2026-11-27):** Cuatro defectos reales reportados por el propietario en uso real de v66:
  1. **«Retirar álbum» no borra las descargas del álbum.**
  2. **«Gestionar descargas» muestra canciones de playlists como álbumes individuales de 1 canción.**
  3. **«Gestionar descargas» no permite seleccionar canciones** (checkboxes deshabilitados con `· En uso` y objetivo táctil de solo `22×22 px`).
  4. **Limpiar caché necesita dos modos claros:** solo canciones no guardadas (caché de escucha) vs. toda la caché (canciones no guardadas + portadas + búsquedas), sin tocar nunca Biblioteca, álbumes guardados, playlists, Favoritos ni la sesión de Telegram.

---

## 1. Auditoría de causa raíz (código actual)

### 1.1 «Retirar álbum» conserva todas las descargas (`U-V67-02`)
1. **Protección de la cola de reproducción tras escuchar el álbum (V64-09):**
   - Al reproducir cualquier canción de un álbum, V64-09 encola todas las pistas descargadas del álbum en `player.entries` y persiste la cola en IDB `settings['library-playback']`.
   - `previewCollectionRemoval()` (`src/library/collection-removal.ts:86`) marca como `protectedCopy` toda pista presente en `s.queued` (`settings['library-playback']`), dejando `copiesEligible = 0` y `retainedShared = N`.
   - Incluso al confirmar, tres barreras encadenadas bloquean el borrado si las pistas siguen en cola:
     1. `sourceProtection.reserve(token, target)` (`src/playback/local-copy-protection.ts:303-305`) devuelve `blocked('player-current' | 'player-prepared' | 'source-retained')`.
     2. `strictPolicy()` (`src/library/local-copy-removal.ts:91`) rechaza cualquier activo cuya pista (o alias con misma huella) siga en `settings['library-playback']`.
     3. **Restricción crítica de bundles (`src/playback/local-copy-protection.ts:89-92,273`):** un `BundleRecord` (`PreparedLocalSources`) agrupa varias pistas en un solo recurso indivisible. Si se elimina solo un subconjunto de `player.entries` sin retirar el bundle completo, `inUse(record)` sigue siendo `true` y los orígenes ya no referenciados pasan a `retainedSources`, haciendo que `sourceProtection.reserve()` siga devolviendo `blocked('source-retained')`.
2. **Pistas en caché de escucha dentro de álbumes guardados:**
   - `libraryAlbumCards()` (`src/library/saved-albums.ts:154-155`) ya calcula `coverTrackIds` (todas las pistas resueltas localmente del álbum guardado, incluyendo caché de escucha) y `trackIds` (solo `included` = `addedTrackIds`).
   - `affectedFor()` (`src/library/collection-removal.ts:74-75`) devuelve solo `group.trackIds`, omitiendo las pistas de un álbum guardado que fueron descargadas en caché de escucha (`membership.added === false`).
   - Paralelamente, `albumRemovalMembership()` (`src/library/saved-albums.ts:172`) calcula `otherSavedTrackIds` sobre `card.trackIds`; al incluir `coverTrackIds` en `affectedFor()`, `otherSavedTrackIds` debe usar `card.coverTrackIds` para álbumes guardados, evitando borrar una pista en caché que también pertenece a otro álbum guardado.

### 1.2 «Gestionar descargas» crea álbumes falsos de 1 canción para pistas de playlists (`U-V67-03`)
- `groupStorageDownloads()` (`src/library/storage-groups.ts:7,16`) pasa todos los `tracks` (sin filtrar por `addedTrackIds`) a `libraryAlbumCards(tracks, savedAlbums, aliases)`.
- Toda canción descargada únicamente en una playlist (`added: false`) con etiqueta `album` genera un grupo `kind: 'album'` independiente de 1 canción en `StorageSettings`.
- `src/main.tsx:1589` ya dispone de `addedTrackIds` en el mismo ámbito, pero no se lo pasa a `groupStorageDownloads()`.

### 1.3 «Gestionar descargas» bloquea la selección y carece de fila tocable (`U-V67-04`)
- `src/main.tsx:1590-1593` calcula `protectedAssetIds` incluyendo `protectedCopies.current`, **toda** `protectedCopies.prepared` (hasta 72 pistas de la cola actual/pausada) y `protectedCopies.retainedSources`, y marca cada ítem como `protected: inUse`.
- `StorageSettings.tsx:16,30` deshabilita el checkbox (`disabled={!item.removable || item.protected || !canClean}`) y excluye esos ítems de `eligible` («Seleccionar todas» / «Quitar todas las descargas»).
- En `StorageSettings.tsx:30`, el `<input type="checkbox">` de `22×22 px` (`settings-layout.css:59`) está suelto como hermano de `<div>`; tocar el título/artista de la fila no cambia la selección (incumple ergonomía móvil `≥ 44 px`).

### 1.4 Limpiar caché solo ofrece caché de escucha (`U-V67-05`)
- `StorageSettings.tsx:38` solo expone `Limpiar caché de escucha`, deshabilitado cuando `cacheCopies === 0`.
- No existe forma de limpiar la caché persistente de portadas (`pulso-web-cache-v1` vía `purgeArtworkAccount()` en `src/cache/persistent-artwork.ts:74` + `PlayerArtworkCache` en `src/library/player-artwork-cache.ts:49`) ni las cachés de búsqueda en memoria:
  - `src/library/catalog-artwork.ts:10,52` (`searchCache` + `transientArtwork`),
  - `src/library/music-suggestions.ts:76` (`cache` en `createMusicSuggestionsClient`),
  - `src/library/album-catalog.ts:159` (`ITunesAlbumCatalog.cache`),
  - `src/library/musicbrainz-catalog.ts:64` (`MusicBrainzCatalog.cache`),
  instanciadas a nivel de módulo en `MusicSearchController.tsx:33-34`, `ArtistCatalogView.tsx:6` y `AlbumPageController.tsx:30`.

---

## 2. Preservación de invariantes T13/T16/V13–V16 (arquitectura de evicción limpia)

> **Principio rector:** `strictPolicy` (`src/library/local-copy-removal.ts:91`), `sourceProtection.reserve` (`src/playback/local-copy-protection.ts:303-305`) y el CAS canónico de `confirmCollectionRemoval` (`src/library/collection-removal.ts:107`) **NO se debilitan ni se relajan**. La evicción ocurre **antes** de la reserva y de la confirmación de bajo nivel, únicamente tras el consentimiento explícito del usuario.

### 2.1 Distinción estricta de estados de uso
| Estado | Condición exacta | Comportamiento en UI | Al confirmar borrado |
|---|---|---|---|
| **En uso activo no descartable** (`protected: true`) | `protectedCopies.unknown === true`, o `aliases.some(t => pendingTrackIds.has(t.id))` (preparación/inserción de cola en curso), o importación/descarga/recuperación activa (`!canOrganize`) | Checkbox **`disabled`**, etiqueta `· En uso`, excluido de `eligible` | Nunca se selecciona ni se intenta eviccionar |
| **En cola de reproducción** (`inQueue: true`, `protected: false`) | `!protectedCopies.unknown`, sin `pendingTrackIds`, presente en `current`, `prepared` o `retainedSources` | Checkbox **habilitado** (seleccionable), etiqueta informativa `· En cola` | Se evicciona limpiamente de la cola **al confirmar** (nunca al previsualizar) |
| **Sin uso** (`inQueue: false`, `protected: false`) | Ninguna de las anteriores | Checkbox **habilitado**, sin etiqueta extra | Se retira sin tocar la cola ni detener la reproducción en curso |

### 2.2 Operación `evictFromQueue(trackIds, assetIds)` en `src/main.tsx`
Se invoca **solo tras consentimiento confirmado** (dentro de `CollectionRemovalController.confirm` o `DownloadRemovalController.confirm`, con `gate(true)` activo):
1. Determina si alguna entrada de `player.entries`, `suspendedSnapshot` o algún origen de `sourceProtection.getReadonlySnapshot()` (`current`, `prepared`, `retainedSources`) coincide con `trackIds` o `assetIds`.
2. **Si no hay coincidencia:** retorna `{ evicted: false }` inmediatamente (no-op; si suena otra canción no afectada, **sigue sonando sin interrupción**).
3. **Si hay coincidencia:**
   1. Cancela inserciones pendientes: `queueInsertions.cancelAll('replaced'); await queueInsertions.whenSettled();`. Revalida el guard `current()`; si caducó, aborta fail-closed.
   2. Calcula `survivingEntries = currentEntries.filter(e => !evictTrackSet.has(e.trackId))` (y su `shuffleOrder` filtrado si existía), preservando el resto de la cola en disco si había otras canciones no borradas.
   3. **Libera todos los bundles runtime** (necesario porque un `BundleRecord` es indivisible y cualquier origen sobrante pasaría a `retainedSources`):
      - `player.suspend();` (pausa y descarga `<audio src="">`)
      - `player.setQueue([]);`
      - `suspendedSnapshot = undefined;`
      - `clearMediaSession();`
      - `sourceProtection.invalidateScope();`
      - `await sourceProtection.releaseUnused();`
   4. Comprueba `sourceProtection.getReadonlySnapshot().unknown === false` y que no quedan `current` / `prepared` / `retainedSources` del conjunto a eviccionar.
   5. **Persiste la cola depurada en `settings['library-playback']`** dentro de una transacción `readwrite` acotada (usando `flushQueue` con `survivingEntries` si quedan entradas, o `{ version: 1, entries: [], currentEntryId: null, position: 0, repeat: player.repeat, shuffleOrder: null }` si queda vacía; actualizando `savedCheckpoint`).
      - **Resultado garantizado:** tanto `sourceProtection` en RAM como `settings['library-playback']` en IDB quedan 100 % libres de las pistas eviccionadas antes de iniciar `discoverCopyRemoval` / `reserve` / `planUnreferencedCopyRemoval` / `planCopyRemoval`.
      - `strictPolicy` (`local-copy-removal.ts:91`) y `sourceProtection.reserve` (`local-copy-protection.ts:303-305`) pasan por su camino normal **sin ninguna excepción ni debilitamiento**.

### 2.3 Secuencia segura en `CollectionRemovalController.confirm()` (sin romper CAS)
Dado que `confirmCollectionRemoval` verifica `s.canonical === d.snapshot.canonical` y `canonical` incluye `rawQueue` (`settings['library-playback']`):
1. Al abrir el panel (`start`): llama `core.previewCollectionRemoval(selection, r.context, { evictQueued: !!host.evictFromQueue })`.
   - **No muta la cola ni pausa el audio** (preserva `activeAudioContinuesAndPause` de `check-collection-removal-final-main.mjs`).
   - El preview reporta `copiesEligible` contando también las copias que solo estaban retenidas por la cola, y expone `queuedTrackIds: readonly string[]` (todas las `track.id` relacionadas —activas o alias por huella— presentes en `s.queued` para las copias elegibles).
2. Al confirmar (`confirm`):
   - Si `summary.queuedTrackIds.length > 0 && host.evictFromQueue`:
     1. Ejecuta `const evicted = await host.evictFromQueue(summary.queuedTrackIds, [])`. Si devuelve `false` o caduca `live(r)`, falla cerrado (`metadata: 'not-committed'`, sin borrar nada).
     2. Libera el token previo (`core.releaseCollectionRemovalPreview(token)`) y ejecuta un **re-preview fresco** `const fresh = await core.previewCollectionRemoval(r.selection, r.context)` (con `evictQueued: false`, ya que las pistas ya salieron de `library-playback`).
     3. Verifica coherencia organizativa: `fresh.tracks === summary.tracks && fresh.copiesEligible === summary.copiesEligible && fresh.retainedShared === summary.retainedShared`. Si algo cambió concurrentemente (p. ej. otra pestaña marcó favorito o añadió a playlist), libera `fresh.token` y falla cerrado con `reason: 'collection-changed'`.
     4. Llama `core.confirmCollectionRemoval(fresh.token, consent, r.context, cleanupHost)`.
   - Si `summary.queuedTrackIds.length === 0`: llama directamente `core.confirmCollectionRemoval(token, consent, r.context, cleanupHost)` sin lecturas adicionales.

### 2.4 Secuencia segura en `DownloadRemovalController.confirm()`
1. Al abrir `DownloadRemovalDialog` (`start`): no toca la cola; si el usuario cancela, la reproducción sigue intacta.
2. Al confirmar (`confirm`): antes del bucle `for (const entry of r.entries)`:
   - Si `host.evictFromQueue`, llama `const ok = await host.evictFromQueue(r.entries.map(e => e.trackId), r.entries.map(e => e.asset.id))`.
   - Si `!ok || !live(r)`, detiene antes de tocar ningún archivo (`state: 'uncertain' | 'blocked'`, `removed: 0`).
   - Luego ejecuta el bucle existente `discoverCopyRemoval` → `reserve` → `prepareRuntime` → `planCopyRemoval` → `confirmCopyRemoval` → `acknowledgeCopyRemoval` sin cambios.

---

## 3. Requisitos verificables (`U-V67-02` a `U-V67-05`)

| ID | Área | Requisito y criterio de aceptación verificable |
|---|---|---|
| **U-V67-02** | Borrado real al retirar álbum (`saved-albums.ts`, `collection-removal.ts`, `collection-removal-state.ts`, `CollectionRemovalPanel.tsx`, `main.tsx`) | **(1)** Al pulsar «Retirar álbum» (álbum guardado o álbum local de Biblioteca) incluso después de haber escuchado canciones del álbum (pistas encoladas por V64-09 en `player.entries` / `library-playback`), la vista previa muestra las copias exclusivas del álbum como `copiesEligible > 0` (con aviso si serán retiradas de la cola) sin detener la reproducción hasta confirmar. **(2)** En álbumes guardados, `affectedFor()` incluye `group.coverTrackIds` (pistas en Biblioteca y pistas descargadas en caché de escucha resueltas por el álbum), mientras `albumRemovalMembership()` protege las pistas compartidas con otro álbum guardado usando `otherSavedTrackIds` sobre `coverTrackIds`. **(3)** Al confirmar, las pistas elegibles en cola se eviccionan limpiamente (pausando si suena una de ellas, liberando bundles de `sourceProtection` y actualizando `library-playback`) antes de `confirmCollectionRemoval`, borrando los `assets` y bytes físicos (IDB `chunks` / OPFS) de todas las pistas exclusivas del álbum y conservando las protegidas por Favoritos, playlists u otro álbum guardado. **(4)** `strictPolicy` (`local-copy-removal.ts:91`) y `sourceProtection.reserve` permanecen íntegros; si el usuario cancela, no se pausa ni modifica la cola ni se borra nada. |
| **U-V67-03** | Agrupación correcta en «Gestionar descargas» (`storage-groups.ts`, `main.tsx`) | **(1)** `groupStorageDownloads()` acepta `libraryTrackIds?: ReadonlySet<string>` (desde `main.tsx` se pasa `addedTrackIds`) y pasa `libraryTracks` filtrados a `libraryAlbumCards(albumTracks, savedAlbums, aliases, tracks)`. **(2)** Las canciones descargadas únicamente por pertenecer a una playlist (`added: false`) aparecen dentro de su playlist (y en Favoritos si aplica), **nunca** como álbumes individuales falsos de 1 canción. **(3)** Los álbumes reales de Biblioteca (álbumes guardados con sus `coverTrackIds` descargados y álbumes locales de `libraryTracks`) aparecen como grupos `kind: 'album'`. **(4)** Las descargas sueltas sin playlist ni álbum de Biblioteca (p. ej. caché de escucha suelta o activos huérfanos) se agrupan en «Otras descargas» (`kind: 'other'`). **(5)** Dentro de cualquier playlist, álbum u «Otras descargas», el usuario puede elegir canciones individuales o todas. |
| **U-V67-04** | Selección manual funcional y táctil en «Gestionar descargas» (`main.tsx`, `StorageSettings.tsx`, `DownloadRemovalDialog.tsx`, `download-removal-state.ts`, `settings-layout.css`) | **(1)** En `main.tsx`, `protected` (`· En uso`, checkbox `disabled`) solo marca activos con `protectedCopies.unknown === true` o pistas en `pendingTrackIds` (preparación/inserción activa). Los activos presentes únicamente en la cola (`current`, `prepared`, `retainedSources`) se marcan con `inQueue: true`, `protected: false`, muestran `· En cola` y tienen su checkbox **habilitado**. **(2)** En `StorageSettings.tsx`, cada fila seleccionable envuelve el checkbox y el bloque título/artista/tamaño en un `<label className="storage-download-row">` con altura mínima `≥ 44 px` para seleccionar tocando cualquier punto de la fila (manteniendo `aria-label="Seleccionar <título>"` en el `<input>`). **(3)** Al confirmar en `DownloadRemovalDialog`, si alguna canción seleccionada está en cola o reproduciéndose, se evicciona limpiamente de la cola antes de ejecutar el borrado físico verificado; tras el borrado, los bytes y los `assets` desaparecen y la biblioteca/playlists/favoritos conservan las fichas (`assetId: null`). |
| **U-V67-05** | Limpiar caché en dos modos (`StorageSettings.tsx`, `CollectionRemovalPanel.tsx`, `collection-removal-state.ts`, `persistent-artwork.ts`, `player-artwork-cache.ts`, `catalog-artwork.ts`, `music-suggestions.ts`, `album-catalog.ts`, `musicbrainz-catalog.ts`, `main.tsx`) | **(1)** En Almacenamiento se ofrecen dos modos explícitos: **Modo A (`Limpiar caché de escucha`)** — retira únicamente audios en caché de escucha (eviccionándolos de la cola al confirmar si hace falta), conservando portadas y búsquedas; y **Modo B (`Limpiar toda la caché`)** — disponible con `canClean` incluso si `cacheCopies === 0`, retira audios en caché de escucha (si los hay) **y** purga la caché persistente de portadas de la cuenta (`purgeArtworkAccount(accountId)` en `pulso-web-cache-v1`), rota `PlayerArtworkCache` revocando ObjectURLs (`A01`/`A02b`) y limpia las cachés de búsqueda en memoria (`catalog-artwork.ts`, `music-suggestions.ts`, `album-catalog.ts`, `musicbrainz-catalog.ts`, preservando sus cooldowns de rate-limit). **(2)** Ambos modos requieren consentimiento explícito en el diálogo modal y **jamás tocan** canciones en Biblioteca (`addedTrackIds`), álbumes guardados, artistas guardados, playlists, Favoritos, portadas/letras manuales (`manual: true`) ni la sesión de Telegram (`pulso-web-telegram-session-v1`). |

---

## 4. Diseño exacto por archivo

| Archivo | Cambios exactos |
|---|---|
| `src/library/saved-albums.ts` | En `albumRemovalMembership(cards, key)`: calcular `otherSavedTrackIds` con `card.saved && card.key !== key ? card.coverTrackIds : []`. `detach` sigue siendo `selected?.trackIds.filter(id => !otherSavedTrackIds.has(id)) ?? []`. |
| `src/library/collection-removal.ts` | **(1)** `CollectionPreview` añade `readonly queuedTrackIds: readonly string[]` (siempre congelado, vacío si no aplica). **(2)** `affectedFor()` para `album` usa `[...new Set(group.saved ? group.coverTrackIds : group.trackIds)]`. **(3)** `previewCollectionRemoval(selection, c, options?: { evictQueued?: boolean })`: con `evictQueued === true`, `s.queued.has(t.id)` no bloquea `protectedCopy`; para cada target elegible (`!sharedAlbum && !protectedCopy(asset)`), recopila en `queuedTrackIds` toda `t.id` de `s.tracks` que esté en `s.queued` y coincida con el activo (por `assetId` o huella). **(4)** `confirmCollectionRemoval` **sin cambios** en su CAS ni en su delegación a `strictPolicy`. |
| `src/library/local-copy-removal.ts` | **Sin cambios.** `strictPolicy` (línea 91) conserva íntegra la verificación de `library-playback`. |
| `src/ui/collection-removal-state.ts` | **(1)** `CollectionHost` añade `evictFromQueue?(trackIds: readonly string[], assetIds: readonly string[]): Promise<boolean>` y `clearExtraCaches?(): Promise<boolean>`. **(2)** `CollectionView` añade `readonly cacheMode?: 'audio' | 'all'`. **(3)** `start(selection, title, options?: { cacheMode?: 'audio' | 'all' })`: pasa `{ evictQueued: !!host.evictFromQueue }` a `previewCollectionRemoval`. **(4)** `confirm()`: si `summary.queuedTrackIds.length > 0 && host.evictFromQueue`, evicciona de la cola, libera el preview viejo, hace re-preview con `{ evictQueued: false }`, valida igualdad de `tracks`/`copiesEligible`/`retainedShared` y ejecuta `confirmCollectionRemoval`. Si `cacheMode === 'all'` y `summary.copiesEligible === 0`, omite `confirmCollectionRemoval` y llama directamente `host.clearExtraCaches()` bajo el mismo `gate` y `refresh()`; si `copiesEligible > 0`, ejecuta `host.clearExtraCaches()` solo tras `outcome.metadata === 'committed' && outcome.cleanup === 'complete'`. |
| `src/ui/CollectionRemovalPanel.tsx` | **(1)** Acepta prop opcional `cacheMode?: 'audio' | 'all'` (default `'audio'`). **(2)** En `kind === 'cache'` con `cacheMode === 'all'`: título `Limpiar toda la caché`, botón `Limpiar toda la caché`, texto explícito de que se borran canciones no guardadas + portadas en caché + búsquedas en memoria y se conservan Biblioteca, álbumes guardados, playlists, Favoritos y Telegram; **no** deshabilita confirmar cuando `summary?.eligibleCopies === 0`. **(3)** Cuando `summary?.queuedTrackIds?.length > 0` en `state === 'ready'`, muestra nota breve: *«Al confirmar, las canciones de esta selección que estén en la cola se retirarán de la cola.»* |
| `src/library/storage-groups.ts` | Añade parámetro opcional `libraryTrackIds?: ReadonlySet<string>` a `groupStorageDownloads(...)`. Usa `const albumTracks = libraryTrackIds ? tracks.filter(t => libraryTrackIds.has(t.id)) : tracks;` y `libraryAlbumCards(albumTracks, savedAlbums, aliases, tracks)`. Para álbumes guardados usa `album.coverTrackIds` al llamar `add(...)`. |
| `src/ui/StorageSettings.tsx` | **(1)** `DownloadItem` añade `inQueue?: boolean`. **(2)** En la lista `.storage-downloads`, cuando `onRemove` existe, envuelve `<input type="checkbox">` + `<div>` en `<label className="storage-download-row" data-disabled={disabled || undefined}>` preservando `aria-label={`Seleccionar ${item.title}`}`. Muestra `item.protected ? ' · En uso' : item.inQueue ? ' · En cola' : ''`. **(3)** Añade prop opcional `onCleanAll?: (button: HTMLButtonElement) => void`: junto a `Limpiar caché de escucha` (`disabled={!canClean || cacheCopies === 0}`), renderiza `Limpiar toda la caché` (`disabled={!canClean}`) cuando `onCleanAll` se suministra. |
| `src/ui/settings-layout.css` | Añade estilos para `.storage-download-row` (`display:flex; align-items:center; gap:.85rem; flex:1; min-block-size:44px; cursor:pointer; padding:.25rem 0`) y `[data-disabled="true"]` (`cursor:default; opacity:.65`), manteniendo 0 desbordamiento a `320 px` 200 %. |
| `src/ui/download-removal-state.ts` | En `confirm()`, antes del bucle por `r.entries`, invoca `if (host.evictFromQueue) { const ok = await host.evictFromQueue(r.entries.map(e => e.trackId), r.entries.map(e => e.asset.id)); if (!ok || !live(r)) { reason = 'queue-eviction-failed'; uncertain = true; ... break; } }` (si `host.evictFromQueue` no se inyecta, el comportamiento previo en tests unitarios queda intacto). |
| `src/ui/DownloadRemovalDialog.tsx` | Aclara en la nota de `state === 'ready'` que las canciones seleccionadas que estén en la cola se detendrán y retirarán de la cola al confirmar, y que los archivos con una operación activa se conservan. |
| `src/library/catalog-artwork.ts` | Exporta `clearCatalogArtworkCaches()` que limpia `searchCache.clear()` y retira/recrea `transientArtwork` (conservando `nextSearch` para respetar rate-limit). |
| `src/library/music-suggestions.ts` | Añade `clearCache(): void` a `MusicSuggestionsClient` (ejecuta `cache.clear()` sin cerrar el cliente ni alterar `nextAt`/`blocked`). |
| `src/library/album-catalog.ts` y `src/library/musicbrainz-catalog.ts` | Añaden `clearCache(): void` en `ITunesAlbumCatalog`, `MusicBrainzCatalog` y `AlbumCatalog` (limpia ambos `Map` sin resetear `documentNext`). |
| `src/ui/MusicSearchController.tsx`, `src/ui/ArtistCatalogView.tsx`, `src/ui/AlbumPageController.tsx` | Registran/exportan limpieza de sus singletons (`suggestionsClient`, `metadataCatalog`, `catalog`) para ser invocados desde `clearSearchCaches()` sin acoplamiento circular. |
| `src/cache/persistent-artwork.ts` y `src/library/player-artwork-cache.ts` | Reutilizan `purgeArtworkAccount(accountId)` y `artworkCache.retire()` existentes (añadiendo retorno `Promise<boolean>` a `purgeArtworkAccount` o wrapper dedicado que informe si la transacción IDB confirmó). |
| `src/main.tsx` | **(1)** Implementa `evictFromQueue(trackIds, assetIds)` según §2.2 y lo conecta a `collectionController` y `downloadRemovalController`. **(2)** Implementa `clearExtraCaches()` (purga `pulso-web-cache-v1` para `account.user.id`, retira y recrea `artworkCache = new PlayerArtworkCache(account.user.id)`, incrementa `artworkRefreshToken`, llama `clearCatalogArtworkCaches()` y `clearSearchCaches()`, emite re-render) y lo conecta a `collectionController`. **(3)** Pasa `addedTrackIds` a `groupStorageDownloads(tracks, playlists, storedAssets, savedAlbums, songAliases, addedTrackIds)`. **(4)** Separa `queuedAssetIds` (`current`, `prepared`, `retainedSources`) de `hardProtected` (`protectedCopies?.unknown === true || aliases.some(t => pendingTrackIds.has(t.id))`) al construir `items` para `StorageSettings`. **(5)** Conecta `onCleanAll` en `StorageSettings` → `openCollection({ kind: 'cache', scope: 'global-listening-cache' }, 'Toda la caché', button, { cacheMode: 'all' })`. |

---

## 5. Impacto en pruebas existentes

### 5.1 Pruebas existentes que se conservan **100 % intactas**
- `tests/unit/local-copy-removal-r91.test.ts` (contratos de consentimiento, tracking y journal).
- `tests/unit/copy-removal-state.test.ts` (máquina de estados de borrado individual).
- `tests/unit/download-removal-state.test.ts` (lote de 100 activos, cancelación, ACK incierto, gate).
- `tests/unit/listening-cache.test.ts` (clasificación de caché de escucha).
- `tests/unit/collection-removal-panel-ui.test.tsx` (conteos verificados e incertidumbre).
- `tests/unit/persistent-artwork-cache.test.ts` y `tests/unit/player-artwork-cache.test.ts`.
- `tests/integration/check-collection-removal-complete.mjs` (`collection-removal-complete.ts`: 35 pistas IDB/OPFS, races cross-tab, valla física, `mixedSavedAlbumRun`, `albumRun`, `uncertainAckRun`).
- `tests/integration/check-collection-removal-core.mjs`, `check-collection-removal-final-*`, `check-copy-removal-*`.
- `tests/integration/check-download-removal-batch.mjs` (Chromium + WebKit con SW real).
- `tests/integration/check-storage-groups.mjs` y `check-storage-groups-main.mjs` (selección paginada, `protected: true` deshabilitado, diálogo y cancelación).
- `tests/integration/check-settings-design.mjs` (botón `Limpiar caché de escucha` exacto, modal con consentimiento y cancelación).
- `tests/integration/check-account-library-main.mjs`.

### 5.2 Pruebas existentes que se **amplían o actualizan**
1. **`tests/unit/storage-groups.test.ts` (ampliación):** se conservan los 4 casos actuales (sin `libraryTrackIds`) y se añaden casos con `libraryTrackIds` verificando que pistas solo de playlist no generan grupos `kind: 'album'`, mientras álbumes guardados (con pistas en caché) y álbumes de Biblioteca sí aparecen, y las descargas sueltas van a `other`.
2. **`tests/unit/saved-albums.test.tsx` (ampliación):** se añaden casos para `albumRemovalMembership` con pista en caché de escucha compartida entre dos álbumes guardados (`otherSavedTrackIds` sobre `coverTrackIds`) y exclusiva de un álbum guardado.
3. **`tests/unit/download-removal-state.test.ts` (ampliación):** caso con `host.evictFromQueue` llamado una sola vez antes del bucle, abortando sin borrar si `evictFromQueue` devuelve `false`.
4. **`tests/integration/check-collection-removal-current.mjs` (`scenario === 'queue'`, actualización explícita):** antes de T32 este escenario verificaba el comportamiento obsoleto donde la cola bloqueaba el borrado de `Exclusiva propia`. Con T32, actualizar `scenario === 'queue'` (en `idb` y `opfs`) para verificar que:
   - abrir el panel NO detiene ni vacía la cola y muestra aviso de retirada de cola;
   - cancelar conserva la cola y el archivo físico;
   - confirmar evicciona la pista exclusiva de la cola, borra sus bytes físicos (`physical === false`, `asset === false`) y conserva `Compartida propia` (que sigue en la otra referencia).

---

## 6. Matriz de trazabilidad y verificación

| ID | Prueba | Nivel | Criterio de paso |
|---|---|---|---|
| **U-V67-02** | `tests/unit/saved-albums.test.tsx` + `tests/integration/check-collection-removal-current.mjs` (IDB + OPFS) + nueva suite `tests/integration/check-v67-storage-removal.mjs` en **Chromium y WebKit** | U / B | Tras reproducir una canción de un álbum guardado (con pistas en Biblioteca y pistas en caché de escucha, encoladas por V64-09), «Retirar álbum» muestra `copiesEligible > 0` sin pausar antes de confirmar; al confirmar, pausa/evicciona de la cola, borra `assets` y bytes físicos (IDB/OPFS) de las pistas exclusivas, conserva pistas en Favoritos/playlists/otro álbum guardado y persiste tras recarga. Cancelar deja audio, cola y archivos intactos. `check-collection-removal-complete.mjs` sigue PASS (`strictPolicy` intacto). |
| **U-V67-03** | `tests/unit/storage-groups.test.ts` + `tests/integration/check-v67-storage-removal.mjs` en **Chromium y WebKit** | U / B | Con canciones descargadas únicamente en una playlist (`added: false`), «Gestionar descargas» muestra la playlist como 1 colección y **0** álbumes falsos de 1 canción; los álbumes guardados y de Biblioteca aparecen como `Álbum`; las descargas sueltas aparecen en `Otras descargas`. |
| **U-V67-04** | `tests/unit/download-removal-state.test.ts` + `tests/integration/check-storage-groups.mjs` + `check-storage-groups-main.mjs` + `tests/integration/check-v67-storage-removal.mjs` en **Chromium y WebKit** | U / B | Con una cola activa/pausada de varias canciones, las canciones en cola muestran `· En cola` con checkbox **habilitado**; tocar cualquier parte de la fila (`<label>` `≥ 44 px`) alterna la selección; una pista con `pendingTrackIds` o `unknown` sigue `disabled` (`· En uso`); confirmar borrado de una selección que incluye la pista actual pausa/evicciona limpiamente y elimina los bytes físicos preservando Biblioteca, playlists y Favoritos. `0` desbordamiento a `320 px` 200 %. |
| **U-V67-05** | `tests/unit/persistent-artwork-cache.test.ts` + `tests/unit/player-artwork-cache.test.ts` + `tests/integration/check-settings-design.mjs` + `tests/integration/check-v67-storage-removal.mjs` en **Chromium y WebKit** | U / B | **Modo A (`Limpiar caché de escucha`):** elimina copias no guardadas (incluso recién reproducidas en cola), conserva entradas en `pulso-web-cache-v1` y cachés de búsqueda, y conserva Biblioteca/álbumes/playlists/Favoritos/Telegram. **Modo B (`Limpiar toda la caché`):** habilitado incluso con `cacheCopies === 0`; elimina copias no guardadas, vacía `pulso-web-cache-v1` de la cuenta activa, rota `PlayerArtworkCache` (sin fugas de ObjectURLs `A01`/`A02b`) y limpia las cachés de búsqueda en memoria (`catalog-artwork`, `music-suggestions`, `album-catalog`, `musicbrainz-catalog`), manteniendo intactos Biblioteca, álbumes guardados, playlists, Favoritos, portadas/letras manuales y `pulso-web-telegram-session-v1`. |
| **T en vivo (Cloudflare)** | Verificación HTTPS de solo lectura / sin destrucción de música real en la versión publicada (Chromium móvil `390×844`) | T | Comprobar en la release desplegada que `Gestionar descargas` no crea álbumes falsos para pistas de playlists, que los checkboxes de pistas en cola están habilitados con fila tocable `≥ 44 px`, que aparecen ambos botones de caché (`Limpiar caché de escucha` y `Limpiar toda la caché`) y que abrir/cancelar cualquier diálogo no modifica ni borra ninguna canción real del propietario ni su sesión de Telegram. |

---

## 7. Evidencia de validación y revisión independiente (pre-publicación v67)

- **Implementación:** `60e15c2`, `325c496`, `c0127a8`, `97d683b`, `999976b` (agrupación de descargas por `addedTrackIds`, protección de `coverTrackIds` en álbumes guardados, `evictFromQueue` con liberación de bundles y actualización de `savedCheckpoint`/`library-playback` incluso en retiradas consecutivas sin recarga, re-preview manteniendo intactos `strictPolicy` y CAS de `confirmCollectionRemoval`, filas táctiles `<label className="storage-download-row">` `≥ 44 px` con `· En cola` habilitado vs. `· En uso` deshabilitado, y limpieza de caché en 2 modos rotando `PlayerArtworkCache` y vaciando las 4 cachés de búsqueda en memoria).
- **Validación ejecutada (`999976b`):** `typecheck`, `typecheck:tests`, `lint`, `build`, `1070/1070` unitarias (`vitest`, incluyendo `search-cache-clear.test.ts`, `storage-groups.test.ts`, `saved-albums.test.tsx`, `download-removal-state.test.ts`), `74/74` Cloudflare, `10/10` servidor Python y `17/17` suites de navegador en Chromium y WebKit (incluyendo `check-v67-storage-removal.mjs` `10/10` en ambos motores con retiradas consecutivas sin recarga, `check-collection-removal-current.mjs` `queue` `3/3`, `check-storage-groups-main.mjs` `6/6`, `check-settings-design.mjs` `8/8` y `check-collection-removal-complete.mjs`).
- **Revisión independiente (Antigravity `gemini-4-neon` medio):** primera ronda detectó 1 Alto (`evictFromQueue` en segunda retirada consecutiva sin recarga), 1 Medio (`cp('dist', ...)` en prueba) y 1 Bajo (texto de consentimiento en `cacheMode === 'all'`), los 3 corregidos en `999976b`; revisión delta independiente PASS (0 Bloqueantes, 0 Altos, 0 Medios, 0 Bajos) — veredicto **`Seguro publicar v67`**.
- **Pendiente abierto del propietario:** aceptación física en iPhone (`docs/IPHONE-ACEPTACION.md`, 16 pruebas NO EJECUTADAS).
