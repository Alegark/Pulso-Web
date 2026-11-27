# T33 · Vista de álbum unificada, reproducción continua con pre-descarga inteligente, portadas estables en iOS y precarga rápida (v68)

- **Método:** ODD (`doc/SPEC.md` §C.5 y §V.2)
- **Estado:** Validada en local (unitarias, Cloudflare, servidor, matrices Chromium+WebKit y revisión independiente `Seguro publicar v68`); pendiente de publicación en Cloudflare, verificación en vivo HTTPS y aceptación física en iPhone (`docs/IPHONE-ACEPTACION.md`, 16 pruebas NO EJECUTADAS).
- **Fecha:** 2026-11-27
- **Línea base:** v67 publicada (`/releases/48727d3675574cce.html`, rama `release/v67`, commit `6b786aa`, despliegue `64a6d29f-9f27-4931-81f4-f5e8332c8f89`, versión 70).
- **Requisitos SPEC vinculados:** W03, W05, W06, W07, W08, W10, W11, W17, W18.
- **Invariantes SPEC y tareas previas preservadas:**
  - `doc/SPEC.md`: V2, V3, V5, V6, V7, V8, V9, V10, V12, V13, V14, V15, V16, V20, V23, V24, V27, V28, V29, V30, V31.
  - **T13 / T16 (V13–V16):** motor único `HTMLAudioElement`, `Ownership`, `queueEpoch`/`queueRevision`, `queueInsertions` sin pausar ni reiniciar la pista en curso, restauración pausada, no autoplay sin gesto/intención válida.
  - **T26 (C04, C06, A01, A02b, V64-07):** `artworkPriority()` intacta, prioridad absoluta de portada local y ocultación manual (`manual: true`), revocación estricta de ObjectURLs al deshabilitar/retirar caché o cambiar de cuenta, precarga en una sola transacción `readonly` de `pulso-web-cache-v1`.
  - **T25 / T27:** coordinación serializada de bots, respeto estricto a `FLOOD_WAIT` / `remoteClock`, cero búsquedas concurrentes al bot.
- **Pendiente físico vigente:** `docs/IPHONE-ACEPTACION.md` (16 pruebas físicas en iPhone siguen `NO EJECUTADA`; esta especificación no convierte pruebas de escritorio/Playwright en PASS físico de iPhone).

---

## 1. Auditoría de causa raíz (código real sobre `release/v67` `6b786aa`)

### 1.1 `U-V68-01` · Doble pantalla y botón «Ver álbum completo» en álbumes sincronizados
1. **Apertura condicional por `group.saved` en lugar de `group.editionId`:**
   - `src/main.tsx:1705` (`HomeView` `onOpenAlbum`) y `src/main.tsx:1709-1711` (tarjetas de Biblioteca):
     ```ts
     showLibrary(
       group.saved ? {} : {groupMode:'albums', groupKey:group.key},
       opener,
       group.saved ? {album:{title:group.label, artist:group.artist, editionId:group.editionId, artworkUrl:group.artworkUrl}, saved:true, scope:libraryAlbumScope, opener} : null
     );
     ```
   - `savedAlbums` se guarda solo en IDB local del dispositivo (`src/library/saved-albums.ts:28-31`). En un dispositivo secundario sincronizado por Neon (o en pistas enriquecidas de Spotify), `libraryAlbumCards()` (`src/library/saved-albums.ts:160-165`) devuelve `saved: false` con `editionId` definido (`editions.size === 1`). Al abrir la tarjeta, entra en la vista local filtrada (`CollectionHeader` + `ol.tracks`) y muestra el botón aparte `Ver álbum completo` (`src/main.tsx:1759-1767`).
2. **Opción «Retirar álbum» restringida solo a `savedAlbum`:**
   - `src/main.tsx:1605-1606`: `options` de `albumPage` exige `selectedSavedAlbum`.
   - `src/ui/AlbumPageController.tsx:275`: renderiza `props.albumOptions` solo cuando `savedAlbum` es truthy (`{savedAlbum&&!props.coordinator.running&&!saving&&props.albumOptions}`).
   - Sin embargo, el dominio de retirada (`src/library/collection-removal.ts:59-60,74-75,109-114`) **ya soporta** `{kind:'album', scope:'global-library', key: group.key}` tanto para álbumes guardados como para grupos sincronizados no guardados.
3. **Cierre y efecto de retirada:**
   - `src/main.tsx:1596-1602` (`closeAlbumPage`): cuando `saved: false` y `activeGroup` existe, solo hace `setLibraryAlbumSelection(null)`, devolviendo al usuario a la vista local intermedia en vez de volver a Biblioteca.
   - `src/main.tsx:1608`: solo cierra `libraryDetail` cuando desaparece un `selectedSavedAlbum`, no cuando se retira un álbum sincronizado no guardado (`selectedAlbum.saved === false`).

### 1.2 `U-V68-02` · Reproducción se detiene cuando la siguiente pista no está descargada
1. **Colas solo con pistas ya descargadas:**
   - `src/main.tsx:1483,1489-1514` (`playCollection`): filtra `playableCollection = visible.filter(track => available)` y encola únicamente esas pistas.
   - `src/ui/AlbumPageController.tsx:255-256,269,288` y `src/ui/MusicSearchController.tsx:265-266`: `queueSlots` pone `null` en las pistas no descargadas y `finishPlay` descarta todos los `null`.
2. **Sin contexto de colección activa ni disparo de pre-descarga:**
   - `src/playback/player.ts:150-155,194-200`: `on('ended')` y `next()` solo consultan `player.following()` sobre `player.entries`. Si la siguiente pista de la colección no está descargada, el reproductor la salta (si hay otra descargada después) o termina en `state = 'ended'`.
   - `src/main.tsx:1806,1818`: `canNext` en `NowPlayingView` y `MiniPlayer` es `player.following() >= 0`, bloqueando el botón Siguiente cuando la siguiente canción de la colección aún no está descargada.
3. **Frontera de arquitectura existente:**
   - `Player` (`src/playback/player.ts:81-106`) y `queueInsertions` (`src/playback/queue-insertion-controller.ts:56-148`) **ya soportan** inserción en vivo (`placement: 'next'`) con `sourceProtection.beginInsertion(...)` y `player.insertQueue(...)` **sin pausar, recargar ni reiniciar** la canción en curso (`queueRevision` avanza; `queueEpoch` y `current` permanecen intactos).
   - `TelegramSessionClient` y `bots` viven en `src/ui/TelegramPanel.tsx:57-65`; la coordinación de búsquedas de bot se centraliza en `albumCoordinator` (`src/library/album-download.ts:12-23`), consultado por `MusicSearchController` (`src/ui/MusicSearchController.tsx:284,322`), `LibraryDownloadController` (`src/ui/LibraryDownloadController.tsx:161,185,524`) y `AlbumPageController` (`src/ui/AlbumPageController.tsx:156,223`).

