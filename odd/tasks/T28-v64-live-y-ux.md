# T28 · Estabilización en vivo y mejoras de experiencia v64

- **Método:** ODD (`doc/SPEC.md` §C.5 y §V.2)
- **Estado:** Implementación integrada; regresiones A01/A02b y L02 corregidas y verificadas en ambos motores. Validación final y publicación pendientes; Telegram real e iPhone físico no ejecutados.
- **Fecha:** 2026-11-26
- **Línea base:** v63 publicada (`87a4e7d0`, rama `release/v63`), rama de integración `fix/v64-live` (worktree `v64-live`) + rama paralela `fix-sync-503`.
- **Requisitos SPEC vinculados:** W02, W04, W05, W06, W07, W08, W10, W11, W13, W17, W18 · **Invariantes SPEC:** V2, V3, V5, V6, V7, V8, V10, V11, V13, V14, V15, V16, V17, V19, V21, V22, V23, V27, V28, V29, V30, V31
- **Fuentes de evidencia de origen:**
  - Prueba real de Pulso v63 en producción (`2026-11-26`, `.local/research/live-e2e-2026-11-26/report.md`, `https://pulso-web.pruebassoftware.workers.dev`).
  - Cinco cambios solicitados expresamente por el propietario el `2026-11-26`.
  - Pendientes abiertos de v63 (`docs/PENDIENTES.md`: T26 C03/C04 en WebKit).

---

## Propósito

Cerrar los defectos detectados en la prueba real en producción de v63 e incorporar cinco mejoras directas de usabilidad y rendimiento pedidas por el propietario en una sola entrega coherente (`v64`):

1. **Sincronización de biblioteca en producción (HTTP 503):** aislar y resolver el 503 en `/api/account-library` y `/api/account-profile` (trabajo en paralelo en `fix-sync-503`).
2. **Vinculación de opciones del bot con colaboradores/ediciones (D01 «Get Lucky», Daft Punk):** permitir vincular canciones con colaboradores (`feat.`/`ft.`/`&`/`,`) sin relajar J03 de T25 (cero canciones ajenas, covers, remixes ni versiones en vivo), sujeto a la captura real de etiquetas del bot en vivo.
3. **Aviso transitorio «No se pudo guardar la canción» durante lotes:** impedir que un fallo transitorio recuperable de escritura en un álbum o playlist dispare un aviso global de error final mientras el lote continúa y completa la pista.
4. **Barra de reproducción limpia en teléfonos (sin recuadro superior de cola):** retirar el recuadro visual de mensajes de cola sobre `.mini-player` en móvil (incluyendo el aviso contradictorio «Cola lista y pausada. Pulsa Reproducir» al reproducir manualmente), conservando anuncios accesibles (`aria-live`) y errores críticos en su propio contexto.
5. **Caché de portada compartida por álbum + corrección de `♪` en Buscar y recarga lenta en Biblioteca:** compartir una sola miniatura por álbum en `pulso-web-cache-v1` (evitando descargar/guardar una copia por pista), corregir los marcadores `♪` en Buscar, hidratar Biblioteca en lote y resolver la carrera `img.decode()` vs revocación de `ObjectURL` (T26 C03/C04 en WebKit).
6. **Reproducción individual en álbumes guardados en Biblioteca sin descargar el álbum completo:** habilitar el toque sobre canciones no descargadas en álbumes guardados en Biblioteca para adquirirlas y reproducirlas bajo demanda (sin descargar el álbum entero).
7. **Avance Siguiente/Anterior al reproducir desde un álbum:** encolar en orden de disco/pista las canciones reproducibles del álbum al tocar una pista en `AlbumPageController` (Biblioteca y Buscar), de modo que «Siguiente», «Anterior» y el avance automático recorran el álbum.
8. **Limpieza de Inicio:** retirar la sección visual «Añadidas recientemente» (`.home-recent`) de `HomeView.tsx`, conservando el estado vacío cuando no hay música en Biblioteca.

---

## Alcance autorizado y fuera de alcance

### Dentro de alcance
- Endpoints de sincronización de cuenta en Cloudflare Worker (`deployment/cloudflare/account-data.mjs`, `accounts.mjs`, vía `fix-sync-503`).
- Protocolo/driver de vinculación de opciones de bot (`src/telegram/bot-search-protocol.ts`, `src/telegram/bot-search-driver.ts`, `src/library/recording-title.ts`, `src/imports/expected-audio-metadata.ts`) tras captura real en vivo.
- Supresión de aviso global transitorio de escritura en lotes y limpieza de aviso visual sobre `MiniPlayer` (`src/main.tsx`, `src/ui/MiniPlayer.tsx`, `src/ui/ShellNotice.tsx`, `src/ui/shell-notice.css`, paneles de herramientas si requieren estado en línea).
- Caché de portadas compartida por álbum, hidratación en lote de Biblioteca y correcciones de `CatalogArtwork` / `PlayerArtwork` / `songArtwork` (`src/cache/persistent-artwork.ts`, `src/library/player-artwork-cache.ts`, `src/library/catalog-artwork.ts`, `src/library/player-artwork-provider.ts`, `src/library/music-search-catalog.ts`, `src/ui/CatalogArtwork.tsx`, `src/ui/PlayerArtwork.tsx`, `src/main.tsx`).
- Reproducción individual y cola ordenada por álbum en `AlbumPageController.tsx`, `MusicSearchController.tsx` y `src/main.tsx`.
- Retirada de «Añadidas recientemente» en `src/ui/HomeView.tsx` y actualización de pruebas de integración afectadas.

