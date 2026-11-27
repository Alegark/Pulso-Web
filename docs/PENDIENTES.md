# Pendientes abiertos · 2026-11-27

Pulso sirve [v67](https://pulso-web.pruebassoftware.workers.dev/releases/48727d3675574cce.html) desde `release/v67`. El registro de publicación está en [P0-W](../odd/tasks/P0-W.md#2026-11-27--publicación-de-v67), [T31](../odd/tasks/T31-v67-agrupacion-albumes-escritorio.md) y [T32](../odd/tasks/T32-v67-almacenamiento-y-borrado.md). La [PR 20 de v60](https://github.com/Alegark/Pulso-Web/pull/20) queda abierta.

## Pendientes de v64 / v63

- **V64-08 en vivo:** validado en Chromium y WebKit (`queue-v64-album-playback`), pendiente de comprobación en vivo sobre un álbum guardado sin descargar.
- **Portadas de sugerencias LRCLIB sin par iTunes:** en Buscar, los resultados exclusivos de LRCLIB sin coincidencia `(artista, álbum)` con iTunes en el mismo lote siguen mostrando `♪` (69 portadas vs 8 notas en «Get Lucky»).
- **Dos menores de la revisión independiente de v64:** tolerancia combinada `Album Version` + `feat.` (5 s vs 1 s) en `bot-search-protocol.ts`/`bot-search-driver.ts`, y limpieza de `src/ui/ShellNotice.tsx` / `src/ui/shell-notice.css` sin consumidores.
- **T27 P01:** La pista suelta tardó 550 → 495 ms en IDB (−10,0 %) y 1.114 → 574 ms en OPFS (−48,5 %) en Chromium sintético. La meta era −50 %. Queda completar la medición comparable en WebKit.
- **M1 con Telegram real:** Comprobar suspensión y reconexión bajo demanda, conservación de la sesión y presencia «en línea» tras restaurar la conexión. La prueba con Telegram real sigue **NO EJECUTADA**.

## 1. Hallazgos abiertos de v60

- **Q09b, heredado de v59.** El shell no recupera automáticamente el control al volver de BFCache. «Usar en esta pestaña» devuelve el control y la cola reanuda la descarga.
- **Menor 1 de la revisión 8.** Una recuperación de una pista anterior puede dar una ronda adicional acotada de reconexión a una pista posterior.
- **Menor 2 de la revisión 8.** El temporizador de un menú retenido puede sustituir `file-invalid` o `file-too-large` por `expired` a los 120 s en una descarga de canción individual.

## 2. Hallazgos medios de v61

- Si el audio falla permanentemente tras el reintento de precarga, el reproductor carece de indicador visual. Se conserva el anuncio accesible y se puede reintentar manualmente.
- En `Player.select()`, `audio.load()` precede a `this.state = 'loading'`. Si un medio sintético emite `error` dentro de la llamada, la asignación posterior sobrescribe el estado de error. Chromium y WebKit entregan el evento de forma asíncrona.

## 3. Mejoras de velocidad · rama local `perf/faster-bot-pipeline`

- La rama es local, sin push, con head `2edb77e`, en el worktree `/data/home/.t3/worktrees/Pulso-Web/t3-c5cd15c5-713ad003c8500674`.
- Ninguno de sus commits está revisado.
- Una variante de cola dio 28/30 y no se investigó.
- Depende de rebasar sobre la PR 20 final.
- El diseño está en `.local/research/latency-design-neon-2026-11-24/report.md`, fuera de Git:
  - guardado más ligero;
  - updates de MTProto;
  - menos viajes de ida y vuelta;
  - reloj por bot;
  - rechazo temprano.

El propietario retomó las mejoras de velocidad como T25 en `perf/t25-inc1` el 2026-11-25. La rama local anterior conserva el estado descrito arriba.

## 4. Aceptación física en iPhone

[Las 16 pruebas](IPHONE-ACEPTACION.md) siguen **NO EJECUTADAS**. Solo puede ejecutarlas el propietario en su iPhone con Telegram real. B1, B2 y C3 ya cuentan con la v60 publicada.

## 5. Engram de Pulso Web

Al registrar v61 se sincronizó la base local compartida `.local/engram` con los ODD de `fix/artwork-rows-dock`. La lectura posterior verificó el proyecto `Pulso-Web`, contenido íntegro, bytes y SHA-256 de los 19 archivos. Un checkout con ODD de otra rama puede mostrar divergencias respecto a ese recibo. En las primeras rondas de T25 se usó una copia de proyecto en su propio worktree. La integración de T25 con v61 se sincronizó en la base compartida. Una invocación posterior en modo lectura verificó los 20 archivos, con contenido íntegro, bytes y SHA-256. El acta y la ubicación de la copia de proyecto previa están en [T25](../odd/tasks/T25-velocidad-bots.md#engram-compartido-y-limpieza).

## 6. Decisiones del propietario

- El 2026-11-25 el propietario decidió descartar la caché temporal de canciones de Telegram porque la primera reproducción sigue esperando la descarga completa. El informe está en `.local/research/telegram-cache-playback-2026-11-25/report.md`.
- Despliegue automático en Cloudflare al hacer push: sin decidir. No configurar nada.
- Bot privado de YouTube Music en un equipo de su casa: idea opcional, sin respuesta. El acceso directo desde la app web a YouTube no es viable; ver `.local/research/ytmusic-direct-neon-2026-11-24/report.md` y `.local/research/youtube-viability-2026-11-24/report.md`.

## 7. Infracción CSP heredada en WebKit

WebKit WPE emite `style-src-attr` con `blockedURI: inline` para el selector de Apariencia de [src/main.tsx:1547](../src/main.tsx#L1547). El mapa de fuentes sitúa el evento en `node_modules/react-dom/cjs/react-dom-client.production.js:8514`, en la llamada que crea el elemento `select`. La política aplicada procede de [index.html:1](../index.html#L1). La reproducción se confirmó en v60 (`086aaac`) y v61 (`d718b9d`). El arnés de velocidad registra esa infracción y la compara con la ejecución de referencia del mismo perfil.

## 8. Estado actualizado tras v67 · 2026-11-27

La publicación vigente es **v67** (`/releases/48727d3675574cce.html`), rama `release/v67`, despliegue `64a6d29f-9f27-4931-81f4-f5e8332c8f89` (versión 70).

### 8.0 Resuelto en v67 (`T31` + `T32`)
- **Agrupación fiel de álbumes sincronizados en escritorio (`T31`, `U-V67-01`):** `searchedAlbumChoice()` / `searchedITunesRelease()` conservan la edición de catálogo explícita (`itunes`/`musicbrainz`) sin exigir igualdad con la etiqueta ID3 `track.album` del bot cuando no hay `manualOverrides` (respetando el contrato de Spotify y la prioridad absoluta de `manualOverrides`), con ordenación por `catalogChoice.id` de respaldo y agrupación unificada en Inicio y Biblioteca. Verificado en vivo en Cloudflare: las 9 pistas del álbum real del perfil aparecen como **1** solo álbum (antes 2).
- **Borrado real de descargas al retirar álbum (`T32`, `U-V67-02`):** `evictFromQueue()` libera bundles de `sourceProtection`, actualiza `savedCheckpoint` y `library-playback` (incluyendo retiradas consecutivas sin recarga) y realiza re-preview manteniendo intactos `strictPolicy` y el CAS de `confirmCollectionRemoval`; además `affectedFor()` y `otherSavedTrackIds` cubren `coverTrackIds` de álbumes guardados. Verificado en vivo tras reproducir/pausar el álbum: «Retirar álbum» reporta `9/9` copias elegibles (`37,98 MB`, `0` protegidas) con aviso de retirada de cola.
- **Gestión manual de descargas agrupada y seleccionable (`T32`, `U-V67-03`, `U-V67-04`):** `groupStorageDownloads()` recibe `addedTrackIds` para que las canciones de playlists se muestren dentro de su playlist y no generen álbumes individuales falsos; las pistas en cola pasan a `· En cola` con checkbox habilitado (evicción al confirmar), reservando `· En uso` deshabilitado a operaciones activas o estado `unknown`; cada fila está envuelta en `<label className="storage-download-row">` (`≥ 44 px`, `74,36 px` en vivo) para seleccionar tocando cualquier punto.
- **Limpiar caché en dos modos (`T32`, `U-V67-05`):** Almacenamiento ofrece `Limpiar caché de escucha` (solo audios no guardados) y `Limpiar toda la caché` (habilitado incluso con `cacheCopies === 0`; borra audios no guardados, purga `pulso-web-cache-v1`, rota `PlayerArtworkCache` revocando ObjectURLs `A01`/`A02b` y limpia las 4 cachés de búsqueda en memoria conservando rate-limits, Biblioteca, álbumes guardados, playlists, Favoritos, portadas manuales y Telegram).

### 8.1 Resuelto en v66 (`T30`)
- **Nuevo control del reproductor (`U-V66-01`):** sustituido el glifo Unicode `⌄` por un tirador centrado estilo iOS (`.player-surface__grabber`, `72×44 px`, píldora redondeada + gesto swipe-down) y el chevrón `∧` del MiniPlayer por un icono SVG limpio de expansión diagonal.
- **Portadas de álbumes en Biblioteca e Inicio (`U-V66-02`, caso «mosca»):** `libraryAlbumCards()` expone `coverTrackIds` (incluyendo pistas en caché de escucha sin tocar `trackIds`/`albumRemovalMembership`), `CollectionCover`/`CatalogArtwork` revisan hasta 6 pistas candidatas + `sharedArtworkKey` (`albumArtworkKey`, respetando `K01` y revocación `A01`/`A02b`) + chequeo inmediato de visibilidad, y `preloadKeys` precarga `provider:<sharedKey>` y `artworkUrl`.
- **Poda de versiones anteriores en Cloudflare (`U-V66-03`):** política de retención ajustada a `0` versiones previas por instrucción expresa del propietario (`2026-11-27`). Retirados **300 archivos antiguos (84,40 MB)** en el despliegue de v66 (`50` rutas estáticas, `0` históricas; GET directo al recurso v65 anterior responde `404` y navegación `Accept: text/html` responde `200` abriendo v66). Los otros 3 Workers ajenos de la cuenta no se tocaron.

### 8.1 Resuelto en v65
- **Paleta negro puro OLED (`#000000`) + rojo vino oscuro (`#8c1630` / `#d84a67`):** tema oscuro por defecto en app, `index.html`, `manifest.webmanifest` y splash, modo claro manual (`#faf7f8` / `#7a1228`) conservado, Favoritos/letras/almacenamiento armonizados (`U-THEME-01`).
- **Rediseño UX/UI estilo Apple Music (`T29`, `U-UX-01`–`U-UX-08`):** eliminación de la tarjeta azul inline en álbumes y búsqueda; filas compactas de 2 líneas con icono discreto de descarga, `⋯` (`TrackActionsMenu`) y pulsación larga (`useLongPress`); `PlaybackIndicator` sustituyendo al número de pista en álbumes y superpuesto sobre carátula `48×48` en playlists y búsqueda; cabecera de álbum unificada sin `1 discos` con **▶ / ⇄ / ↓ / `⋯`**; sellado opaco inferior del `.mini-player` móvil (`::after` + `overflow: hidden` + progreso limpio); cola compacta con iconos SVG (`↑`, `↓`, `×`) a `320 px` 200 %; Inicio sin «Continuar escuchando» y con «Tus álbumes».
- **Sincronización Neon entre dispositivos (`U-SYNC-01`):** corregida la carrera de arranque antes de `prepareAccountLibrary()` (`preparedLibraryAccount === activeAccount`), el reencolado de cambios concurrentes durante una sincronización (`needsSync`) y el reintento manual `librarySync.retry()` bloqueado por backoff. Validado en prueba real de 3 contextos con dispositivo B limpio (`5/5` Chromium y WebKit) y verificado en vivo (`GET /api/account-library` HTTP `200`). Pendiente solo confirmación del propietario en un segundo dispositivo físico tras recargar v65.

### 8.2 Resuelto en v64
- **Sincronización 503 en producción (bloqueante anterior):** Cloudflare Workers rechazaba `redirect: 'error'` en `fetch()` con `TypeError`. Corregido con `redirect: 'manual'` en `deployment/cloudflare/account-data.mjs` y `deployment/cloudflare/turnstile.mjs` (con prueba de runtime Miniflare). Verificado en vivo con `GET /api/account-profile` y `/api/account-library` devolviendo **HTTP 200** y sincronización exitosa.
- **v64 en vivo y mejoras UX (`T28`):** resueltos D01 («Get Lucky» reprodujo en vivo sin `[D01]`), aviso transitorio «No se pudo guardar la canción», retirada del recuadro visual de cola sobre `MiniPlayer`, caché de portada compartida por álbum con precarga en lote y fixes WebKit T26 C03/C04, reproducción individual en álbum guardado en Biblioteca (`V64-08` nivel B), Siguiente/Anterior en álbumes (`V64-09` verificado en vivo) y retirada de «Añadidas recientemente» en Inicio (`V64-10` verificado en vivo).

### 8.3 Sesiones de prueba que siguen abiertas hasta tu aviso
- `.local/tmp/live-browser/profile` conserva tu sesión de Pulso **y la de Telegram** (utilizada con tu autorización para verificar v64 y v65 en vivo). Cuando lo indiques: cerramos la sesión de Telegram desde la app o desde Telegram → Ajustes → Dispositivos y borramos el perfil. No compartir ese perfil.
- El MCP de Neon sigue conectado en Codex en solo lectura.