### 1.3 `U-V68-03` · Portada «mosca» en iPhone (aparece un momento y desaparece)
Se identificaron **cuatro causas concurrentes** en el código:
1. **Degradación de visibilidad por `IntersectionObserver` (`src/ui/CollectionCover.tsx:12-19`):**
   - La línea 15 pone `visible = true` de forma síncrona con `getBoundingClientRect()`. La línea 17 ejecuta `setVisible(entries.some(entry => entry.isIntersecting))`.
   - En Safari iOS, desplazamientos con inercia, cambio de barra de direcciones, `hidden` o apertura/cierre de capas disparan callbacks con `isIntersecting: false` → `visible` vuelve a `false` → `CatalogArtwork` recibe `enabled={false}` → `src/ui/CatalogArtwork.tsx:56` ejecuta `revokeAll(); setView(null)` y la portada desaparece a `♪`.
2. **Cabeceras de álbum sin `fallbackTrackIds`, sin `sharedArtworkKey` y sin modo `eager`:**
   - `src/ui/AlbumPageController.tsx:253-254,261`: solo pasa `trackIds={firstCopy ? [firstCopy] : []}` (1 sola pista), sin `sharedArtworkKey` ni `eager`.
   - `src/main.tsx:1729` (`CollectionHeader`): omite `sharedArtworkKey` y `eager`.
3. **Aborto de fallbacks ante `unavailable` en portadas de álbum (`src/ui/CatalogArtwork.tsx:40-45`):**
   - `readArtwork(trackId, ...)` (`src/library/artwork.ts:75-93`) llama a `validateArtwork(blob)` → `createImageBitmap(blob, {imageOrientation:'none'})` (`src/imports/artwork.ts:65`). Ante un fallo de decodificación, conflicto o presión de memoria en esa pista individual, devuelve `{state:'unavailable', failureCode}`.
   - `artworkPriority(local)` (`src/cache/artwork-policy.ts:17-20`) devuelve `'hidden'` para `state === 'unavailable' || manual === true`.
   - En `CatalogArtwork.tsx:44`, esto dispara `revokeAll(); setView(null); return true;`, abortando la consulta de `fallbackTrackIds`, `imageUrl` y `sharedArtworkKey` aunque el álbum tenga otras pistas válidas o portada de catálogo/proveedor.
4. **Parpadeo a `♪` al cambiar `key` durante inspección progresiva (`src/ui/CatalogArtwork.tsx:31,72`):**
   - Mientras `AlbumPageController.tsx:174-180` actualiza `copies` pista a pista, `trackId`/`fallbackTrackIds` cambian → `key` cambia → `view?.key === key` pasa a `false` (`CatalogArtwork.tsx:72`) → `shown` cae a `null` (`♪`) en cada actualización mientras se resuelve el nuevo efecto.

### 1.4 `U-V68-04` · Arranque lento de portadas en Inicio y MTProto frío al abrir colecciones
1. **Precarga de caché de portadas bloqueada en Inicio (`src/main.tsx:1515-1525`):**
   - `src/main.tsx:1523`: `if (page !== 'biblioteca' || settingsOpen || !account.user?.id) return;`.
   - La app arranca en `page === 'inicio'` (`src/main.tsx:1212`), por lo que `artworkCache.preload(...)` no se ejecuta al abrir Pulso. Cada tarjeta de «Tus álbumes» y «Tus playlists» en Inicio hace lecturas IDB individuales en vez de una lectura por lotes `getMany`.
2. **Conexión MTProto suspendida al abrir álbum/playlist con pistas pendientes:**
   - `src/telegram/connection-lifecycle.ts:1` suspende la conexión tras 3 minutos de inactividad (`TELEGRAM_CONNECTION_IDLE_MS`).
   - `client.connectionActivity()` (`src/telegram/session-client.ts:58-67`) despierta el transporte con `warm` sin enviar mensajes a bots, pero hoy solo se invoca al enfocar Buscar o al pulsar ya sobre una canción (`MusicSearchController.tsx:288,316,409`, `LibraryDownloadController.tsx:165`), no al abrir un álbum o playlist con pistas pendientes.

---

## 2. Requisitos verificables (`U-V68-01` a `U-V68-04`)

| ID | Área | Requisito y criterio de aceptación verificable |
|---|---|---|
| **U-V68-01** | Vista de álbum unificada (`main.tsx`, `AlbumPageController.tsx`, `MusicSearchController.tsx`) | **(1)** Abrir cualquier álbum de Inicio o Biblioteca cuyo `editionId !== undefined` abre **directamente** `AlbumPageController` (`libraryView={true}`), tanto si `group.saved === true` como si `group.saved === false` (álbum sincronizado o Spotify). No existe botón «Ver álbum completo» ni pantalla intermedia. **(2)** `Opciones del álbum` ofrece «Retirar álbum» tanto para `savedAlbum` como para álbum sincronizado de Biblioteca con `group.key`, reutilizando `openCollection({kind:'album', scope:'global-library', key}, ...)` y cerrando `libraryDetail` al confirmarse la retirada (sin cerrar al pulsar «Guardar álbum»). **(3)** Si la consulta de catálogo falla sin conexión en un álbum sincronizado (`!savedAlbum && !detail`), `AlbumPageController` ofrece un acceso explícito «Ver pistas locales» que muestra la vista local de sus pistas ya disponibles sin dejar al usuario bloqueado. **(4)** Los álbumes puramente locales (`editionId === undefined`) siguen abriendo la vista local (`CollectionHeader` + `ol.tracks`), sin botón «Ver álbum completo» y con `sharedArtworkKey`. |
| **U-V68-02** | Reproducción continua con pre-descarga inteligente (`continuous-collection.ts`, `main.tsx`, `TelegramPanel.tsx`, `AlbumPageController.tsx`, `MusicSearchController.tsx`, `album-download.ts`) | **(1)** Al iniciar reproducción desde un álbum (`AlbumPageController`) o playlist/colección (`playCollection`), Pulso registra un `ActiveCollectionContext` vinculado a ese `player.queueEpoch` con la secuencia ordenada completa (descargadas y pendientes) y encola inicialmente la subsecuencia contigua descargada hasta el primer hueco (si todas están descargadas, comportamiento idéntico a v67). **(2)** Mientras `player.state === 'playing'`, `repeat !== 'one'` y `!player.shuffleOrder`, al cruzar el umbral (`duration <= 45 s`, `remaining <= 45 s` o `progress >= 0.6`), si la siguiente pista en el orden efectivo no está descargada y pasan todas las guardas de seguridad (`owner`, `navigator.onLine`, `databaseState === 'ready'`, Telegram conectado con bots listos y sin `rate-limit`/operación en curso, sin `albumCoordinator.running`/`dispatching`/`songFlight`, sin retirada/recuperación bloqueante, máx. 1 pista por adelantado), dispara en segundo plano la descarga de **esa única siguiente pista** (caché de escucha para pista de álbum no guardada; copia del `Track` existente para playlist/biblioteca, sin añadir a Biblioteca si no estaba) y la inserta a continuación vía `queueInsertions` (`placement: 'next'`) **sin pausar ni reiniciar la pista en curso**. **(3)** Si la pista actual llega a `ended` mientras la pre-descarga sigue en curso, o si el usuario pulsa **Siguiente** (`NowPlayingView`, `MiniPlayer` o Media Session) hacia una pista pendiente de la colección activa, muestra estado claro (`Preparando siguiente canción…`), completa la descarga, inserta y reproduce automáticamente; cualquier pausa, selección manual, cambio de colección, vaciado de cola, `shuffle` o pérdida de control cancela la continuación inmediatamente (V13/V15). **(4)** Ante error de descarga, ausencia en bots, desconexión o `rate-limit`, **nunca** entra en bucle infinito ni bloquea reproducción: marca la pista como fallida en esa sesión de colección, evita reintentarla automáticamente, inserta la siguiente pista descargada si existe o detiene limpiamente. **(5)** Nunca existen dos búsquedas de bot concurrentes; cualquier acción manual del usuario (elegir canción, descargar colección/álbum, retirar copia, cerrar sesión) tiene prioridad y aborta inmediatamente una pre-descarga en curso. |
| **U-V68-03** | Portadas estables en iOS (`CollectionCover.tsx`, `CatalogArtwork.tsx`, `AlbumPageController.tsx`, `main.tsx`) | **(1)** En `CollectionCover`, una vez que `visible` pasa a `true` con `enabled === true && !favorite`, queda enclavado en `true` y **no** se degrada a `false` por callbacks espurios de `IntersectionObserver` con `isIntersecting: false`; solo se reinicia cuando `enabled` pasa a `false` o `favorite` pasa a `true`. Soporta prop `eager?: boolean` para cabeceras. **(2)** `AlbumPageController` pasa hasta 6 pistas disponibles (`availableTrackIds.slice(0, 6)`), `sharedArtworkKey` (`albumArtworkKey(...)`) y `eager`; `CollectionHeader` pasa `sharedArtworkKey` y `eager`. **(3)** En `CatalogArtwork`, con prop `allowFallbackOnUnavailable?: boolean` (activada solo por `CollectionCover variant="album"`), si `readArtwork(trackId)` devuelve `state === 'unavailable'`, continúa probando `fallbackTrackIds`, `imageUrl` y `sharedArtworkKey` en vez de abortar con `revokeAll(); setView(null)`. Se preservan al 100 % `artworkPriority()` (C04), la ocultación manual (`manual: true`) en pistas individuales y álbumes, y la revocación estricta de ObjectURLs (A01/A02b/C06) al deshabilitar, retirar caché o cambiar de cuenta. **(4)** No hay parpadeo a `♪` cuando cambian `trackId`/`fallbackTrackIds`/`imageUrl` manteniendo la misma identidad visual (`anchor`) y el mismo `cache` con `enabled === true`, limpiando `view` únicamente si la nueva resolución concluye sin portada o se deshabilita/revoca. |
| **U-V68-04** | Precarga rápida al entrar y calentamiento MTProto (`main.tsx`, `AlbumPageController.tsx`, `TelegramPanel.tsx`) | **(1)** `artworkCache.preload(...)` se ejecuta desde el arranque en **Inicio** (`page === 'inicio' || page === 'biblioteca'`, `!settingsOpen`, `!!account.user?.id`), precargando en una sola transacción IDB `readonly` (`getMany`, sin red) las portadas de «Tus álbumes», «Tus playlists» (hasta 4 pistas de mosaico por playlist visible) y primeros álbumes de Biblioteca, acotado al límite de memoria (`maxEntries = 64`). **(2)** Al abrir un álbum (`AlbumPageController`) o playlist/colección (`libraryDetail`) que tenga al menos una pista pendiente de descarga, se invoca `client?.connectionActivity?.()` (despertar MTProto si estaba suspendido) **sin** enviar ninguna consulta a bots ni iniciar descarga alguna. **(3)** Se preserva USD 0 y `doc/SPEC.md` §W03/V5: nunca se descargan MP3 masivos al abrir la app. |