### Fuera de alcance
- Cambios de infraestructura, bases ajenas o servicios de pago (presupuesto estricto **USD 0**).
- Descarga automática en segundo plano de pistas no descargadas al pulsar «Siguiente» o al terminar una pista (`ended`) — ver justificación en `V64-09`.
- Modificación del esquema de `pulso-web-local-v1` o `pulso-assets-v1` (OPFS) o del transporte de audio del Service Worker.
- Aceptación física en iPhone (`D`): las 16 pruebas de `docs/IPHONE-ACEPTACION.md` siguen **NO EJECUTADAS** hasta que el propietario las ejecute.

---

## Requisitos verificables (`V64-01…V64-10`)

| ID | Área | Requisito y criterio de aceptación verificable |
|---|---|---|
| **V64-01** | Sincronización de biblioteca (503) | Con sesión de cuenta válida, `GET /api/account-library`, `PUT /api/account-library` y `/api/account-profile` responden HTTP `200` y persisten/recuperan playlists, favoritos y metadatos de canciones en Neon (USD 0). Pulsar «Sincronizar biblioteca» en Ajustes completa sin error `503` y conserva intactos los datos locales. *(Implementación aislada en `fix-sync-503`; verificación integrada en v64.)* |
| **V64-02** | Vinculación D01 en bots («Get Lucky») | **Compuerta previa:** capturar primero las etiquetas literales de opciones devueltas por los bots reales para «Get Lucky» (Daft Punk) en el perfil en vivo antes de fijar el patrón exacto. Una vez fijado, las opciones y audios con colaboradores acreditados (`feat.`/`ft.`/`featuring`, `&`, `,`) o variantes de título equivalentes corroboradas por artista principal exacto y duración dentro de tolerancia (`≤ 5 s` en audio, `≤ 7 s` en etiqueta de botón) se vinculan sin devolver `[D01]`. **Regla dura (J03 de T25):** jamás aceptar canciones ajenas, covers, remixes, versiones `live`/`acoustic`/`instrumental`/`karaoke`/`sped up`/`slowed` ni sustituir un artista principal distinto; la validación de etiqueta del archivo importado (`expectedAudioTagMismatch`) permanece coherente con la del bot. |
| **V64-03** | Aviso transitorio en descarga de álbum | Durante una descarga en lote (álbum o playlist) usando `captureBotAudioImport('cache', parked)`, un fallo transitorio recuperable de escritura/almacenamiento que se reintenta y concluye con éxito **nunca** publica el aviso global «No se pudo guardar la canción.» en el shell (`saveFailureNotices === 0`). Los errores terminales de una canción individual siguen mostrándose en `SelectedSongActions`, y los errores reales de lote en `DownloadDock`. |
| **V64-04** | Barra de reproducción sin recuadro superior de cola | En teléfonos y escritorio, la barra `.mini-player` **no muestra ningún recuadro de texto visual ni botón «Cerrar aviso»** encima de los controles para mensajes de cola (`Preparando cola…`, `Cola lista y pausada. Pulsa Reproducir.`, `N entradas añadidas…`, `Cola vacía…`, etc.). La altura de `.mini-player` no crece al cambiar el estado de la cola. El mensaje `Cola lista y pausada.` se actualiza/limpia al pasar a `playing` (no coexiste con reproducción activa). Se mantiene una región viva accesible (`role="status" aria-live="polite" aria-atomic="true"`, clase `pulso-visually-hidden`, `1×1 px` recortada, `isPainted === false`) para lectores de pantalla (`W17`). Los errores críticos de Almacenamiento/Base local/Recuperación/Herramientas permanecen visibles en su propia sección contextual (`databaseState !== 'ready'`, `StorageSettings`, `LocalBatchPanel`, `OrganizationPanel`, `PlayerSurface`). |
| **V64-05** | Caché de portada compartida por álbum | Las canciones que pertenecen al mismo álbum comparten **una sola imagen en caché** en `pulso-web-cache-v1` (y en L1 RAM) bajo una identidad de álbum segura contra colisiones: `edition:<fuente>:<editionId>` si pertenece a una edición de catálogo identificada, o `album:<artista-normalizado>:<álbum-normalizado>` cuando ambos campos existen y son fiables (nunca solo por título de álbum). Al cargar o resolver la portada de una pista del álbum (vía `catalogCovers`, `savedAlbum.edition.artworkUrl` o `PlayerArtworkProvider`), las demás pistas del mismo álbum reutilizan esa misma entrada en L1/L2 sin descargas redundantes ni duplicar `ArrayBuffer` en IndexedDB. **Prioridad K01 intacta:** una portada manual, una ocultación manual (`manual: true, state: 'absent'`) o una portada incrustada local de una pista concreta siempre prevalece sobre la portada compartida del álbum. |
| **V64-06** | Corrección de `♪` en Buscar y carrera WebKit (T26 C03) | En `CatalogArtwork.tsx`, revocar un `ObjectURL` anterior solo después de que la nueva imagen haya terminado de decodificarse (`decode()`/`onLoad`) o al desmontar/retirar caché, y evitar re-ejecuciones innecesarias del efecto cuando `PlayerArtworkCache` notifica cambios de claves ajenas (corrige T26 C03 en WebKit). En Buscar (`songArtwork` / `selectPlayerArtwork` / `musicSearchCatalog`), no descartar todo el lote cuando iTunes devuelve `results.length === limit` (200) y permitir reutilizar la portada unívoca cuando varias ediciones devueltas para la misma canción/artista/álbum comparten portada o existe `albumCover` confirmado, reduciendo los `♪` espurios en resultados de búsqueda. |
| **V64-07** | Hidratación rápida en lote al recargar Biblioteca + fixture T26 C04 | Al abrir o recargar Biblioteca (y playlists/álbumes), las portadas ya persistidas en `pulso-web-cache-v1` se hidratan a L1 RAM en **una única transacción `readonly`** por lote (`PlayerArtworkCache.preload(...)`) y las filas fuera de pantalla no disparan peticiones de red (`IntersectionObserver`), eliminando el retraso de varios segundos con `♪` tras recargar. Se repara además el fixture de T26 C04 en WebKit (sin reescribir en IDB un `Blob` leído del mismo registro). |
| **V64-08** | Reproducción individual en álbum guardado en Biblioteca | En Biblioteca, al abrir un álbum guardado sin descargar (`0 de N descargadas`) o parcialmente descargado, tocar cualquier canción no descargada (mientras no haya inspección, descarga de álbum ni otro vuelo de canción activo) **está habilitado** y lanza la adquisición y reproducción individual bajo demanda (`chooseChoice`), guardándola en caché de escucha (sin disparar la descarga completa del álbum). Se conservan los badges honestos (`No descargada` / `En caché de escucha` / `Descargada` / `Error`) y las guardas de sesión/offline (sin conexión o sin bots conectados muestra el aviso claro en `SelectedSongActions`, sin romper ni bloquear). |
| **V64-09** | Avance Siguiente/Anterior desde un álbum | Al tocar una canción dentro de un álbum (`AlbumPageController`, tanto en Biblioteca como en Buscar): **(Caso A)** si hay 2 o más pistas descargadas localmente en ese álbum, se prepara la cola con **todas las pistas descargadas del álbum en orden de disco y pista**, arrancando en la pista tocada; «Siguiente», «Anterior», MediaSession (`nexttrack`/`previoustrack`) y el avance automático al terminar (`ended`) recorren el álbum sin obligar a salir. Si la cola vigente ya coincide con ese álbum, se selecciona el índice sin reconstruir la cola. **(Caso B)** si el álbum tiene pistas aún no descargadas, la cola incluye únicamente las pistas disponibles localmente (más la pista recién adquirida bajo demanda) en orden del álbum; **no** se disparan descargas automáticas de Telegram al pulsar «Siguiente» o en `ended` (preserva J02, V5, V19, V28 y la estabilidad offline/pantalla bloqueada en iPhone). Si solo hay 1 pista descargada, «Siguiente» permanece honestamente deshabilitado hasta que el usuario descargue más pistas o el álbum. |
| **V64-10** | Retirada de «Añadidas recientemente» en Inicio | Se retira la sección «Añadidas recientemente» (`<section aria-labelledby="home-recent-heading">` y la rejilla `.home-recent`) de `src/ui/HomeView.tsx`. Cuando la biblioteca está vacía (`props.empty`), el bloque de bienvenida «Haz espacio para tu música» con botón «Buscar música» se conserva visible en Inicio. *(Nota de decisión abierta para el director: ver §Decisiones de diseño sobre conservar o retirar también «Continuar escuchando» `.home-continue`.)* |

---

## Invariantes que no pueden romperse

1. **J03 de T25 / V6 / V22 (Identidad musical estricta):** Ninguna mejora de vinculación D01 puede aceptar una canción de otro artista principal, un cover, un remix, un directo o una duración fuera de tolerancia.
2. **K01–K05 de T26 (Prioridad y aislamiento de caché):** Manual/local (`artwork:v1:*`) y ocultación manual siempre vencen a la portada compartida de álbum; `pulso-web-cache-v1` jamás muta `pulso-web-local-v1`, OPFS ni backups; aislamiento total por `accountId` y cero red con `navigator.onLine === false`.
3. **W17 / AC20 (Accesibilidad sin regresión):** Retirar el recuadro visual de cola sobre `.mini-player` conserva los anuncios en región viva accesible (`role="status" aria-live="polite"`) y los tamaños táctiles `≥ 44×44 px`.
4. **V13–V15 / V19 / V28 (Reproducción y cola seguras):** Un solo motor audible; sin autoplay no solicitado; sin bucles de reintento ni descargas automáticas ocultas en `next()`/`ended`; avance offline garantizado entre pistas descargadas del álbum.
5. **V29–V30 (USD 0 y evidencia honesta):** Cero costes o servicios nuevos; Chromium/WebKit de escritorio nunca se declaran aceptación física en iPhone (`D` sigue NO EJECUTADA).