---

## 3. Arquitectura y diseño archivo por archivo (dividido en 2 lotes)

### LOTE 1 · `U-V68-01` + `U-V68-03` + `U-V68-04` (Ronda 1 · `gpt-6.1-terra` medio)

#### 3.1 `src/ui/CollectionCover.tsx` (`U-V68-03`)
- **Contrato de props:**
  ```ts
  export function CollectionCover({
    trackIds,
    variant = 'playlist',
    artworkUrl,
    favorite = false,
    enabled = true,
    sharedArtworkKey,
    eager = false,
  }: {
    trackIds: readonly string[];
    variant?: 'album' | 'playlist';
    artworkUrl?: string;
    favorite?: boolean;
    enabled?: boolean;
    sharedArtworkKey?: string;
    eager?: boolean;
  })
  ```
- **Comportamiento exacto:**
  - Estado inicial: `useState(eager && enabled && !favorite)`.
  - En `useEffect([enabled, favorite, eager])`:
    - Si `!enabled || favorite`: `setVisible(false); return;`.
    - Si `eager`: `setVisible(true); return;` (no crea `IntersectionObserver`).
    - Comprobación síncrona de viewport (`rect.width > 0 && rect.height > 0 && rect.bottom >= -80 && rect.top <= window.innerHeight + 80`): si cumple, `setVisible(true); return;` (ya está enclavado, no hace falta observar).
    - Si `typeof IntersectionObserver === 'undefined'`: `setVisible(true); return;`.
    - En el callback del `IntersectionObserver`:
      ```ts
      const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      }, {rootMargin: '80px'});
      ```
      **Crucial:** nunca llama `setVisible(false)` desde el observer; desconecta tras enclavar en `true`.
  - Cuando `variant === 'album'`, renderiza `<CatalogArtwork ... allowFallbackOnUnavailable enabled={enabled && visible} />`.

#### 3.2 `src/ui/CatalogArtwork.tsx` (`U-V68-03`)
- **Contrato de props:** añadir `allowFallbackOnUnavailable?: boolean` (por defecto `false`).
- **Estado `view`:**
  ```ts
  const [view, setView] = React.useState<{
    key: string;
    anchor: string | null;
    url: string;
    cache: PlayerArtworkCache | null;
  } | null>(null);
  const anchor = identity ?? imageUrl ?? trackId ?? null;
  ```
- **Regla en `localWins()` (líneas 39-52):**
  ```ts
  if (trackId) {
    const local = await readArtwork(trackId, !!(imageUrl || identity));
    if (!active()) return true;
    if (local.state === 'ready') { publish(local.blob); return true; }
    if (artworkPriority(local) === 'hidden') {
      if (!(allowFallbackOnUnavailable && local.state === 'unavailable')) {
        revokeAll(); setView(null); return true;
      }
    }
  }
  for (const candidateId of [...new Set(fallbackTrackIds ?? [])].filter(id => id !== trackId).slice(0, 6)) {
    const candidate = await readArtwork(candidateId, true);
    if (!active()) return true;
    if (candidate.state === 'ready') { publish(candidate.blob); return true; }
  }
  return false;
  ```
  - **Preservación de invariantes:**
    - `src/cache/artwork-policy.ts` (`artworkPriority`) **NO se modifica** → C04 en `tests/unit/persistent-artwork-cache.test.ts` sigue 100 % verde.
    - Si `allowFallbackOnUnavailable === false` (filas de pista, `MiniPlayer`, `persistent-cache-fixture.ts`): tanto `manual: true` como `unavailable` siguen ocultando con `revokeAll(); setView(null); return true;`.
    - Si `allowFallbackOnUnavailable === true` (solo `CollectionCover variant="album"`): `manual: true` sigue ocultando; solo `local.state === 'unavailable'` continúa hacia `fallbackTrackIds`, `imageUrl` y `sharedArtworkKey`.