---

## Decisiones técnicas y matices clave

### Punto 4 · Mensajes de cola sobre `.mini-player`
- **Causa actual:** `src/main.tsx:1591-1594,1747` pasa `<ShellNotice message={status} .../>` dentro de `MiniPlayer`. `.shell-notice` tiene `grid-column: 1 / -1; flex: 1 0 100%`, por lo que cualquier valor en `status` despliega un recuadro de texto con botón `×` justo encima de la barra de reproducción.
- **Diseño elegido:**
  - Eliminar el render visual de `ShellNotice` dentro de `MiniPlayer` (dejar en `.mini-player` únicamente los `<p className="pulso-visually-hidden" role="status" aria-live="polite" aria-atomic="true">` para `startupStatus` y `status`, con `clip-path`, `1×1 px`, altura visual `0`).
  - Mantener la limpieza WIP de `src/main.tsx:894-896,999` (`startupStatus = 'Cola preparada.'` al pasar a `playing`).
  - Verificar los tres paneles que llaman `onStatus={text => { status = text; emit(); }}` (`LocalBatchPanel`, `OrganizationPanel`, `LyricsPanel` en `src/main.tsx:1723,1730,1744`): `LyricsPanel` vive dentro de `PlayerSurface` (que ya anuncia `status||startupStatus`); para `LocalBatchPanel` y `OrganizationPanel` en Ajustes → Herramientas, renderizar su propio `<p role="status">` en línea dentro del panel para que sus mensajes sigan siendo visibles en Ajustes sin depender de `.mini-player`.
  - **Ventaja de compatibilidad:** mantener el `<p className="pulso-visually-hidden" role="status">` dentro de `.mini-player` evita romper la docena de pruebas heredadas que esperan `getByRole('status').filter({hasText:'Cola lista y pausada.'})`, reduciendo cambios de tests solo a `check-startup-splash.mjs` (`E02`) y `check-review-ui.mjs`.

### Punto 5 · Caché compartida por álbum y `♪`
- **Causa actual de duplicación:** `sharedArtworkKey(track)` (`src/main.tsx:1118-1120`) incluye `track.id`, `assetId`, `audioFingerprint.sha256` y `title`, por lo que cada canción de un mismo álbum crea una entrada `provider:<trackKey>` distinta en `pulso-web-cache-v1`. Además, `catalogCovers` (`src/main.tsx:1368-1375`) solo asigna URL si cada pista individual tiene `catalogRelease.artworkUrl`, sin propagar `savedAlbum.edition.artworkUrl` a las pistas del álbum guardado.
- **Diseño elegido:**
  1. **Clave de álbum compartida (`albumArtworkKey`):**
     - Prioridad 1 (edición inequívoca): `edition:<editionId>` (incluido `musicbrainz:*`) (procedente de `savedAlbum`, `track.catalogChoice.id` o `trackCatalogRelease(track)`). Separa automáticamente ediciones estándar, deluxe y remasters.
     - Prioridad 2 (álbum local con artista fiable): si no hay `editionId`, y existen tanto `album` como `albumArtist || artist` no vacíos (vía `resolveLocalAlbumMetadata(track)`), usar `album:${musicCatalogKey(albumArtist || artist)}:${musicCatalogKey(album)}`. Si falta artista o álbum, no compartir (evita colisiones entre álbumes homónimos como *Greatest Hits*).
  2. **Deduplicación en `pulso-web-cache-v1` (`src/cache/persistent-artwork.ts` + `src/library/player-artwork-cache.ts`):**
     - Guardar el binario `ArrayBuffer` **una sola vez** por `artworkKey` (URL normalizada o `albumArtworkKey`).
     - Usar `provider:<albumArtworkKey>` para proveedor y la URL normalizada para catálogo; cada identidad compartida conserva una fila binaria en L1/L2.
     - En `src/main.tsx`, propagar `savedAlbum.edition.artworkUrl` (y la URL de catálogo compartida del grupo de álbum) a `catalogCovers` para todas las pistas resueltas del mismo álbum guardado (respetando siempre `K01` en `CatalogArtwork`/`PlayerArtwork`, donde `readArtwork(trackId)` manual/local se evalúa antes que `imageUrl`).
  3. **Corrección de `CatalogArtwork.tsx` (carrera WebKit T26 C03):**
     - Suscribirse en `useSyncExternalStore` solo al snapshot concreto de `identity`/`albumKey` (no re-disparar el efecto entero cuando cambian otras claves) y mantener el `ObjectURL` previo vivo hasta que la nueva `<img>` haya decodificado (`img.decode()`/`onLoad`) antes de revocar el anterior.
  4. **Precarga por lote (`V64-07`):**
     - Añadir `PlayerArtworkCache.preload(keys: readonly string[])` que abra **una única** transacción `readonly` en `pulso-web-cache-v1` al abrir Biblioteca/playlist/álbum e hidrate L1 RAM, sin diferir las imágenes fuera del viewport: el arnés existente exige las 30 portadas.