- **Anti-parpadeo sin fuga entre elementos ni incumplimiento de A01/A02b:**
  - En el efecto principal: llevar `let published = false;` (actualizado a `true` dentro de `publish(blob)`).
  - Al finalizar el bloque `async` del efecto: si `active() && !published`, ejecutar `revokeAll(); setView(null);`.
  - Cálculo de `shown`:
    ```ts
    const sameVisual = view?.key === key || (allowFallbackOnUnavailable && anchor !== null && view?.anchor === anchor);
    const shown = enabled && !cache?.signal.aborted && view?.cache === cache && sameVisual ? view : null;
    ```
  - En `!enabled || cache?.signal.aborted`: `shown` es `null` de inmediato y el efecto ejecuta `revokeAll(); setView(null);`. Al cambiar `cache` (cambio de cuenta/retiro), `view.cache !== cache` oculta de inmediato y el cleanup `[cache, revokeAll]` revoca todos los ObjectURLs.

#### 3.3 `src/ui/AlbumPageController.tsx` (`U-V68-01`, `U-V68-03`, `U-V68-04`)
- **Importar** `albumArtworkKey` desde `../library/player-artwork-cache`.
- **Nuevas props opcionales:**
  - `onShowLocalTracks?: () => void` (pasada por `main.tsx` solo para álbumes sincronizados no guardados con pistas locales).
- **Portada de cabecera (`U-V68-03`, líneas 253-261):**
  - Reemplazar `firstCopy` por `coverTrackIds = [...new Set(availableTrackIds)].slice(0, 6)`.
  - Calcular `coverSharedKey = albumArtworkKey({editionId: detail?.edition.id ?? props.editionId, album: detail?.edition.title ?? props.title, artist: detail?.edition.artist ?? props.artist})`.
  - Renderizar:
    ```tsx
    <CollectionCover
      variant="album"
      artworkUrl={albumImage}
      trackIds={coverTrackIds}
      sharedArtworkKey={coverSharedKey}
      enabled={props.visible}
      eager
    />
    ```
- **Opciones del álbum (`U-V68-01`, línea 275):**
  - Cambiar `{savedAlbum&&!props.coordinator.running&&!saving&&props.albumOptions}` a `{!props.coordinator.running&&!saving&&props.albumOptions}`.
  - Como `albumOptions` solo se pasa desde `main.tsx` para `libraryAlbum` (nunca desde Buscar), el botón «Retirar álbum» aparece tanto para `savedAlbum` como para álbumes sincronizados de Biblioteca.
- **Fallback offline limpio (`U-V68-01`, línea 264):**
  - Junto a `Reintentar consulta` (cuando `retryTarget !== undefined && !detail`), añadir:
    ```tsx
    {props.libraryView && props.onShowLocalTracks && (
      <button type="button" onClick={() => { if (active()) props.onShowLocalTracks?.(); }}>
        Ver pistas locales
      </button>
    )}
    ```
- **Precalentamiento MTProto (`U-V68-04`):**
  - Calcular `const hasPendingTracks = !!detail && detail.tracks.length > availableTrackIds.length;`
  - Añadir `useEffect`:
    ```ts
    React.useEffect(() => {
      if (!props.visible || props.metadataOnly || !detail || !hasPendingTracks) return;
      props.client?.connectionActivity?.();
    }, [props.visible, props.metadataOnly, detail?.edition.id, hasPendingTracks, props.client]);
    ```
  - Solo llama `connectionActivity()` (nunca `restore`, nunca búsquedas ni descargas).

#### 3.4 `src/ui/MusicSearchController.tsx` (`U-V68-01`)
- En `LibraryAlbumPage` (líneas 39-47): añadir `onShowLocalTracks?: () => void`.
- En el render de `<AlbumPageController .../>` (línea 422): propagar `onShowLocalTracks={props.libraryAlbum?.onShowLocalTracks}`.

#### 3.5 `src/ui/TelegramPanel.tsx` (`U-V68-04`)
- Añadir prop opcional `warmConnectionSignal?: number` (o `onClientWarm?: (fn: () => void) => void`; un simple `warmConnectionSignal?: number` que en `TelegramPanel` dispara `client.current?.connectionActivity?.()` cuando incrementa > 0 evita referencias mutables y es 100 % determinista).
  ```ts
  React.useEffect(() => {
    if (!warmConnectionSignal) return;
    client.current?.connectionActivity?.();
  }, [warmConnectionSignal]);
  ```

#### 3.6 `src/main.tsx` (`U-V68-01`, `U-V68-03`, `U-V68-04`)
1. **Vista de álbum unificada (`U-V68-01`):**
   - Extender el tipo de `libraryAlbumSelection` (línea 1223):
     ```ts
     const [libraryAlbumSelection, setLibraryAlbumSelection] = React.useState<{
       album: Omit<LibraryAlbumPage, 'onBack' | 'options' | 'fixedDetail' | 'onShowLocalTracks'>;
       saved: boolean;
       groupKey: string;
       scope: string;
       opener: HTMLButtonElement;
     } | null>(null);
     ```
   - Helper común `openLibraryAlbum(group, opener)` usado tanto en `HomeView.onOpenAlbum` (línea 1705) como en las tarjetas de Biblioteca (líneas 1709-1711):
     ```ts
     function openLibraryAlbum(group: (typeof libraryAlbums)[number], opener: HTMLButtonElement) {
       const artworkUrl = group.saved ? group.artworkUrl : group.trackIds.map(id => catalogCovers.get(id)).find(Boolean);
       if (group.editionId !== undefined) {
         showLibrary(
           group.saved ? {} : {groupMode: 'albums', groupKey: group.key},
           opener,
           {album: {title: group.label, artist: group.artist, editionId: group.editionId, artworkUrl}, saved: group.saved, groupKey: group.key, scope: libraryAlbumScope, opener},
         );
       } else {
         showLibrary({groupMode: 'albums', groupKey: group.key}, opener, null);
       }
     }
     ```
   - En `closeAlbumPage()` (líneas 1596-1602): llamar siempre a `closeLibraryDetail()` (elimina la pantalla intermedia al volver).
   - En `showLocalAlbumTracks()` (fallback offline): `setLibraryAlbumSelection(null);` (como `showLibrary` ya configuró `{groupMode: 'albums', groupKey: group.key}`, la vista local de pistas del álbum aparece de inmediato).
   - En `albumPage` (líneas 1603-1607):
     ```ts
     const selectedLooseAlbum = selectedAlbum && !selectedSavedAlbum
       ? libraryAlbums.find(group => !group.saved && group.key === selectedAlbum.groupKey)
       : undefined;
     const albumRemovalKey = selectedSavedAlbum
       ? savedAlbumGroupKey(selectedSavedAlbum.edition.id)
       : selectedLooseAlbum?.key;
     const albumRemovalTitle = selectedSavedAlbum?.edition.title ?? selectedLooseAlbum?.label ?? selectedAlbum?.album.title ?? '';
     const albumPage = selectedAlbum && (!selectedAlbum.saved || selectedSavedAlbum) ? {
       ...selectedAlbum.album,
       fixedDetail: selectedAlbum.saved ? selectedSavedAlbum : undefined,
       onBack: closeAlbumPage,
       onShowLocalTracks: selectedLooseAlbum ? () => setLibraryAlbumSelection(null) : undefined,
       options: albumRemovalKey && (
         <button
           type="button"
           className="collection-menu-danger"
           data-menu-dismiss-after="true"
           disabled={!owner || busy || copyRemovalBlocked() || queueForeignBlocked()}
           onClick={event => openCollection({kind: 'album', scope: 'global-library', key: albumRemovalKey}, albumRemovalTitle, trackActionOpener(event.currentTarget))}
         >
           Retirar álbum
         </button>
       ),
     } : undefined;
     ```
   - Efecto de cierre al retirar (línea 1608):
     ```ts
     React.useEffect(() => {
       if (!selectedAlbum) return;
       if (selectedAlbum.saved && !selectedSavedAlbum) closeLibraryDetail();
       else if (!selectedAlbum.saved && !selectedSavedAlbum && !selectedLooseAlbum) closeLibraryDetail();
     }, [selectedAlbum, selectedSavedAlbum, selectedLooseAlbum]);
     ```
     (Si el usuario pulsa «Guardar álbum» sobre un álbum sincronizado, `selectedSavedAlbum` pasa a estar definido antes/al desaparecer `selectedLooseAlbum`, por lo que `AlbumPageController` permanece abierto.)
   - **Eliminar** el bloque del botón «Ver álbum completo» en `src/main.tsx:1759-1767`.