### Punto 6 · Canciones individuales en álbum guardado en Biblioteca
- **Causa exacta:** `src/ui/AlbumPageController.tsx:247,254`:
  `const pending = props.libraryView && !!savedAlbum && !present;`
  y el `<button>` de pista tiene `disabled={pending || inspecting || props.coordinator.running || props.songPending}`.
- **Diseño elegido:**
  - Quitar `pending` de `disabled={...}` (mantener `disabled={inspecting || props.coordinator.running || props.songPending}`).
  - Conservar `data-album-pending={pending || undefined}` y el badge `No descargada` / `Error` como indicadores visuales honestos.
  - Al tocar una canción no descargada en un álbum guardado en Biblioteca, se invoca `props.onChoose(choice)` → `MusicSearchController.chooseChoice(choice)`, que adquiere solo esa canción bajo demanda en caché de escucha y la reproduce (sin disparar descarga del álbum entero). Si no hay conexión o Telegram no está listo, `SelectedSongActions` muestra el aviso claro sin fallar.
  - **Test existente a actualizar:** `tests/integration/helpersalbum-library/browser.mjs:322` actualmente afirma `assert.equal(await missing.locator('button').isDisabled(), true)` en modo offline; debe actualizarse para reflejar el nuevo contrato (botón habilitado; al pulsarlo offline muestra aviso de conexión/Telegram sin lanzar RPC ni reproducir; online descarga y reproduce solo esa pista).

### Punto 7 · Avance Siguiente/Anterior en álbumes
- **Causa exacta:** Al tocar una pista en `AlbumPageController.tsx:254`, `MusicSearchController.tsx:417` llama a `chooseChoice(choice)` → `finishPlay(f, local)` → `f.attempt.play(id, ...)` → `src/main.tsx:624`: `await queue([trackId], undefined, [], live)`. Al encolar un array de 1 sola pista, `player.following()` es `-1` y «Siguiente» queda deshabilitado.
- **Diseño elegido:**
  - Ampliar `onChoose` / `chooseChoice` / `SongPlaybackAttempt.play` con un parámetro opcional `queueTrackIds?: readonly string[]` (ordenados según `detail.tracks` por disco/pista).
  - En `AlbumPageController.tsx`, al pulsar una pista (local o pendiente), construir la lista ordenada de `trackId`s actualmente disponibles en `detail.tracks` (usando `copies` / `visibleRows` / `localTrackIndex`). Cuando la pista elegida termina de localizarse o descargarse en `chooseChoice`, insertar/asegurar su `trackId` en su posición exacta del álbum dentro de `queueTrackIds` y pasarlo a `attempt.play(trackId, current, signal, queueTrackIds)`.
  - En `src/main.tsx:608-628` (`play`): si `queueTrackIds` tiene `> 1` elementos y contiene `trackId`:
    - Si `player.entries` ya coincide exactamente con `queueTrackIds`, hacer `player.select(startIndex, true)` directamente sin reconstruir la cola.
    - Si no, llamar `await queue(orderedIds, undefined, [], live, startIndex)` y luego `guardedPlay()`.
  - **Matiz Caso B (pistas no descargadas):** Se encolan **solo las pistas descargadas disponibles** en orden del álbum (sin descarga automática en `next()`/`ended`). Es la opción más limpia, segura offline y compatible con pantalla bloqueada en iPhone y J02/V28. *(Pendiente de confirmación rápida del director si prefiere este comportamiento o algún aviso adicional.)*

### Punto 8 · Inicio (`HomeView.tsx`)
- **Análisis de ambos bloques en `src/ui/HomeView.tsx:59-62`:**
  - **«Añadidas recientemente»** (`home-recent-heading`, `.home-recent`, líneas 60-62): rejilla de hasta 6 tarjetas de canciones recientes. Se retira por completo; el estado vacío `<div className="home-empty"><h3>Haz espacio para tu música</h3>…</div>` se renderiza cuando `props.empty` es verdadero.
  - **«Continuar escuchando»** (`home-continue-heading`, `.home-continue`, línea 59): tarjeta única de la pista actual en cola (duplica parcialmente a `MiniPlayer`, pero `check-functional-shell.mjs:79` prueba específicamente su flujo de foco y reanudación).
  - **Recomendación por defecto en T28:** retirar **«Añadidas recientemente»** y conservar **«Continuar escuchando»** salvo que el director confirme retirar también «Continuar escuchando» (si el propietario se refería a ambos bloques al decir *«canciones recientemente escuchadas»*).

---

## Matriz de trazabilidad (`V64-01…V64-10`)

Niveles conforme a `doc/SPEC.md` §V.2: **U** (unitaria), **B** (navegador real Chromium y WebKit en loopback), **T** (Telegram / producción en vivo autorizada), **D** (iPhone físico del propietario).

| ID | Prueba (archivo y casos) | Nivel | Criterio de paso |
|---|---|---|---|
| **V64-01** | `tests/server/test_cloudflare_worker.mjs` (o suite de `fix-sync-503`: `/api/account-library` GET/PUT y `/api/account-profile` → 200); prueba real tras despliegue en `workers.dev` | U / B / T | HTTP 200 con sesión válida, persistencia confirmada en Neon y 0 regresiones en rutas privadas (`Cache-Control: no-store`). |
| **V64-02** | `tests/unit/bot-search-protocol.test.ts` + `tests/unit/recording-title.test.ts` (casos reales capturados de «Get Lucky» + colaboradores `feat.`/`&`/`,`, más negativos J03: cover, remix, live, otro artista principal, duración fuera de rango); prueba real con Telegram | U / T | Opciones reales vinculadas sin `[D01]`; 100 % de los casos negativos J03 rechazados. |
| **V64-03** | `tests/integration/check-playlist-full-download-main.mjs` (aserción `saveFailureNotices === 0` en fallo transitorio de escritura durante descarga de álbum/playlist) | B | El lote recupera la pista y completa sin emitir «No se pudo guardar la canción.» en `[role="status"]`. |
| **V64-04** | `tests/integration/check-startup-splash.mjs` (`E02`, `L02`, `E03–E05`), `tests/integration/check-review-ui.mjs`, `tests/integration/check-player-notice.mjs` (`N01–N02`) | B / D | Cero recuadro pintado (`isPainted === false`), 0 botones «Cerrar aviso» en `.mini-player`, altura de `.mini-player` estable en móvil, región `aria-live="polite"` intacta, sin «Cola lista y pausada» durante reproducción activa. |
| **V64-05** | `tests/unit/persistent-artwork-cache.test.ts` (clave de álbum `edition:*` y `album:*`, cero colisión entre artistas distintos, 1 sola entrada binaria para N pistas del mismo álbum, prioridad manual/oculta K01); `tests/integration/check-persistent-cache-main.mjs` (álbum de N pistas → 1 petición HTTP y 1 fila en store `artwork`) | U / B | 1 entrada binaria en `pulso-web-cache-v1` compartida por todas las pistas del álbum; manual/ocultación local gana siempre. |
| **V64-06** | `tests/unit/player-artwork-provider.test.ts` + `tests/unit/music-search-catalog.test.ts` (lote de 200 resultados y portada compartida entre ediciones); `tests/integration/check-persistent-cache-main.mjs` (T26 C03 en Chromium y WebKit sin carrera `decode()` vs `revokeObjectURL`) | U / B | Cero fallos de decodificación en WebKit y reducción de `♪` en resultados de búsqueda con portada disponible. |
| **V64-07** | `tests/integration/check-persistent-cache-main.mjs` (hidratación en lote ≤ 1 transacción `readonly` IDB al abrir Biblioteca + T26 C04 WebKit fixture reparado con `ArrayBuffer`/nuevo `Blob`) | B / D | Portadas cacheadas visibles al recargar Biblioteca sin tormenta de transacciones IDB; T26 C03 y C04 en PASS en Chromium y WebKit. |
| **V64-08** | `tests/integration/helpersalbum-library/browser.mjs` (caso actualizado de álbum guardado sin descargar en Biblioteca: tocar 1 pista no descargada → descarga y reproduce solo esa pista en caché de escucha sin descargar el resto; offline → aviso claro sin RPC) | B / D | Reproducción individual operativa en álbumes guardados en Biblioteca; 0 descargas del resto del álbum. |
| **V64-09** | `tests/integration/helpersalbum-library/browser.mjs` (nuevo caso: álbum en Biblioteca y en Buscar con ≥ 3 pistas descargadas → tocar pista 1 → `canNext === true`, pulsar «Siguiente» avanza a pista 2, «Anterior» vuelve a pista 1, `ended` avanza a pista 3; caso parcial: solo encola descargadas, sin RPC al pulsar «Siguiente») | B / D | «Siguiente», «Anterior» y avance automático recorren el álbum en orden de disco/pista sin salir de la pantalla; 0 descargas implícitas en `next()`/`ended`. |
| **V64-10** | `tests/integration/check-functional-shell.mjs`, `check-private-artwork.mjs`, `check-legacy-shell-update.mjs`, `check-standalone-shell.mjs`, `check-persistent-cache-main.mjs` | B | Ausencia de «Añadidas recientemente» y `.home-recent` en Inicio; estado vacío conservado cuando no hay canciones; suites de integración actualizadas en PASS. |

---

### Resultados de la ronda A (2026-11-26)