2. **Cabecera local (`U-V68-03`, línea 1729):**
   - En `CollectionHeader` `artwork`, añadir:
     `sharedArtworkKey={activeGroup?.kind==='album'&&!selected&&!favorites?albumArtworkKey({editionId:activeGroup.editionId,album:activeGroup.label,artist:activeGroup.artist}):undefined}` y `eager`.
3. **Precarga en Inicio (`U-V68-04`, líneas 1515-1525):**
   - Calcular `preloadKeys` cubriendo:
     - Si `page === 'biblioteca' && libraryDetail`: `pageRows.map(({track}) => track.id)`.
     - Si `page === 'inicio'` o `(page === 'biblioteca' && !libraryDetail)`:
       - `homeLists.slice(0, 12).flatMap(l => l.entries.slice(0, 4).map(e => e.trackId))`
       - `libraryAlbums.slice(0, 24).flatMap(group => albumCoverTracks(group.saved ? group.coverTrackIds : group.trackIds).slice(0, 1))`
       - más las claves `provider:<albumArtworkKey>` y `catalogArtworkKey(artworkUrl)` de `libraryAlbums.slice(0, 24)`.
   - Cambiar la guarda del `useEffect` (línea 1523) de `if (page !== 'biblioteca' || ...)` a:
     `if ((page !== 'inicio' && page !== 'biblioteca') || settingsOpen || !account.user?.id) return;`
4. **Calentamiento MTProto en vista local de playlist/colección (`U-V68-04`):**
   - Estado `[warmConnectionSignal, bumpWarmConnection] = React.useReducer(n => n + 1, 0)`.
   - `React.useEffect`: cuando `page === 'biblioteca' && libraryDetail && !albumPage && !settingsOpen && omittedCopies > 0`, llamar `bumpWarmConnection()`.
   - Pasar `warmConnectionSignal={warmConnectionSignal}` a `<TelegramPanel .../>`.

---

### LOTE 2 · `U-V68-02` Reproducción continua con pre-descarga inteligente (Ronda 2 · `gpt-6.1-terra` medio)

#### 3.7 Nuevo módulo puro `src/playback/continuous-collection.ts`
Módulo de dominio sin dependencias de React ni DOM, 100 % testeable en unitarias:

- **Tipos exportados:**
  ```ts
  export type CollectionSlot =
    | { kind: 'album-track'; slotKey: string; choice: SongChoice; title: string; artist: string | null; trackId: string | null }
    | { kind: 'library-track'; slotKey: string; trackId: string; title: string; artist: string | null };

  export interface ContinuousPrefetchHost {
    canStartPrefetch(): boolean; // owner, online, db ready, telegram connected + bots ready, !rateLimit, !albumCoordinator busy, !copyRemovalBlocked, !queueForeignBlocked, !sourceReview.hasReservation
    isTrackAvailable(trackId: string): boolean;
    resolveSlotTrackId(slot: CollectionSlot): string | null;
    downloadSlot(slot: CollectionSlot, signal: AbortSignal): Promise<
      | { state: 'ready'; trackId: string }
      | { state: 'failed'; channelWide: boolean; message?: string }
      | { state: 'cancelled' }
    >;
    insertNextTracks(trackIds: readonly string[], expectedQueueEpoch: number): Promise<'inserted' | 'rejected' | 'cancelled'>;
    selectAndPlayTrack(trackId: string, expectedQueueEpoch: number): void;
    pauseCurrent(): void;
    getPlayerSnapshot(): {
      queueEpoch: number;
      state: State;
      currentTrackId: string | null;
      currentTime: number;
      duration: number;
      repeat: 'off' | 'one' | 'all';
      shuffled: boolean;
      hasFollowingInQueue: boolean;
      entryTrackIds: readonly string[];
    };
    onStateChange(notice: { waitingTitle: string | null; errorMessage: string | null }): void;
  }
  ```
- **Reglas puras y deterministas:**
  1. **`planInitialCollectionQueue(slots, startIndex, isAvailable)`:**
     - Devuelve `{ queueTrackIds, startQueueIndex }` conteniendo:
       - Todas las pistas disponibles anteriores a `startIndex` (para que «Anterior» funcione).
       - La pista en `startIndex` (debe estar disponible).
       - El prefijo **contiguo** de pistas disponibles inmediatamente posteriores a `startIndex`, deteniéndose en el primer hueco no disponible.
     - Si todas las pistas de `slots` están disponibles, devuelve la lista completa (100 % idéntico a v67).
  2. **`shouldTriggerPrefetch(playerSnapshot)`:**
     - `state === 'playing' && repeat !== 'one' && !shuffled && !hasFollowingInQueue`
     - `Number.isFinite(duration) && duration > 0 && Number.isFinite(currentTime) && currentTime >= 0`
     - `duration <= 45 || (duration - currentTime) <= 45 || (currentTime / duration) >= 0.6`
  3. **`nextPendingSlot(context, currentTrackId, resolveSlotTrackId, isAvailable)`:**
     - Localiza la posición de `currentTrackId` en `context.slots`.
     - Busca el primer slot posterior que NO esté en `context.failedSlots`:
       - Si ya está disponible localmente (`resolveSlotTrackId` + `isAvailable`), devuelve `{ kind: 'already-available', trackId, startSlotIndex }` (para insertarlo sin tocar Telegram).
       - Si no está disponible, devuelve `{ kind: 'needs-download', slot, slotIndex }`.
     - Si `repeat === 'all'` y no hay siguiente posterior, envuelve al índice `0` (una sola vez, omitiendo `failedSlots`).
     - Máximo **1** slot en vuelo (`prefetchingSlotKey !== null` bloquea cualquier segundo disparo).
  4. **Ciclo de vida y cancelación (`ContinuousCollectionController`):**
     - `activate(contextInput: { queueEpoch: number; kind: 'album' | 'playlist' | 'collection'; slots: readonly CollectionSlot[] })`: aborta cualquier pre-descarga anterior y registra el nuevo contexto ligado a `queueEpoch`.
     - `observePlayer(change: 'state' | 'progress')`:
       - Si `player.queueEpoch !== context.queueEpoch` o `player.shuffled`: `clear()` (invalida y aborta).
       - Si `change === 'state' && player.state === 'paused'`: cancela `waitingForNext` (nunca auto-reproduce tras pausa manual).
       - Si `change === 'state' && player.state === 'ended' && !player.hasFollowingInQueue && player.repeat !== 'one'`:
         - Si hay un siguiente slot no fallido: establece `waitingForNext`, emite `Preparando siguiente canción…`, y asegura/inicia su pre-descarga (si ya está en vuelo, espera a que termine).
       - Si `shouldTriggerPrefetch(snapshot)` y `!context.remoteBlocked`:
         - Llama a `startPrefetchIfEligible()` (solo 1 pista por adelantado).
     - `requestNextPending(): boolean`:
       - Invocado por «Siguiente» (`NowPlayingView`, `MiniPlayer`, Media Session) cuando `player.following() < 0`.
       - Si hay siguiente slot no fallido: llama `host.pauseCurrent()`, establece `waitingForNext`, limpia `remoteBlocked` (acción explícita del usuario), muestra `Preparando siguiente canción…` y dispara/adjunta la pre-descarga. Devuelve `true`.
     - `onPrefetchSettled(...)`:
       - Verifica `context === activeContext && player.queueEpoch === context.queueEpoch && !signal.aborted`.
       - Si `ready`: recoge el tramo contiguo disponible empezando en ese slot (`[trackId, ...siguienteContiguoDisponible]`) e invoca `host.insertNextTracks(runTrackIds, context.queueEpoch)`.
         - Si `waitingForNext` seguía activo para ese slot y la inserción fue `'inserted'`: limpia `waitingForNext` y llama `host.selectAndPlayTrack(trackId, context.queueEpoch)`.
       - Si `failed`:
         - Añade `slot.slotKey` a `context.failedSlots`.
         - Si `channelWide`: marca `context.remoteBlocked = true`.
         - Si hay pistas ya descargadas posteriores al slot fallido, inserta la siguiente racha contigua disponible; si `waitingForNext` estaba activo, reproduce esa siguiente descargada si existe, o detiene limpiamente anunciando `No se pudo preparar la siguiente canción.` (**máx. 1 intento de pre-descarga por transición; nunca bucle**).
     - `cancelPrefetch()` / `clear()`: aborta el `AbortController` activo, libera `albumCoordinator.prefetchFlight` y limpia estado.

#### 3.8 `src/library/album-download.ts` (`U-V68-02`)
- Extender `AlbumCoordinator`:
  ```ts
  prefetchFlight?: { token: object; abort: () => void };
  ```
- Exportar helper `abortPrefetchFlight(coordinator: AlbumCoordinator)` que llama `coordinator.prefetchFlight?.abort()` antes de iniciar cualquier operación manual de bot.

#### 3.9 `src/ui/MusicSearchController.tsx`, `src/ui/LibraryDownloadController.tsx` y `src/ui/AlbumPageController.tsx` (`U-V68-02`)
- **Preempción por acción manual (cero concurrencia de bots):**
  - En `MusicSearchController.tsx` (`choose` línea 284, `chooseChoice` línea 322): antes de comprobar si el bot está ocupado, llamar `abortPrefetchFlight(albumCoordinator)` (de modo que el clic manual del usuario nunca sea rechazado por una pre-descarga en segundo plano).
  - En `LibraryDownloadController.tsx` (`enqueue`, `startChecked`, `start`, `reviewTrack`, `ready`):
    - En acciones manuales (`startChecked` no automático, `enqueue`, `reviewTrack`): llamar `abortPrefetchFlight(albumCoordinator)`.
    - En el despachador automático de cola (`ready()` línea 524): comprobar `!albumCoordinator.prefetchFlight` para no colisionar con una pre-descarga ya en curso (o abortarla si la cola explícita del usuario tiene prioridad — abortarla al empezar el job explícito del usuario es aún más limpio porque la descarga explícita del usuario siempre tiene prioridad sobre la pre-descarga).
  - En `AlbumPageController.tsx`:
    - `onChoose` amplía su firma opcionalmente:
      `onChoose: (choice: SongChoice, queueSlots?: readonly (string | null)[], chosenIndex?: number, collectionSlots?: readonly CollectionSlot[]) => void`
    - Construye `collectionSlots` desde `detail.tracks` (cada pista con `kind: 'album-track'`, `slotKey: choice.id`, `choice`, `title`, `artist`, `trackId: queueSlots[index]`).
    - Pasa `collectionSlots` al pulsar ▶ Reproducir (línea 269) y al pulsar cualquier fila de pista (línea 288).
- **Conexión y actualizaciones en `src/ui/TelegramPanel.tsx`:**
  - Línea 61 (`configureConnectionLifecycle`): incluir `albumCoordinator.prefetchFlight` en la guarda de trabajo activo para no suspender MTProto en mitad de una pre-descarga.
  - `registerUpdateBlocker` (línea 48): incluir `!!albumCoordinator.prefetchFlight`.
  - Registrar el runner de pre-descarga en `continuousPrefetchHost` (prop pasada desde `main.tsx`):
    - `isReady()`: `state.phase === 'connected' && !setupNeeded && navigator.onLine !== false && orderedProviders(bots).length > 0 && telegramReady(client.current)`.
    - `downloadSlot(slot, signal)`:
      1. Verifica `isReady()` y `!albumCoordinator.running && !albumCoordinator.dispatching && !albumCoordinator.songFlight && !albumCoordinator.prefetchFlight`.
      2. Captura `attempt = captureSongDownload?.()`. Si `!attempt?.current()`, retorna `{state:'failed', channelWide:true}`.
      3. Instala `albumCoordinator.prefetchFlight = { token, abort: () => abort.abort() }` y `notifyAlbumDownload(albumCoordinator)`.
      4. Construye `choice` (`slot.kind === 'album-track' ? slot.choice : localTrackChoice(track)`).
      5. Llama `attempt.lookup(choice, signal)`: si ya existe copia válida local, retorna `{state:'ready', trackId}` sin tocar Telegram.
      6. Llama `acquireFromOrderedBots({ client, providers, revision, target, signal, current, networkCurrent, remoteClock: albumCoordinator.remoteClock, progress: () => {} })`.
         - Nota: **NO** pasa `collection` ni reintentos largos de cola; ante `rate-limit`, `session-expired`, `network` o `unavailable`, devuelve `{state:'failed', channelWide:true}`. Ante `known-failure`, devuelve `{state:'failed', channelWide:false}`.
      7. Si obtiene `audio`, llama `attempt.save(audio, choice, signal, () => {})`.
         - Para `album-track`: `captureSongDownload` usa `libraryMode: 'cache'` (caché de escucha; no añade a Biblioteca).
         - Para `library-track`: `attempt.lookup` fijó `rememberedId = slot.trackId`, por lo que `attempt.save` ejecuta `attachRestoredAccountTrack` conservando el `Track` y su membresía original sin añadirlo a Biblioteca si solo estaba en una playlist.
      8. En `finally`: limpia `albumCoordinator.prefetchFlight` (si coincide con `token`) y llama `notifyAlbumDownload(albumCoordinator)`.