- **V64-01:** PASS local Workers/Miniflare: biblioteca y perfil aceptan `redirect: manual` y rechazan 302; Turnstile acepta respuesta válida y rechaza 302. `test:cloudflare`: 74/74. Comprobación pública T pendiente.
- **V64-03:** PASS navegador sintético: `check-playlist-full-download-main.mjs`, modo `full`, una repetición por motor, Chromium y WebKit 2/2; ninguna notificación final durante el fallo transitorio de escritura.
- **V64-04:** PASS navegador: `check-startup-splash.mjs` 16/16 y `check-player-notice.mjs` 10/10 en Chromium/WebKit; iPhone D no ejecutado. `check-review-ui.mjs` actualizado, no ejecutado en esta ronda.
- **V64-08/09:** PASS navegador en Biblioteca y Buscar: caso `queue-v64-album-playback`, Chromium y WebKit 2/2, individual online/offline, cola parcial y completa, anterior/siguiente y `ended` sin RPC adicional; runner histórico de álbum bloqueado por T28 aún sin recibo Engram. iPhone D no ejecutado.
- **V64-10:** Implementación y pruebas actualizadas; `check-functional-shell.mjs` FAIL antes del primer caso: su fixture anterior no completa la preparación de cuenta y la navegación Principal no aparece. No se acredita PASS de navegador para Inicio.
- Comprobaciones locales: typecheck, typecheck:tests y lint PASS; unitarias 1053/1053; sin publicación ni pruebas físicas.

### Evidencia parcial de la ronda C (2026-11-26)

- **V64-02:** implementación previa en `5e6448f`; la verificación real de Telegram y su evidencia corresponden a la integración, no se declara aquí PASS.
- **V64-06:** selección de portada en lote de 200 y ediciones de portada idéntica, más herencia entre resultados por artista y álbum normalizados; unitarias 1055/1055 y tipos/lint PASS. Se mantiene el `ObjectURL` anterior hasta la carga/decodificación o retirada de caché; T26 C03 pasa en la batería de caché Chromium y WebKit.
- **V64-07:** fixture C04 reconstruye el Blob; batería de caché existente 11/11 en Chromium y 11/11 en WebKit. La precarga en lote seguía pendiente en esta ronda; no se introducirá diferimiento de red.
- **V64-05:** identidad compartida y deduplicación por álbum pendientes; no se acredita PASS.
- **V64-10:** prueba explícita de Inicio poblado y vacío: 10/10 casos por motor en Chromium y WebKit; la primera ejecución completa pasó los 20 casos pero el contador del runner causó salida 1; tras corregirlo, la repetición pasó 20/20 con salida 0. La aceptación física de iPhone permanece NO EJECUTADA.

### Evidencia de la parte D (2026-11-26)

- **V64-02:** implementación en `5e6448f`; la verificación con Telegram real permanece pendiente, sin atribuir PASS de ese nivel.
- **V64-05:** identidad compartida por edición o artista y álbum locales; C07 comprueba tres pistas, una fila binaria, como máximo una petición y ocultación manual de la segunda pista en Chromium y WebKit.
- **V64-06:** C03 pasa en ambos motores; selección en lote y ediciones cubiertas por la evidencia de ronda C.
- **V64-07:** precarga de claves deduplicadas en una transacción readonly, con repetición sin nueva transacción; C03, C04 y C07 pasan en ambos motores, sin IntersectionObserver.
- **V64-10:** evidencia previa de ronda C: Inicio poblado y vacío, 10/10 casos por motor; aceptación física no ejecutada.
- **Validación:** typecheck, typecheck:tests y lint PASS; unitarias 1058/1058; `check-persistent-cache-main.mjs` 13/13 Chromium y 13/13 WebKit. Evidencia mínima: `.local/test-evidence/t26-inc1-cache-0EvOnS/report.json`. iPhone físico y pruebas reales de Telegram siguen pendientes.

### Corrección de regresiones de la batería completa (2026-11-26)

La batería sobre `3df2407` detectó A01/A02b y L02; no se acredita aquí una nueva batería completa. Tras corregir la retirada de URLs al ocultar Biblioteca y el aviso antes de reproducir, las suites afectadas pasan sin fallos en Chromium y WebKit, respectivamente: portadas 6/6 y 6/6 (A01/A02b), caché persistente 13/13 y 13/13 (C03/C04/C07), arranque 10/10 y 10/10 (L02/H01/H02), avisos 5/5 y 5/5, y descargas 5/5 y 5/5. Typecheck, typecheck de pruebas, lint y build PASS; unitarias 1058/1058. La precarga usa una firma estable de claves para evitar ejecuciones por renders sin cambios. La evidencia de navegador cubre la transición visible → oculta; el archivo unitario existente prueba funciones de catálogo y no monta componentes React. La validación final, la revisión independiente y los niveles Telegram real e iPhone físico siguen pendientes.

## Plan de implementación acotado para Codex (`gpt-6.1-terra`)

Ejecutar en incrementos ordenados y con validación proporcional (`doc/SPEC.md` §V.2) por área antes de la batería completa final:

### 1. Avisos de cola y descarga transitoria (`V64-03`, `V64-04`)
- `src/main.tsx`: conservar diff WIP de línea 476 (`if (libraryMode !== 'cache')`) y líneas 894–896 / 999; retirar `<ShellNotice .../>` del prop `notice` de `MiniPlayer` dejando únicamente regiones `<p className="pulso-visually-hidden" role="status" aria-live="polite" aria-atomic="true">` para `startupStatus` y `status`; asegurar estado inline visible en `LocalBatchPanel` y `OrganizationPanel`.
- `src/ui/MiniPlayer.tsx`, `src/ui/ShellNotice.tsx`, `src/ui/shell-notice.css`: simplificar/retirar el bloque visual superior de `.mini-player` si `ShellNotice` queda sin otros consumidores.
- Tests: actualizar `tests/integration/check-startup-splash.mjs` (`E02`), `tests/integration/check-review-ui.mjs`, y verificar `check-player-notice.mjs` y `check-playlist-full-download-main.mjs`.

### 2. Inicio limpio (`V64-10`)
- `src/ui/HomeView.tsx`, `src/main.tsx`, `src/ui/responsive-shell.css`, `src/ui/app-polish.css`: retirar la sección «Añadidas recientemente» (`.home-recent`) y pasar `empty` para mostrar `.home-empty` solo cuando no haya canciones en Biblioteca. *(Retirar también `.home-continue` solo si el director lo confirma.)*
- Tests: actualizar `tests/integration/check-functional-shell.mjs`, `check-private-artwork.mjs`, `check-legacy-shell-update.mjs`, `check-standalone-shell.mjs`, `check-persistent-cache-main.mjs`.

### 3. Reproducción individual y Siguiente/Anterior en álbumes (`V64-08`, `V64-09`)
- `src/ui/AlbumPageController.tsx`: quitar `pending` de `disabled` en los botones de pista (línea 254); pasar la lista ordenada de pistas disponibles del álbum junto con la `choice` seleccionada al invocar `onChoose`.
- `src/ui/MusicSearchController.tsx`: propagar la lista ordenada de pistas del álbum desde `onChoose` → `chooseChoice` → `finishPlay` → `attempt.play`.
- `src/library/selected-song.ts` y `src/main.tsx`: ampliar `SongPlaybackAttempt.play` para aceptar `queueTrackIds?: readonly string[]`, reutilizar la cola vigente si ya coincide con el álbum o llamar `queue(orderedIds, undefined, [], live, startIndex)`.
- Tests: actualizar y ampliar `tests/integration/helpersalbum-library/browser.mjs`.

### 4. Caché compartida por álbum, `♪` en Buscar e hidratación rápida (`V64-05`, `V64-06`, `V64-07`)
- `src/cache/persistent-artwork.ts`, `src/library/player-artwork-cache.ts`: añadir soporte de `albumArtworkKey` (una sola entrada binaria por álbum + enlaces múltiples en `catalog`) y método `preload(keys)` en una sola transacción `readonly`.
- `src/main.tsx`: calcular `albumArtworkKey` por pista (`edition:*` o `album:<artista>:<álbum>`), propagar `savedAlbum.edition.artworkUrl` a pistas resueltas del álbum y lanzar `preload` al abrir Biblioteca/colecciones.
- `src/ui/CatalogArtwork.tsx`, `src/ui/PlayerArtwork.tsx`: resolver la carrera `decode()` vs `revokeObjectURL` (T26 C03 WebKit), suscripción específica por clave/álbum sin `IntersectionObserver`, incompatible con el caso existente de 30 portadas.
- `src/library/player-artwork-provider.ts`, `src/library/music-search-catalog.ts`, `src/library/catalog-artwork.ts`: corregir descarte de lote completo al llegar a `limit === 200` y permitir portada compartida de ediciones consistentes en Buscar.
- Tests: ampliar `tests/unit/persistent-artwork-cache.test.ts`, `tests/unit/player-artwork-provider.test.ts`, `tests/unit/music-search-catalog.test.ts`, y corregir/ampliar `tests/integration/check-persistent-cache-main.mjs` (incluyendo fixture T26 C04 en WebKit).

### 5. Vinculación D01 en bots (`V64-02`, tras captura real)
- **Bloqueado hasta recibir las etiquetas reales de «Get Lucky» en el perfil en vivo.**
- Archivos previstos: `src/telegram/bot-search-protocol.ts`, `src/telegram/bot-search-driver.ts`, `src/library/recording-title.ts`, `src/imports/expected-audio-metadata.ts`, `tests/unit/bot-search-protocol.test.ts`, `tests/unit/recording-title.test.ts`.

### 6. Integración de `fix-sync-503` (`V64-01`) y batería completa previa a publicación
- Integrar el fix de `deployment/cloudflare/account-data.mjs` / `accounts.mjs`.
- Ejecutar batería completa una sola vez antes de publicar (`npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, `npm run test:unit`, `npm run test:cloudflare`, `npm run build` y matrices de navegador en Chromium y WebKit), más revisión independiente.
- Tras publicar en Cloudflare, verificar en vivo `/api/account-library` (200) y los escenarios de v64. Las 16 pruebas físicas en iPhone (`docs/IPHONE-ACEPTACION.md`) permanecen **NO EJECUTADAS** hasta ejecución del propietario.