#### 3.10 `src/main.tsx` (`U-V68-02`)
- Instanciar `continuousCollection = createContinuousCollectionController(host)`.
- En `playCollection(startKey)` (líneas 1489-1514):
  - Construir `slots: CollectionSlot[]` a partir de `visible` (todas las pistas visibles, descargadas o pendientes).
  - Usar `planInitialCollectionQueue(slots, startVisibleIndex, id => trackAvailability(trackIndex.get(id)!, availability) === 'available')`.
  - Tras completar `viewQueue(...)` con el nuevo `player.queueEpoch`, llamar `continuousCollection.activate({ queueEpoch: player.queueEpoch, kind: selected ? 'playlist' : 'collection', slots })`.
  - Si `visible[startVisibleIndex]` no está descargada (caso `!playableCollection.length` o clic directo en pista pendiente de playlist), guardar la intención de contexto pendiente o activarlo al completarse `requestLibraryDownload(..., true)`.
- En `captureSongPlayback.play(trackId, caller, signal, queueTrackIds, collectionSlots)` (`src/main.tsx:619-643`, firma extendida en `src/library/selected-song.ts:35`):
  - Cuando se reciben `collectionSlots`, aplicar `planInitialCollectionQueue` alrededor de `trackId`, encolar la subsecuencia contigua descargada y, tras instalar `player.queueEpoch`, llamar `continuousCollection.activate({ queueEpoch: player.queueEpoch, kind: 'album', slots: collectionSlots })`.
- En `player.subscribe` (`src/main.tsx:1035-1039`):
  - Llamar `continuousCollection.observePlayer(change)`.
- En `insertNextTracks(trackIds, expectedQueueEpoch)`:
  - Usa `queueInsertions.enqueue({ intentId: crypto.randomUUID(), placement: 'next', selection }, { current: () => insertionCurrent() && player.queueEpoch === expectedQueueEpoch })` y espera `handle.result` (sin pausar ni reiniciar la reproducción en curso).
- En controles de transporte (`NowPlayingView` línea 1806-1807, `MiniPlayer` línea 1818 y `installMediaSession` línea 1042):
  - `canNext`: `owner && !busy && !collectionBlocked() && (player.following() >= 0 || continuousCollection.hasNextPending())`.
  - `handleNext`: si `player.following() >= 0`, `player.next()`; si no, `continuousCollection.requestNextPending()`.
- En `NowPlayingView` `status` (línea 1804) y `MiniPlayer` `stateText` (línea 1818):
  - Mostrar `Preparando siguiente canción…` cuando `continuousNotice.waitingTitle` está activo (o el aviso de error breve si falló la transición).
- Cancelación total en `clearQueue`, `prepareRelease`, `pagehide`, `accountBoundary`, `applyDatabaseLifecycle`, `openCollection`/`evictFromQueue`: llamar `continuousCollection.clear()`.

---

## 4. Impacto en pruebas existentes y matriz de trazabilidad nueva

### 4.1 Impacto en pruebas existentes
- **`tests/integration/helpersalbum-library/browser.mjs:397` (caso 62):**
  - Antes: `await card.click();await button('Ver álbum completo').click();await button('Guardar álbum').click();`
  - Cambio requerido por `U-V68-01`: eliminar `await button('Ver álbum completo').click();` porque la tarjeta del álbum Spotify con `editionId: 42` abre directamente `AlbumPageController` donde «Guardar álbum» ya es visible en `Opciones del álbum`.
- **`tests/unit/saved-albums.test.tsx:58-59`:**
  - `renderToStaticMarkup(<CollectionCover variant="album" trackIds={trackIds}/>)` sigue pasando sin cambios (la prop `eager` y `allowFallbackOnUnavailable` son opcionales con valores por defecto compatibles).
- **`tests/unit/persistent-artwork-cache.test.ts` (C04):**
  - Intacto; `artworkPriority()` no cambia.
- **`tests/integration/check-persistent-cache-main.mjs` (C04, C06, C07, V64-07, A01/A02b):**
  - Intacto; debe seguir pasando en Chromium y WebKit (verificar especialmente que `preload` en Inicio no añade peticiones de red ni altera la prueba C03/C05 de 0 peticiones offline).
- **`tests/integration/check-v66-polish.mjs` (`v66-album-cover-fallback`):**
  - Intacto; sigue validando que las portadas de álbumes en Inicio y Biblioteca se muestran y sobreviven a abrir/cerrar reproductor y entrar/salir de detalle.

### 4.2 Matriz de trazabilidad nueva (`T33` · v68)

| ID | Prueba | Nivel | Motores / Entorno | Criterio de paso |
|---|---|---|---|---|
| **U-V68-01** | `tests/unit/saved-albums.test.tsx` (apertura directa cuando `editionId !== undefined` aunque `saved === false`; vista local cuando `editionId === undefined`) + `tests/integration/check-album-library-main.mjs` (`helpersalbum-library/browser.mjs` caso 62 actualizado + caso nuevo: abrir álbum sincronizado desde Inicio/Biblioteca entra directo a `AlbumPageController`, ofrece «Retirar álbum» en `Opciones del álbum`, y ante fallo offline de catálogo ofrece «Ver pistas locales» que abre la lista local sin bloqueo) | U / B | Vitest + Chromium y WebKit | 0 apariciones de botón «Ver álbum completo»; `AlbumPageController` directo con `libraryView=true`; retirada funcional sin `savedAlbum`; fallback offline operativo; álbum puramente local intacto. |
| **U-V68-02** | `tests/unit/continuous-collection.test.ts` (nuevo: `planInitialCollectionQueue`, `shouldTriggerPrefetch` en `<=45s` / `>=60%` / `duration<=45s`, `repeat='one'` y `shuffle` bloquean prefetch, máx. 1 pista por adelantado, `failedSlots` y `remoteBlocked` sin bucles, preempción por pausa/selección/cambio de `queueEpoch`, `ended` durante prefetch y `requestNextPending`) + `tests/integration/check-continuous-playback.mjs` (nuevo: álbum y playlist con pista 1 descargada y pista 2 pendiente; al cruzar umbral en reproducción se pre-descarga pista 2 en segundo plano y se inserta vía `queueInsertions` sin pausar ni reiniciar pista 1; pista de álbum no guardada queda en caché de escucha sin añadirse a Biblioteca; `ended` durante descarga muestra «Preparando siguiente canción…» y reproduce pista 2 al terminar; botón «Siguiente» hacia pista pendiente descarga y reproduce; pausa manual cancela auto-reproducción; fallo/rate-limit no entra en bucle y no bloquea; clic manual en otra canción aborta prefetch sin dos búsquedas concurrentes) | U / B | Vitest + Chromium y WebKit | Continuidad real sin cortes en pista 1; 0 pausas/reinicios al insertar pista 2; 0 mutaciones indebidas en Biblioteca; 0 búsquedas concurrentes al bot; 0 bucles ante fallo/rate-limit; PASS en Chromium y WebKit. |
| **U-V68-03** | `tests/unit/collection-cover-ios.test.tsx` (nuevo: `CollectionCover` enclava `visible=true` y resiste callbacks `isIntersecting: false` repetidos; resetea solo al pasar `enabled=false` o `favorite=true`; `eager=true` muestra sin observer; `CatalogArtwork` con `allowFallbackOnUnavailable` continúa a `fallbackTrackIds`/`imageUrl`/`sharedArtworkKey` cuando `readArtwork` devuelve `unavailable`, pero oculta ante `manual: true` y mantiene C04 en pistas individuales sin `allowFallbackOnUnavailable`) + `tests/integration/check-v66-polish.mjs` ampliado (inyectar callback `IntersectionObserver` con `isIntersecting: false` tras pintar en Biblioteca y dentro de `AlbumPageController` + inyectar `readArtwork` `unavailable` en la primera pista del álbum + verificar 0 parpadeos a `♪`, 0 desaparición de portada y revocación intacta de ObjectURLs al deshabilitar/cambiar cuenta en `check-persistent-cache-main.mjs`) | U / B | Vitest + Chromium y WebKit | Portadas permanecen visibles tras `isIntersecting: false`; fallback activo ante `unavailable` en álbumes; C04/A01/A02b/C06 100 % intactos; PASS en Chromium y WebKit. |
| **U-V68-04** | `tests/unit/telegram-connection-lifecycle.test.ts` (verificar que `connectionActivity()` despierta transporte suspendido sin iniciar búsquedas ni descargas) + `tests/integration/check-persistent-cache-main.mjs` / `check-v66-polish.mjs` (verificar que al abrir en Inicio con caché caliente se dispara `preload` por lotes en 1 transacción IDB `readonly` con 0 peticiones de red, y que al abrir un álbum/playlist con pistas pendientes se llama `connectionActivity()` sin ningún envío al bot ni descarga automática de MP3) | U / B | Vitest + Chromium y WebKit | Precarga desde Inicio en 1 transacción IDB y 0 tráfico de red; `warm` al abrir colección incompleta con 0 RPCs de búsqueda/descarga; PASS en Chromium y WebKit. |

---

## 5. Plan de ejecución en 2 lotes y validación proporcional (`doc/SPEC.md` §V.2)

1. **Ronda 1 — Lote 1 (`U-V68-01` + `U-V68-03` + `U-V68-04`):**
   - Archivos: `src/ui/CollectionCover.tsx`, `src/ui/CatalogArtwork.tsx`, `src/ui/AlbumPageController.tsx`, `src/ui/MusicSearchController.tsx`, `src/ui/TelegramPanel.tsx`, `src/main.tsx`, `tests/integration/helpersalbum-library/browser.mjs`, `tests/unit/collection-cover-ios.test.tsx`, `tests/integration/check-v66-polish.mjs`, `tests/integration/check-persistent-cache-main.mjs`.
   - Validación focal de Ronda 1: `typecheck`, `typecheck:tests`, `lint`, unitarias afectadas (`saved-albums`, `persistent-artwork-cache`, `collection-cover-ios`, `telegram-connection-lifecycle`) y suites de navegador del área (`check-album-library-main.mjs`, `check-v66-polish.mjs`, `check-persistent-cache-main.mjs`) en Chromium y WebKit.
2. **Ronda 2 — Lote 2 (`U-V68-02`):**
   - Archivos: `src/playback/continuous-collection.ts`, `src/library/album-download.ts`, `src/library/selected-song.ts`, `src/ui/AlbumPageController.tsx`, `src/ui/MusicSearchController.tsx`, `src/ui/LibraryDownloadController.tsx`, `src/ui/TelegramPanel.tsx`, `src/main.tsx`, `tests/unit/continuous-collection.test.ts`, `tests/integration/check-continuous-playback.mjs`.
   - Validación focal de Ronda 2: `typecheck`, `typecheck:tests`, `lint`, unitarias afectadas (`continuous-collection`, `player`, `queue-insertion-controller`, `library-download`, `ordered-bot-acquisition`) y `check-continuous-playback.mjs` en Chromium y WebKit.
3. **Cierre pre-publicación (una sola vez antes de publicar v68):**
   - Batería completa (`typecheck`, `typecheck:tests`, `lint`, `build`, todas las unitarias y matrices de navegador en Chromium y WebKit) + revisión independiente (`gemini-4-neon` medio) + actualización de `odd/tasks/T33-*.md` y sincronización Engram verificada.
   - Recordatorio obligatorio: registrar que la aceptación física en iPhone (`docs/IPHONE-ACEPTACION.md`) sigue `NO EJECUTADA` hasta que el propietario la valide en su teléfono real.

---

## 6. Evidencia de validación y revisión independiente (pre-publicación v68)

- **Implementación:** `37726f5` (Lote 1: `U-V68-01`, `U-V68-03`, `U-V68-04`), `de39d34`, `b46fd5f`, `1e0a1a1`, `81e71e0`, `03bcc67`, `a955846`, `694391e` (Lote 2: `U-V68-02` + fix de carrera `savePosition`/`canStartPrefetch` diferido + suite navegador Chromium/WebKit) y `a6c33db` (cierre de los 6 hallazgos de revisión independiente).
- **Validación ejecutada (`a6c33db` / batería de regresión sobre `81e71e0`–`a6c33db`):**
  - `typecheck`, `typecheck:tests`, `lint`, `build`: **PASS**
  - Unitarias (`vitest`): **`1082/1082` PASS** (incluyendo `continuous-collection.test.ts`, `saved-albums.test.tsx`, `persistent-artwork-cache.test.ts` C04 intacto)
  - Cloudflare / Node server: **`74/74` PASS** · Servidor Python: **`10/10` PASS**
  - Navegador **Chromium y WebKit**: `check-v68-continuous-and-album.mjs` **`12/12` Chromium y `12/12` WebKit** (`U-V68-01` Inicio/Biblioteca/offline, `U-V68-04` Inicio offline y `warm`, `U-V68-02a` playlist + álbum caché sin Biblioteca, `U-V68-02b-next`, `U-V68-02b-pause`, `U-V68-02c-rate`, `U-V68-02c-preempt` en playlist y en álbum/Buscar), `check-v66-polish.mjs` **`2/2` × 2** (`U-V68-03` iOS `IntersectionObserver` + `unavailable` fallback), `check-v67-storage-removal.mjs` **`5/5` × 2**, `check-persistent-cache-main.mjs` **`13/13` × 2**, `check-ux-v65.mjs` **`8/8` × 2**, `check-account-library-main.mjs` **`6/6` × 2**, `check-storage-groups-main.mjs` **`3/3` × 2**, `check-settings-design.mjs` **`4/4` × 2**, `check-collection-removal-current.mjs` `queue` **`3/3`**.
- **Revisión independiente (Antigravity `gemini-4-neon` medio):** primera ronda detectó 1 Alto (preempción en `MusicSearchController`), 1 Medio (`waitingOrigin` en `retryTimer`) y 4 Bajos, todos cerrados en `a6c33db`; revisión delta independiente PASS (`0` Bloqueantes, `0` Altos, `0` Medios, `1` Bajo menor sin impacto en concurrencia ni descargas: `await abortPrefetchFlight` en `runAlbumDownload` cede 1 microtask antes de `relaunches.count = 0`) — veredicto **`Seguro publicar v68`**.
- **Pendiente abierto del propietario:** aceptación física en iPhone (`docs/IPHONE-ACEPTACION.md`, 16 pruebas NO EJECUTADAS).
