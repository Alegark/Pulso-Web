# T29 · Rediseño UX/UI estilo Apple Music + sincronización entre dispositivos (v65)

- **Método:** ODD (`doc/SPEC.md` §C.5 y §V.2)
- **Estado:** Publicada y verificada en vivo en Cloudflare Workers Free (USD 0) como **v65** (`/releases/5a7eef31d22eabf1.html`, despliegue `18c58796-f9f8-4e53-8572-9148055fec89`, versión 68). Aceptación física en iPhone (`D`): NO EJECUTADA.
- **Fecha:** 2026-11-26
- **Línea base:** v64 publicada (`/releases/9acd333be5ff334d.html`, commit `a056588`, rama `release/v64`). Worktree de UI/UX: `v65-ux-apple`. Worktree paralelo de sincronización: `v65-neon-sync`.
- **Requisitos SPEC vinculados:** W04, W05, W06, W07, W08, W10, W13, W17, W18 · **Invariantes SPEC:** V2, V3, V5, V6, V7, V8, V11, V13, V14, V15, V16, V19, V21, V22, V23, V27, V28, V29, V30
- **Fuentes de evidencia de origen:**
  - Captura real en iPhone aportada por el propietario el `2026-11-26` (vista de Álbum, filas numeradas con tarjeta azul inline `SelectedSongActions`, hueco bajo `.mini-player`, barra de progreso tocando borde redondeado, texto `1 discos`, `Descargada · En Biblioteca`).
  - Autorización expresa del propietario (`2026-11-26`) para implementar el paquete completo tomando **Apple Music como referencia visual**, preservando `doc/SPEC.md` §G.1 (ergonomía y jerarquía visual familiares sin copiar marca ni activos exactos de Apple).
  - Indicación expresa del propietario (`2026-11-26`) para migrar la identidad cromática completa a **negro puro OLED (`#000000`) + rojo vino oscuro (burdeos profundo)** con **modo oscuro por defecto** (conservando el selector manual `Oscura` / `Clara` / `Sistema` en Configuración).
  - Reglas vigentes de `T24`–`T28` (incluidos `V64-08` reproducción individual en álbum guardado y `V64-09` Siguiente/Anterior en álbum).

---

## Propósito

Elevar la ergonomía, limpieza visual, identidad cromática y coherencia táctil móvil de Pulso Web al estándar de un reproductor musical moderno (referencia visual Apple Music en paleta propia negro puro OLED + rojo vino oscuro, sin clonar marca ni activos) y garantizar la sincronización real de playlists entre dispositivos de la misma cuenta (`v65`):

0. **Paleta negro puro OLED + rojo vino oscuro (`U-THEME-01`):** establecer el modo oscuro (`#000000`) como predominante/por defecto en app, `index.html`, `manifest.webmanifest` y splash, con contraste WCAG AA (`W17`) mediante `--pulso-accent` (`#8c1630` en rellenos) y `--pulso-accent-text` (`#d84a67` sobre fondo negro), armonizando Favoritos, letras y gráfico de almacenamiento y conservando el modo claro manual (`#faf7f8`).
1. **Álbumes sin tarjeta azul gigante inline:** tocar una canción solo reproduce (o muestra progreso/error compacto en línea que desaparece al empezar a sonar); todas las acciones pasan a `⋯` (`TrackActionsMenu`) y pulsación larga (`~450 ms`).
2. **Indicador de reproducción (`PlaybackIndicator`) estilo Apple Music:** en Álbumes sustituye al número de pista a la izquierda; en Playlists/Biblioteca/Buscar se superpone centrado sobre la carátula `48×48` con velo oscuro sutil.
3. **Filas compactas de 2 líneas sin ruido textual:** eliminar `Descargada · En Biblioteca` y similares; mostrar icono discreto de descarga junto al artista, atenuación sutil (`opacity: .65`) en pistas no descargadas, botón `⋯` (`≥ 44×44 px`) y pulsación larga en Álbumes y Playlists.
4. **Cabecera de Álbum unificada:** corregir `1 discos` → omitir discos si hay 1 (`14 canciones · 13 descargadas`), portada centrada con sombra en móvil, barra única **▶ Reproducir**, **⇄ Aleatorio**, **↓ Descargar / Guardar en Biblioteca** y **`⋯`** (incluyendo *Retirar álbum* y *Fuente de los metadatos*).
5. **Zona inferior móvil sellada y barra de progreso limpia:** backing/degradado opaco detrás de `.shell-nav` y del hueco de `~8 px` bajo `.mini-player` para que el scroll nunca asome por debajo; `overflow: hidden` y geometría limpia en `.mini-player__mobile-progress`.
6. **Búsqueda limpia:** mismo patrón que Álbumes (progreso compacto inline que desaparece al empezar a sonar; `⋯` + pulsación larga para acciones de pista).
7. **Cola compacta en Reproductor:** sustituir cajas con borde y botones de texto (`Subir`, `Bajar`, `Quitar`) por filas compactas con iconos accesibles `↑`, `↓`, `×` (`≥ 44×44 px`) a la derecha.
8. **Inicio enfocado:** retirar «Continuar escuchando» (redunda con `.mini-player`) y añadir sección **«Tus álbumes»** junto a **«Tus playlists»** y accesos rápidos, preservando `.home-empty`.
9. **Sincronización entre dispositivos (Neon, `S01`):** validar de extremo a extremo que una playlist creada o modificada en Dispositivo A aparezca en Dispositivo B limpio tras iniciar sesión y sincronizar.

---

## Alcance autorizado y fuera de alcance

### Dentro de alcance
- Identidad cromática y tema por defecto: `src/ui/design-tokens.css`, `src/style.css`, `index.html`, `public/manifest.webmanifest`, `src/main.tsx` (tema inicial `'dark'`), `src/ui/collection-detail.css`, `src/ui/design-fidelity.css`, `src/ui/responsive-shell.css`, `src/ui/now-playing.css`, `src/ui/app-polish.css`, `src/ui/required-setup.css`, `src/ui/error-bubble.css`.
- Componentes y hojas de estilo de `src/ui/` y composición en `src/main.tsx`:
  - Álbumes: `src/ui/AlbumPageController.tsx`, `src/ui/album-page.css`, `src/ui/SelectedSongActions.tsx`, `src/ui/selected-song-actions.css`, `src/library/selected-song.ts`.
  - Menú de acciones y long-press: `src/ui/TrackActionsMenu.tsx`, `src/ui/track-actions-menu.css`, nuevo helper/hook ligero `src/ui/useLongPress.ts`.
  - Indicador de reproducción: `src/ui/PlaybackIndicator.tsx`, `src/ui/playback-indicator.css`, `src/ui/collection-detail.css`.
  - Cabecera de colección/álbum: `src/ui/CollectionHeader.tsx`, `src/ui/AlbumPageController.tsx`, `src/ui/DownloadDock.tsx` (solo si requiere ajuste menor de estilo en `CollectionDownloadButton`).
  - Shell inferior y MiniPlayer: `src/ui/responsive-shell.css`, `src/ui/mini-player.css`, `src/ui/design-fidelity.css`, `src/ui/app-polish.css`.
  - Búsqueda: `src/ui/MusicSearchPanel.tsx`, `src/ui/MusicSearchController.tsx`, `src/ui/music-search.css`, `src/ui/TelegramPanel.tsx` (paso de props).
  - Reproductor / Cola: `src/ui/NowPlayingView.tsx`, `src/ui/now-playing.css`, `src/main.tsx`.
  - Inicio: `src/ui/HomeView.tsx`, `src/main.tsx`.
- Sincronización Neon entre dispositivos: implementada en el worktree paralelo `v65-neon-sync` y verificada en la matriz de T29 (`U-SYNC-01`).
- Actualización de tests existentes afectados y adición de pruebas específicas de T29 en `tests/unit/` y `tests/integration/`.

### Fuera de alcance
- Cambios de infraestructura, servicios de pago o dependencias externas nuevas (**USD 0**).
- Copiar tipografías propietarias, logotipos, marcas o activos gráficos exactos de Apple Music (`doc/SPEC.md` §G.1).
- Alterar el esquema de `pulso-web-local-v1`, `pulso-assets-v1` (OPFS), `pulso-web-cache-v1` o el transporte de audio del Service Worker.
- Modificar `.local/engram/` o `.local/tmp/live-browser/profile`.
- Aceptación física en iPhone (`D`): las 16 pruebas de `docs/IPHONE-ACEPTACION.md` siguen **NO EJECUTADAS** hasta que el propietario las realice.

---

## Requisitos verificables (`U-THEME-01`, `U-UX-01…U-UX-08`, `U-SYNC-01`)

| ID | Área | Requisito y criterio de aceptación verificable |
|---|---|---|
| **U-THEME-01** | Paleta negro puro OLED + rojo vino oscuro (oscuro por defecto) | **(1)** El tema por defecto de la aplicación (sin preferencia guardada en IDB `settings/theme`) es **oscuro** (`data-theme="dark"` / `:root` oscuro), con fondo dominante negro puro OLED `#000000` (`--pulso-canvas`), superficies `#0d0b0d` (`--pulso-surface`), elevación `#161215` (`--pulso-surface-elevated`), texto principal `#f6f2f3`, texto secundario `#a89ca0` (>7:1 sobre `#000000`), relleno de acento rojo vino oscuro `#8c1630` (`--pulso-accent` con `--pulso-on-accent: #ffffff`, contraste 8.7:1) y texto/iconos de acento sobre fondo oscuro `#d84a67` (`--pulso-accent-text`, contraste ≥5.0:1 sobre `#000000` y `#0d0b0d`). **(2)** Favoritos (`.collection-cover--favorites`, `.home-quick`, `.favorite-art`) usa degradado vino `linear-gradient(135deg, #4a0817, #9e1b38)`; tarjeta de letras `--np-card: #1d080f`; gráfico de almacenamiento armonizado (`#9e1b38` guardadas, `#c98a4b` caché), sin remanentes azules/morados desentonados. **(3)** `index.html` y `public/manifest.webmanifest` fijan `background_color: "#000000"` y `theme_color: "#000000"` (`#faf7f8` en modo claro). **(4)** El selector de Apariencia en Configuración (`Oscura` / `Clara` / `Sistema`) sigue plenamente operativo y el tema claro manual (`data-theme="light"`) aplica la paleta cálida clara (`#faf7f8` / `#ffffff` / `#7a1228`) cumpliendo contraste WCAG AA (`W17`). |
| **U-UX-01** | Álbumes: reproducción limpia + `⋯` + long-press | Al tocar una pista en `AlbumPageController` (Biblioteca o Buscar): **(1)** inicia reproducción directamente (o adquisición bajo demanda conforme a `V64-08` y cola de álbum conforme a `V64-09`) **sin** renderizar ningún bloque inline con *«Reproduciendo la canción desde la copia de este navegador»* ni *«Opciones de la canción»*; **(2)** mientras está buscando/descargando/guardando (`pending` / `resolvingSingle`) o si ocurre un error (`error`), muestra un indicador compacto inline debajo de esa fila (barra `<progress>` fina `4 px` + texto breve + botón `Cancelar carga` ≥44×44 px, o `role="alert"` breve), que **desaparece** en cuanto empieza a reproducir (`phase === 'done'` sin error); **(3)** cada fila tiene un botón `⋯` (`≥ 44×44 px`, `TrackActionsMenu`) a la derecha **y** soporta pulsación larga (`~450 ms`, cancelable si el desplazamiento supera `10 px` o se hace scroll, sin disparar `click`/reproducción) con las acciones: *Favorito / Quitar favorito*, *Añadir a Biblioteca / En Biblioteca*, *Añadir a playlist*, *Reproducir a continuación*, *Añadir al final de la cola*, *Gestionar copia local* e *Información*. |
| **U-UX-02** | `PlaybackIndicator` estilo Apple Music | **(1)** En Álbumes (filas numeradas), cuando la pista coincide con la reproducción activa (`playerTrackId === trackId && playerPlaying`), `<PlaybackIndicator />` en color acento **sustituye** al número de pista dentro de `.album-track-number` y el título pasa a `var(--pulso-accent)`; nunca se renderiza en una 3.ª línea ni dentro de `.album-track-badges`. **(2)** En Playlists, Favoritos, Biblioteca y Buscar (filas con carátula `48×48`), `<PlaybackIndicator />` se superpone centrado **encima de la carátula** sobre un velo oscuro sutil (`rgba(0,0,0,.45)`, `border-radius: inherit`) con barras animadas de alto contraste (`#fff`), eliminando el solapamiento/posicionamiento flotante sobre el texto (`collection-detail.css:94-95`); el título de la pista activa pasa a `var(--pulso-accent)`. **(3)** En pausa o sin reproducción activa, el indicador no aparece. **(4)** Con `prefers-reduced-motion: reduce`, las barras se muestran estáticas sin animación. |
| **U-UX-03** | Filas compactas de 2 líneas + long-press en Playlists | **(1)** En Álbumes y Playlists, cada fila de canción ocupa **2 líneas** limpias: `Título` arriba, `[icono discreto de descarga ↓/✓ cuando está descargada, aria-hidden="true"]` + `Artista` (y álbum en playlists cuando aplique) abajo, más botón `⋯` (`≥ 44×44 px`) a la derecha. **(2)** Se elimina el texto repetitivo `Descargada · En Biblioteca`, `En caché de escucha`, `Copia sin comprobar` y `Sin descarga` debajo de cada canción; el estado de copia sigue consultable en *Información* dentro de `⋯` y expuesto en `data-track-state` para diagnósticos/tests. **(3)** Las pistas no descargadas se atenúan visualmente (`opacity: .65` en el bloque de texto) y solo muestran línea de estado visible cuando hay descarga en curso o error. **(4)** En Playlists y Biblioteca, la pulsación larga (`~450 ms`, cancelable al hacer scroll `> 10 px`) sobre la fila abre el mismo `TrackActionsMenu` que el botón `⋯`, sin interferir con el clic normal ni con la accesibilidad de teclado/VoiceOver. |
| **U-UX-04** | Cabecera de Álbum unificada | **(1)** Corrección de pluralización y limpieza de metadatos: `1 discos` jamás aparece; si el álbum tiene 1 disco se omite el número de discos y se muestra una sola línea limpia (`14 canciones · 13 descargadas` si está guardado o hay descargas, o `14 canciones` / `1 canción` si no). Si tiene `> 1` disco: `N canciones · D discos` (y `· K descargadas` si aplica). **(2)** En móvil (`≤ 600 px`), portada centrada con sombra elegante (`0 1rem 2.5rem #07112020`), título y artista claros. **(3)** Una sola barra de acciones estilo Apple Music / `CollectionHeader`: **▶ Reproducir**, **⇄ Aleatorio**, **↓ Descargar / Guardar en Biblioteca** y **`⋯`** (`TrackActionsMenu`), moviendo *Retirar álbum* (`.collection-menu-danger`) y *Fuente de los metadatos* (enlace iTunes US / MusicBrainz) al interior de `⋯`. |
| **U-UX-05** | Cierre de hueco bajo MiniPlayer móvil + progreso limpio | **(1)** En móvil (`≤ 1023 px`), existe un backing/degradado opaco detrás de `.shell-nav` y del hueco de `~8 px` bajo `.mini-player` que cubre todo el ancho del viewport, garantizando que el contenido desplazable nunca asome por debajo de `.mini-player` ni entre `.mini-player` y `.shell-nav`. **(2)** `.mini-player` móvil aplica `overflow: hidden` (sin recortar anillos de foco accesibles) y `.mini-player__mobile-progress` se alinea limpiamente al borde inferior interior (`inset-inline: 0; inline-size: 100%; inset-block-end: 0`) respetando la curvatura `border-radius` de la tarjeta sin chocar ni sobresalir. **(3)** En escritorio (`≥ 1024 px`), el layout de 3 columnas de `.mini-player` y `.shell-nav` lateral permanecen intactos. |
| **U-UX-06** | Búsqueda limpia (`MusicSearchPanel` / `MusicSearchController`) | **(1)** Tocar un resultado de canción (`kind === 'track'`) reproduce o descarga con un estado compacto inline debajo de la fila (barra de progreso fina + botón `Cancelar carga`, o error breve), que **desaparece** en cuanto empieza a reproducir (sin tarjeta azul gigante persistente). **(2)** Cada resultado `track` ofrece botón `⋯` (`≥ 44×44 px`, `TrackActionsMenu`) a la derecha y pulsación larga (`~450 ms`, cancelable al hacer scroll) para *Añadir a Biblioteca*, *Añadir a playlist*, *Reproducir a continuación*, *Añadir al final de la cola* y *Favorito* (habilitados cuando la pista está resuelta localmente, con estado honesto si aún no tiene copia local). **(3)** Resultados `album` y `artist` conservan su comportamiento de navegación y chevron `›`. |
| **U-UX-07** | Cola compacta en Reproductor | En `NowPlayingView` / `.player-queue`, las filas de la cola se presentan como filas horizontales compactas sin cajas con borde por fila: título (y pista actual marcada con `aria-current="true"` en color acento) a la izquierda, y 3 botones discretos de icono (`↑`, `↓`, `×` con SVG `aria-hidden="true"`) de `≥ 44×44 px` a la derecha, conservando exactamente los `aria-label` accesibles (`Subir en cola <título>`, `Bajar en cola <título>`, `Quitar de cola <título>`) y sin desbordamiento horizontal al 200 % de texto en `320 px`. |
| **U-UX-08** | Inicio limpio + «Tus álbumes» | **(1)** Se retira la tarjeta redundante **«Continuar escuchando»** (`home-continue-heading`, `.home-continue`) de `HomeView.tsx`. **(2)** Se añade la sección **«Tus álbumes»** (`home-albums-heading`) mostrando los álbumes guardados en Biblioteca (`libraryAlbums` con portada, título y artista/conteo, abriendo el álbum al pulsar) junto a **«Tus playlists»** y los accesos rápidos superiores (`.home-quick`). **(3)** Cuando no hay canciones ni álbumes guardados en Biblioteca, `.home-empty` (*«Haz espacio para tu música»*) permanece visible. |
| **U-SYNC-01** | Sincronización Neon entre dispositivos (`v65-neon-sync`) | Con dos dispositivos / contextos de navegador aislados (**Dispositivo A** y **Dispositivo B** limpio sin IndexedDB previa) autenticados en la misma cuenta Pulso: crear o modificar una playlist (añadir/reordenar/renombrar) en Dispositivo A y sincronizar (`PUT /api/account-library` → HTTP `200`, persistido en Neon) → iniciar sesión en Dispositivo B limpio y cargar/sincronizar (`GET /api/account-library` → HTTP `200`) → la playlist aparece intacta con sus pistas en **Biblioteca** y en **Inicio** de Dispositivo B, sin pérdida de datos ni errores `5xx`. |

---

## Invariantes que no pueden romperse

1. **Identidad y diseño propio (`doc/SPEC.md` §G.1):** Inspiración de ergonomía y jerarquía de Apple Music; cero copias de marcas, logotipos, nombres o activos propietarios. Mantener los tokens semánticos (`src/ui/design-tokens.css`) en modo claro y oscuro.
2. **Accesibilidad (`W17` / `AC20` / `V27`):**
   - Todos los controles interactivos (`⋯`, `▶`, `⇄`, `↓`, `↑`, `↓`, `×`, `Cancelar carga`) mantienen un área táctil mínima de **`≥ 44×44 px`**.
   - Ninguna acción depende exclusivamente de long-press o color: toda acción accesible por pulsación larga está siempre disponible vía botón `⋯` con foco por teclado y lector de pantalla (VoiceOver).
   - `prefers-reduced-motion: reduce` desactiva la animación de barras de `PlaybackIndicator` y transiciones de escala.
   - Al **200 % de tamaño de texto** en `320×568` y `390×844` (y horizontal `844×390`), `document.documentElement.scrollWidth <= window.innerWidth + 1` (cero desbordamiento horizontal).
3. **Reglas de reproducción y álbumes (`T24`–`T28`, `V64-08`, `V64-09`, `V13`–`V16`, `V19`, `V28`):**
   - Tocar una pista no descargada en un álbum guardado en Biblioteca sigue adquiriéndola individualmente bajo demanda en caché de escucha sin descargar el álbum completo (`V64-08`).
   - Tocar una pista en un álbum sigue encolando las pistas disponibles localmente en orden de disco/pista para «Siguiente», «Anterior» y avance automático `ended` sin disparar descargas implícitas (`V64-09`).
   - Un solo `HTMLAudioElement`; sin autoplay tras recarga o cambio de pestaña; cancelación invalida identidad antes de abortar (`V2`, `V3`).
4. **Reglas de caché y portadas (`T26`, `V64-05`–`V64-07`):**
   - Mantener `.collection-track-art` con `<img>` de `48×48 px` (`object-fit: cover`), caché compartida por álbum (`edition:*` / `album:*`), prioridad de portada manual/oculta (`K01`) y precarga en lote.
5. **Presupuesto y evidencia honesta (`V29`, `V30`):**
   - USD 0 estricto; Chromium y WebKit de escritorio nunca se declaran aceptación física en iPhone (`D` sigue **NO EJECUTADA**).

---

## Diseño detallado por pantalla y archivo

### 0. Paleta negro puro OLED + rojo vino oscuro (`U-THEME-01`) · `src/ui/design-tokens.css`, `src/style.css`, `index.html`, `public/manifest.webmanifest`, `src/main.tsx` y CSS de pantallas
- **Tokens canónicos en `src/ui/design-tokens.css` (oscuro por defecto en `:root` y `html[data-theme="dark"]`):**
  - `--pulso-canvas: #000000` (negro puro OLED)
  - `--pulso-surface: #0d0b0d` (tarjetas, MiniPlayer, bottom-sheet, diálogos)
  - `--pulso-surface-elevated: #161215` (hover / elevación sutil sin tinte azulado)
  - `--pulso-foreground: #f6f2f3` (texto principal blanco cálido)
  - `--pulso-muted: #a89ca0` (texto secundario gris humo cálido, contraste >7:1 sobre `#000000`)
  - `--pulso-accent: #8c1630` (rojo vino oscuro para rellenos: ▶ Reproducir, Play/Pause del MiniPlayer, botones primarios; `--pulso-on-accent: #ffffff`, contraste 8.7:1)
  - `--pulso-accent-text: #d84a67` (vino/carmesí luminoso, contraste ≥5.0:1 sobre `#000000` y `#0d0b0d`, para título de pista activa, pestaña activa de `.shell-nav`, barras `PlaybackIndicator` inline, punto de `.pulso-wordmark::after`, enlaces y botones de texto acento sobre fondo oscuro)
  - `--pulso-soft: #240911` (borgoña muy oscuro para estados suaves, botón aleatorio activo, selección)
  - `--pulso-border: #221a1e` · `--pulso-control-border: #4d3a41` · `--pulso-danger: #ff6b7a`
  - Aliases heredados: `--surface: var(--pulso-surface); --text: var(--pulso-foreground); --border: var(--pulso-border);`
- **Tokens de Tema Claro (`html[data-theme="light"]` y `@media (prefers-color-scheme: light) { html[data-theme="system"] { ... } }`):**
  - `--pulso-canvas: #faf7f8`, `--pulso-surface: #ffffff`, `--pulso-surface-elevated: #f5eff1`, `--pulso-foreground: #180d11`, `--pulso-muted: #66545a`, `--pulso-accent: #7a1228`, `--pulso-accent-text: #7a1228`, `--pulso-on-accent: #ffffff`, `--pulso-soft: #f5e6ea`, `--pulso-border: #e6d8dc`, `--pulso-control-border: #7d6770`, `--pulso-danger: #b42334`.
- **Inicialización de tema por defecto (`src/main.tsx:1225,1362,1649`):**
  - Cambiar `useState('system')` → `useState('dark')` y asegurar `document.documentElement.dataset.theme = 'dark'` al arrancar mientras no exista una preferencia guardada (`'light'` o `'system'`) en IDB `settings/theme`.
  - Conservar el `<select>` de Apariencia en Configuración con las 3 opciones (`Oscura`, `Clara`, `Sistema`) y actualizar `document.querySelector('meta[name="theme-color"]')` en coherencia si cambia el tema en vivo.
- **Armonización de superficies con colores literales antiguos:**
  - `index.html`: `<meta name="theme-color" content="#000000">` (o `media="(prefers-color-scheme: light)"` solo si aplica, manteniendo `#000000` por defecto) y `<meta name="color-scheme" content="dark light">`.
  - `public/manifest.webmanifest`: `"background_color": "#000000"`, `"theme_color": "#000000"`.
  - `src/style.css:1-4`: sustituir `color-scheme: light dark` / `#20242c` / `#2878ed` por `color-scheme: dark light` y tokens `--pulso-*` (`--pulso-accent-text` en `:focus-visible`).
  - Favoritos (`src/ui/collection-detail.css:3`, `src/ui/design-fidelity.css:14`, `src/ui/responsive-shell.css:133`): sustituir los degradados azules (`#2444bc,#5099ad` y `#2855c8,#a4bfff`) por `linear-gradient(135deg, #4a0817, #9e1b38)`.
  - Tarjeta de letras (`src/ui/now-playing.css:1-3`): `--np-card: #1d080f` en oscuro por defecto y `--np-card: #f3e3e8` en claro (`html[data-theme="light"]` y `system` claro).
  - Gráfico de almacenamiento (`src/ui/app-polish.css:77-83`): `.storage-summary__saved { background: #9e1b38; fill: #9e1b38; }`, `.storage-summary__cache { background: #c98a4b; fill: #c98a4b; }`, `.storage-estimate progress { accent-color: #9e1b38; }`.
  - `src/ui/required-setup.css:2` y `src/ui/error-bubble.css:40`: usar fallback `#000000` / `#f6f2f3` / `var(--pulso-accent-text)` sin referencias al antiguo azul `#235ad7` ni `#f4f6fa`.
  - **Regla de uso `--pulso-accent` vs `--pulso-accent-text`:** usar `var(--pulso-accent)` únicamente en fondos/rellenos con texto `var(--pulso-on-accent)` (`#ffffff`), y usar `var(--pulso-accent-text)` siempre que el color vaya en texto, iconos o bordes sobre `#000000` / `#0d0b0d` (título de pista activa, pestaña activa de `.shell-nav`, `<PlaybackIndicator variant="inline">`, `.pulso-wordmark::after`, botones de texto en Inicio/Ajustes, `:focus-visible`).

### 1. Hook reutilizable de pulsación larga · `src/ui/useLongPress.ts` (nuevo)
- **API:** `useLongPress({ onLongPress, disabled, delayMs = 450, moveTolerancePx = 10 })` devuelve handlers `{ onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture, onContextMenu }`.
- **Reglas de seguridad táctil:**
  - Solo arma el temporizador en puntero primario (`event.isPrimary && (event.pointerType !== 'mouse' || event.button === 0)`), ignorando eventos originados dentro de `.track-actions-trigger`, `dialog`, o botones secundarios.
  - Guarda `(clientX, clientY)` en `pointerdown`. Si en `pointermove` `Math.hypot(dx, dy) > 10`, cancela inmediatamente el temporizador (el usuario está haciendo scroll).
  - Si el temporizador llega a `450 ms`: marca `triggered = true`, invoca `onLongPress()`, y en `onClickCapture` inmediatamente posterior llama `event.preventDefault(); event.stopPropagation();` (limpiando `triggered` tras un tick/timeout corto) para evitar que el soltar el dedo dispare la reproducción.
  - En `onContextMenu`: si `triggered` está activo o el puntero táctil está armado, llama `event.preventDefault()` para evitar el menú contextual nativo de iOS Safari sobre la fila.
  - Limpia el temporizador en `unmount` (`useEffect` cleanup).

### 2. Menú de acciones controlado/imperativo · `src/ui/TrackActionsMenu.tsx` y `src/ui/track-actions-menu.css`
- Añadir prop opcional `openSignal?: number` (o `ref` imperativo `TrackActionsMenuHandle { open(): void }`) para que `useLongPress` en la fila pueda abrir exactamente el mismo `<dialog className="track-actions-menu">` sin duplicar modales ni romper el retorno de foco al `.track-actions-trigger` al cerrar.
- En móvil (`max-width: 600px`), conservar el bottom sheet con tirador (`.track-actions-menu__handle`), cabecera con carátula/título/artista, botón cerrar `44×44 px` y cierre por backdrop o `Escape`.

### 3. Indicador de reproducción · `src/ui/PlaybackIndicator.tsx`, `src/ui/playback-indicator.css`, `src/ui/collection-detail.css`
- **`PlaybackIndicator.tsx`:** aceptar prop opcional `variant?: 'inline' | 'overlay'` (default `'inline'`). Renderizar 3 o 4 `<rect>`/`<line>` o `<span className="playback-indicator__bar"/>` independientes dentro de `<span className={`playback-indicator playback-indicator--${variant}`} role="img" aria-label="Reproduciendo" title="Reproduciendo">`.
- **`playback-indicator.css`:**
  - Animar cada barra con `scaleY` desfasado (`animation-delay: 0ms, 150ms, 300ms`) usando `transform-origin: bottom` (más fluido en GPU que cambiar `height`).
  - `@media (prefers-reduced-motion: reduce)`: `animation: none; transform: scaleY(...)` con alturas escalonadas fijas (`0.55`, `1`, `0.72`).
  - `.playback-indicator--overlay`: `position: absolute; inset: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, .45); color: #fff; border-radius: inherit; pointer-events: none;`.
- **`collection-detail.css`:**
  - En `.library-detail .tracks .collection-track-art`: añadir `position: relative;` para contener `.playback-indicator--overlay`.
  - **Eliminar** líneas `94-95` (`.collection-track-main:has(.playback-indicator)` y `.collection-track-main > .playback-indicator { position: absolute; ... }`).
  - Mantener `.collection-track-main[aria-current="true"] strong { color: var(--pulso-accent); }`.

### 4. Filas compactas y estado inline en Álbumes · `src/ui/AlbumPageController.tsx`, `src/ui/album-page.css`, `src/ui/SelectedSongActions.tsx`, `src/ui/selected-song-actions.css`, `src/ui/app-polish.css`
- **Eliminación de tarjeta azul gigante tras reproducir:**
  - En `MusicSearchController.tsx:397-404`, `songActions` (renombrable o reutilizando `SelectedSongActions` en modo compacto) **solo** se renderiza cuando hay operación activa (`resolvingSingle || ownPending || saving || localPending || organizing`) o error visible (`songError || state?.error || selected.phase === 'error'`). Cuando `selected.phase === 'done'` y no hay error, **no se renderiza** ningún bloque inline debajo de la fila.
  - Conservar un anuncio `pulso-visually-hidden` (`role="status" aria-live="polite"`) en `MusicSearchController` para lectores de pantalla y para mensajes terminales de estado (como cancelación o confirmación de biblioteca/playlist).
  - En estado compacto (`pending` o `error`): una sola franja limpia debajo de la fila (`grid-column: 1 / -1`), sin `<h3>`/`<details>Opciones de la canción</details>`, con texto breve (1 línea), `<progress>` de `4 px` (si `pending`) y botón `Cancelar carga` (`min-height: 44px`), o `<p role="alert">` breve en caso de error.
- **Filas de pistas en `AlbumPageController.tsx` (`ol.album-tracks > li`):**
  - Estructura CSS Grid en cada `<li>`: `grid-template-columns: minmax(0, 1fr) 44px; align-items: center; column-gap: .5rem;` (sin `.album-track-badges` en 3.ª línea).
  - Botón principal (`button.album-track-main`):
    - Izquierda (`.album-track-number`, `width: 2rem; flex: 0 0 2rem`): si `trackId && props.playerTrackId === trackId`, renderizar `<PlaybackIndicator variant="inline" />`; si no, `{track.position}`.
    - Centro (`.album-track-copy`):
      - `<strong><bdi dir="auto">{displayTitle}</bdi></strong>` (color `var(--pulso-accent)` cuando reproduce).
      - `<span className="album-track-sub">{present && <DownloadedIcon />}{displayArtist}</span>` (icono SVG discreto `13×13 px`, `aria-hidden="true"`, solo cuando `present === true`).
    - Si `!present`: aplicar `data-album-pending="true"` (en Biblioteca y Buscar cuando no está descargada) con `opacity: .65` en `.album-track-copy`. Exponer `data-track-state={present ? (savedAlbum && !inLibrary ? 'cached' : 'downloaded') : failed ? 'error' : copy?.state === 'missing' ? 'missing' : 'unknown'}` en el `<li>`.
    - Si `failed` (error de descarga de lote): mostrar una línea compacta de error (`<span className="album-track-error" role="status">Error al descargar</span>`) debajo de la fila.
  - Derecha: `<TrackActionsMenu title={displayTitle} artist={displayArtist} active={props.visible && !props.metadataOnly} ...>` con:
    - *Favorito / Quitar favorito* (cuando hay `trackId` local y `canOrganize`)
    - *Añadir a Biblioteca / En Biblioteca* (usando `management.add` / `addTrackToLibrary`)
    - *Añadir a una playlist* (`TrackPlaylistAction`)
    - *Reproducir a continuación* y *Añadir al final de la cola* (habilitados si `present && trackId`)
    - *Gestionar copia local* (habilitado si `trackId` es elegible para retirada)
    - *Información de la canción* (`<details>`: álbum, disco/pista, duración y estado honesto de copia — aquí siguen visibles *Descargada*, *En caché de escucha*, *No descargada*, *En Biblioteca*)
  - En el `<li>`: conectar `useLongPress` para abrir ese `TrackActionsMenu`.
- **Plumbing de acciones de pista (`src/library/selected-song.ts`, `src/main.tsx`, `src/ui/TelegramPanel.tsx`, `src/ui/MusicSearchController.tsx`):**
  - Ampliar `SongManagement` (o añadir un callback `trackMenuActions` / `onQueueTrack` / `onToggleFavorite` / `onOpenRemoval` en `MusicSearchController` y `AlbumPageController`) reutilizando las mismas operaciones admitidas de `src/main.tsx` (`toggleFavorite`, `addSelection`, `openRemoval`, `addTrackToLibrary`, `changePlaylist`), sin duplicar lógica de negocio ni saltarse `canOrganize`/`canAppend`.

### 5. Cabecera de Álbum unificada · `src/ui/AlbumPageController.tsx`, `src/ui/album-page.css`, `src/ui/app-polish.css`, `src/main.tsx`
- **Metadatos limpios:**
  - Calcular `discCount = new Set(detail.tracks.map(t => t.disc)).size`.
  - Etiqueta de canciones: `${detail.tracks.length} ${detail.tracks.length === 1 ? 'canción' : 'canciones'}`.
  - Si `discCount > 1`: añadir `· ${discCount} discos`.
  - Si `savedAlbum` (o `downloaded > 0`): añadir `· ${downloaded} ${downloaded === 1 ? 'descargada' : 'descargadas'}`.
  - Resultado en 1 disco guardado con 13/14: `14 canciones · 13 descargadas`. Sin guardar con 14 pistas: `14 canciones`. Con 2 discos: `24 canciones · 2 discos`.
- **Portada y jerarquía móvil:**
  - En móvil (`≤ 600 px`), alinear `.album-hero` con `.collection-header`: portada centrada (`inline-size: min(72%, 17rem)`, `border-radius: .75rem`, `box-shadow: 0 1rem 2.5rem #07112020`), título (`h2`) y artista (`.album-artist`) centrados o alineados coherentemente con Playlists, y metadatos en una sola línea sutil.
- **Barra única de acciones (`.album-actions`):**
  - **▶ Reproducir** (`.collection-play` o botón acento primario): reproduce el álbum desde la primera pista disponible (o pista 1 si ninguna está descargada, siguiendo `V64-08`/`V64-09`). Si la cola actual ya está reproduciendo este álbum, alterna pausa/play.
  - **⇄ Aleatorio** (`.collection-shuffle`): inicia/alterna reproducción aleatoria sobre las pistas disponibles del álbum.
  - **↓ Descargar / Guardar en Biblioteca** (`CollectionDownloadButton` estilizado como en `CollectionHeader`, manteniendo el guardado del álbum en Biblioteca + descarga de faltantes).
  - **`⋯` (`TrackActionsMenu` con `label="Opciones del álbum"`):**
    - *Guardar álbum en Biblioteca* (si `!savedAlbum && props.saveAlbum`, para guardar sin descargar).
    - *Fuente de los metadatos* (`<details>` con el enlace a iTunes US o MusicBrainz · respaldo, retirando el `<details className="catalog-sources">` suelto del fondo de la página).
    - *Retirar álbum* (`.collection-menu-danger`, cuando `savedAlbum` existe; sustituye al botón suelto `props.albumOptions` que estaba en la barra principal).

### 6. Filas de Playlists / Biblioteca · `src/main.tsx:1725-1744`, `src/ui/collection-detail.css`
- Mover `<PlaybackIndicator variant="overlay" />` dentro de un contenedor relativo junto a `<CatalogArtwork className="collection-track-art" />` (o dentro del propio wrapper `.collection-track-art-wrap` de `48×48 px` conservando `.collection-track-art img` para compatibilidad con tests).
- En la 2.ª línea de `.collection-track-main`: anteponer icono discreto `13×13 px` de descarga (`aria-hidden="true"`) cuando `trackAvailability(track, availability) === 'available'`.
- Si `trackAvailability(track, availability) !== 'available'`: añadir `data-track-pending="true"` en el `<li>` para aplicar `opacity: .65` en `.collection-track-main`.
- Conectar `useLongPress` en cada `<li>` de `.library-detail .tracks` para abrir el `TrackActionsMenu` de esa fila.

### 7. Sellado inferior del MiniPlayer móvil y barra de progreso · `src/ui/responsive-shell.css`, `src/ui/mini-player.css`, `src/ui/design-fidelity.css`
- **Backing opaco móvil (`@media (max-width: 1023px)`):**
  - En `.pulso-app .shell-nav` (que ya es `position: fixed; bottom: 0; inset-inline: 0; z-index: 20` en móvil) o mediante un pseudo-elemento `.pulso-app::after` fijo (`position: fixed; inset-inline: 0; inset-block-end: 0; block-size: calc(var(--nav-height, 0px) + var(--mini-height, 0px) + 1rem); z-index: 18; pointer-events: none; background: linear-gradient(to bottom, transparent 0%, var(--pulso-canvas) 35%, var(--pulso-canvas) 100%);`), asegurar que:
    - El `z-index` queda **por encima** del contenido del documento y **por debajo** de `.mini-player` y `.shell-nav`.
    - El hueco de `~8 px` entre `.mini-player` y `.shell-nav` y los márgenes laterales inferiores quedan 100 % cubiertos por `var(--pulso-canvas)` (en claro y oscuro).
    - No se pinta cuando `[data-player-open="true"]` o en escritorio (`≥ 1024 px`).
- **Barra de progreso limpia en `.mini-player` móvil (`mini-player.css`):**
  - En móvil (`@media (max-width: 1023px)`): `.pulso-app .mini-player { overflow: hidden; }` (el `focus-visible` de `.mini-player__details`, `.mini-player__toggle` y `.mini-player__expand` usa `outline-offset: -3px` para quedar 100 % visible dentro del contenedor).
  - `.pulso-app .mini-player__mobile-progress { position: absolute; inset-inline: 0; inset-block-end: 0; inline-size: 100%; block-size: 2.5px; border-radius: 0; margin: 0; }` — el `border-radius: .8rem` + `overflow: hidden` del `.mini-player` recorta las esquinas limpiamente sin colisión visual.

### 8. Búsqueda · `src/ui/MusicSearchPanel.tsx`, `src/ui/MusicSearchController.tsx`, `src/ui/music-search.css`
- Cada `<li>` de `.catalog-mixed-list` para `row.kind === 'track'`:
  - Grid de 2 columnas (`minmax(0, 1fr) 44px`) con el botón principal `[data-suggestion-id]` a la izquierda y `<TrackActionsMenu>` (`⋯`, `44×44 px`) a la derecha + `useLongPress` en la fila.
  - `<PlaybackIndicator variant="overlay" />` sobre `.catalog-art` (`48×48`) cuando `row.trackId && props.playingTrackIds?.has(row.trackId)`.
  - Cuando `row.id === props.selectedSuggestionId` y hay descarga/resolución en curso o error: renderizar el bloque compacto inline (`grid-column: 1 / -1`) debajo de la fila; en cuanto la canción empieza a reproducir (`phase === 'done'` sin error), el bloque desaparece.
- Filas `album` y `artist`: mantienen el botón full-width con chevron `›` sin menú `⋯`.

### 9. Cola de reproducción · `src/main.tsx:1604-1617`, `src/ui/NowPlayingView.tsx`, `src/ui/now-playing.css`
- En `playerQueue()` (`src/main.tsx:1608-1616`):
  - Sustituir el contenido visible de texto `Subir`, `Bajar`, `Quitar` por iconos SVG discretos (`↑`, `↓`, `×`, `aria-hidden="true"`), conservando **exactamente**:
    - `aria-label={`Subir en cola ${entry.title}`}`
    - `aria-label={`Bajar en cola ${entry.title}`}`
    - `aria-label={`Quitar de cola ${entry.title}`}`
- En `now-playing.css` y `app-polish.css`:
  - Reemplazar las cajas con borde (`.player-queue li { border: 1px solid ...; border-radius: 1rem; grid-template-columns: repeat(3, ...); }`) por filas compactas estilo Apple Music:
    - `display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: .25rem; padding: .35rem 0; border: 0; border-bottom: 1px solid var(--pulso-border); border-radius: 0;`
    - Grupo derecho `.player-queue__actions { display: flex; align-items: center; gap: 0; flex: none; }` con botones `inline-size: 44px; block-size: 44px; min-inline-size: 44px; min-block-size: 44px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--pulso-muted);`.
    - A `max-width: 340px` o texto 200 %: permitir que el título envuelva en hasta 2 líneas sin desbordar (`min-inline-size: 0; overflow-wrap: anywhere;`).

### 10. Inicio · `src/ui/HomeView.tsx`, `src/main.tsx:1661`, `src/ui/responsive-shell.css`, `src/ui/app-polish.css`
- Retirar `continueSelection`, `home-continue-heading` y `.home-continue` de `HomeView.tsx` y su CSS asociado en `responsive-shell.css`, `design-fidelity.css` y `app-polish.css`.
- Añadir prop `albums: readonly HomeAlbum[]` (`{ key: string; title: string; artist: string | null; count: number; artworkUrl?: string; trackIds: readonly string[]; saved: boolean }`) y `onOpenAlbum: (key: string, opener: HTMLButtonElement) => void` a `HomeViewProps`.
- En `HomeView.tsx`, renderizar `<section aria-labelledby="home-albums-heading">` con `<h3>Tus álbumes</h3>` y rejilla `.home-albums` (reutilizando el mismo estilo de tarjetas cuadradas limpias que `.home-playlists`) cuando `albums.length > 0`.
- En `src/main.tsx:1661`, pasar `albums={libraryAlbums.map(...)}`, `empty={!tracks.length && !libraryAlbums.length}` y `onOpenAlbum` abriendo el álbum en Biblioteca (misma lógica que el clic de tarjeta de álbum en `src/main.tsx:1665-1667`).

---

## Auditoría de tests existentes y dependencias a actualizar

Para evitar regresiones ocultas al implementar T29, se auditaron todas las suites de `tests/` (incluidas las 9 nombradas expresamente).

### A. Suites nombradas en el encargo (9)

| Test | Dependencias detectadas | Impacto y acción requerida |
|---|---|---|
| `tests/integration/check-artwork-rows-dock.mjs` | `L164`: `.library-detail .tracks>li:has(button[aria-label="Escuchar ..."]) .collection-track-art img` | **Bajo / Compatible:** conservar la clase `.collection-track-art` envolviendo la `<img>` de `48×48` al añadir `<PlaybackIndicator variant="overlay" />`. |
| `tests/integration/check-download-feedback.mjs` + `download-feedback-fixture.tsx` | `L14`: `assert.equal(await page.locator('.selected-song-actions').count(), 1)`, `Cancelar carga`, `progressbar` en búsqueda y álbum | **Alto:** actualizar para comprobar el bloque compacto inline durante `pending` (con `progressbar` y `Cancelar carga`) y verificar que desaparece cuando `pending === false && !error`. |
| `tests/integration/check-player-notice.mjs` | `.mini-player__title`, `[role=status]` dentro de `#player` | **Sin rotura esperada:** verificar que el backing móvil no altera `.mini-player` ni añade avisos pintados. |
| `tests/integration/check-startup-splash.mjs` | `L169-184`: comprueba `backgroundColor` exacto del splash (`rgb(17, 22, 32)` en oscuro y `rgb(244, 246, 250)` en claro); `.mini-player`, `isPainted` en `[role=status]`, `Cerrar aviso` | **Medio (`U-THEME-01`):** actualizar `L183` a la nueva paleta (`rgb(0, 0, 0)` en oscuro por defecto y `rgb(250, 247, 248)` en modo claro `data-theme="light"` / `system` claro) y revalidar que `.mini-player { overflow: hidden }` y el backing móvil no afectan `isPainted` ni geometría. |
| `tests/integration/check-playlist-full-download-main.mjs` | `L619, 1230, 1280, 1399`: `Guardar álbum`; `L1313`: `Añadir álbum`; `L1062, 1253`: `Retirar álbum` (ahora en `⋯`); `L1192-1201`: `.album-track-badges`, `Copia sin comprobar`, `No descargada`; `L1303, 1344, 1366`: `Reproduciendo la canción desde la copia`; `L845-895`: `queue-v64-album-playback` | **Alto:** actualizar selectores de `Retirar álbum` (abrir `Opciones del álbum` `⋯` primero), sustituir aserciones sobre `.album-track-badges` por `data-track-state` / `Información`, adaptar espera de reproducción a `.mini-player__title` / `PlaybackIndicator` (o `role="status"` oculto) y mantener intactos todos los casos `V64-08`/`V64-09`. |
| `tests/integration/check-persistent-cache-main.mjs` | `L314` (`C03`): `.home-continue img`; `L23, 274`: `.collection-track-art img` | **Medio:** retirar la aserción de `L314` sobre `.home-continue img` (el bloque se elimina en `U-UX-08`; la portada ya se verifica en fila, reproductor, MediaSession, `.mini-player__cover img` y `dialog[open] .track-actions-art img`). |
| `tests/integration/check-review-ui.mjs` | `L179-180`: `Subir en cola`, `Bajar en cola` | **Compatible:** al conservar exactamente los `aria-label` `Subir en cola <título>` y `Bajar en cola <título>` en los botones de icono, pasa sin cambios. |
| `tests/integration/check-web-keyboard.mjs` | `L42-46`: `Subir en cola`, `Bajar en cola`, `Quitar de cola` | **Compatible:** ídem, conservando los `aria-label` exactos. |
| `tests/integration/check-web-layout.mjs` | Desbordamiento horizontal (`scrollWidth <= clientWidth + 1`) en `320/390/844 px` al `100 %` y `200 %` | **Gate obligatorio:** ejecutar para confirmar 0 desbordamiento horizontal con las nuevas filas, cola y backing móvil. |

### B. Otras suites del repositorio con dependencias detectadas

| Test | Selectores/textos afectados | Acción requerida |
|---|---|---|
| `tests/integration/playlist-detail-cases.mjs` | `L84`: `getComputedStyle(strong).color === getComputedStyle(.playback-indicator).color` dentro de `.collection-track-main` | **Actualizar:** comprobar que `.playback-indicator` está superpuesto dentro de `.collection-track-art` (con velo oscuro y barras visibles) y que `strong` tiene color acento. |
| `tests/integration/check-functional-shell.mjs` | `L81`: `.home-continue` | **Actualizar:** retirar comprobación de `.home-continue` y verificar accesos rápidos / «Tus álbumes» / `.mini-player`. |
| `tests/integration/helpersalbum-library/browser.mjs` y `artists.mjs` | `1 discos`, `pistas ·`, `Añadir álbum`, `Guardar álbum`, `Retirar álbum`, `Copia sin comprobar`, `No descargada`, `Sin descarga`, `En caché de escucha` | **Actualizar** a la cabecera unificada (`N canciones`, `⋯` → `Retirar álbum`) y `data-track-state` / menú `⋯`. |
| `tests/integration/check-album-early-selection.mjs`, `check-catalog-relay-browser.mjs`, `check-album-page-increment.mjs`, `check-album-backup.mjs` | `1 discos`, `pistas ·`, `Añadir álbum`, `.album-track-badges` | **Actualizar** textos a `N canciones` y nueva barra de acciones de álbum. |
| `tests/integration/check-collection-removal-current.mjs`, `check-collection-removal-final-main.mjs`, `check-collection-removal-main-native.mjs`, `check-spotify-import.mjs` | `Retirar álbum` (ahora en `⋯` en álbumes guardados), `Descargada · En Biblioteca`, `Sin descarga`, `.album-track-badges` | **Actualizar** flujo de apertura de `⋯` para `Retirar álbum` y comprobar estado vía `data-track-state` / *Información*. |
| `tests/integration/selected-song/browser.mjs`, `helpersalbum-library/singles.mjs` | `.selected-song-actions` | **Actualizar** al nuevo estado compacto inline + menú `⋯`. |
| `tests/integration/helpersbot-fallback-main/browser.mjs`, `helpersdeezer-recording-main/browser.mjs`, `check-playlist-resume-main.mjs` | `Añadir álbum`, `Copia sin comprobar` | **Actualizar** al botón de descarga de la nueva cabecera y `data-track-state`. |
| `tests/integration/check-queue-insertion-main.mjs` | `L79-80`: `Subir en cola`, `Quitar de cola` | **Compatible** conservando los `aria-label` exactos. |

---

## Matriz de trazabilidad (`U-THEME-01`, `U-UX-01…U-UX-08`, `U-SYNC-01`)

Niveles conforme a `doc/SPEC.md` §V.2: **U** (unitaria), **B** (navegador real Chromium y WebKit en loopback), **T** (Telegram / Cloudflare + Neon en vivo autorizado), **D** (iPhone físico del propietario).

| ID | Prueba (archivo y casos) | Nivel | Criterio de paso |
|---|---|---|---|
| **U-THEME-01** | `tests/integration/check-startup-splash.mjs` (`L169-184` actualizado), `tests/integration/check-functional-shell.mjs` (`L114` light/dark), + caso `ux-v65-theme-oled` en Chromium y WebKit (arranque sin preferencia → oscuro OLED `#000000`, cambio a `Clara` `#faf7f8` y vuelta a `Oscura`, verificación de contraste WCAG AA en texto/botones/acento y ausencia de azules heredados en Favoritos/letras/almacenamiento) | B / D | Arranque por defecto en `rgb(0, 0, 0)`; `--pulso-surface` `rgb(13, 11, 13)`; relleno acento `#8c1630` + `#ffffff` y texto acento `#d84a67` con contraste ≥4.5:1; modo claro manual `#faf7f8` operativo; `manifest.webmanifest` e `index.html` con `#000000`. |
| **U-UX-01** | `tests/unit/use-long-press.test.ts` (temporizador 450 ms, cancelación al mover `> 10 px`, supresión de `click`, cleanup); `tests/integration/check-playlist-full-download-main.mjs` (`queue-v64-album-playback` + nuevo caso `ux-v65-album-rows`) y `check-download-feedback.mjs` | U / B / D | Tocar pista en álbum solo reproduce sin tarjeta azul inline ni «Opciones de la canción»; progreso/error compacto inline desaparece al empezar a sonar; botón `⋯` (`≥ 44×44 px`) y long-press abren `TrackActionsMenu` con las 7 opciones; scroll durante toque cancela long-press; `V64-08` y `V64-09` en PASS. |
| **U-UX-02** | `tests/integration/playlist-detail-cases.mjs` + caso `ux-v65-playback-indicator` en Chromium y WebKit | B / D | En Álbum: `<PlaybackIndicator>` ocupa exactamente `.album-track-number` (el número se oculta), título en color acento, 0 indicadores en 3.ª línea. En Playlist/Biblioteca/Buscar: `<PlaybackIndicator>` superpuesto centrado dentro de `.collection-track-art` (`48×48`) con velo `rgba(0,0,0,.45)`, sin invadir el texto. En pausa: 0 indicadores. Con `prefers-reduced-motion: reduce`: `animationName === 'none'`. |
| **U-UX-03** | `tests/integration/playlist-detail-cases.mjs` + caso `ux-v65-album-rows` en Chromium y WebKit | B / D | Filas de 2 líneas sin texto `Descargada · En Biblioteca`; icono discreto de descarga visible en descargadas; pistas no descargadas con `opacity < 0.8`; botón `⋯` `≥ 44×44 px`; long-press en Playlist abre `TrackActionsMenu` y se cancela al hacer scroll. |
| **U-UX-04** | `tests/unit/album-header-meta.test.ts` (pluralización 1 canción, N canciones, 1 disco omitido, 2 discos, descargadas) + caso `ux-v65-album-header` en Chromium y WebKit | U / B / D | Cero ocurrencias de `1 discos`; 1 disco muestra `N canciones [· K descargadas]`; portada centrada en `390×844`; barra única con **▶**, **⇄**, **↓** y **`⋯`** (`Retirar álbum` y `Fuente de los metadatos` dentro de `⋯`). |
| **U-UX-05** | Caso `ux-v65-miniplayer-seal` en Chromium y WebKit (`390×844` móvil y `1280×800` escritorio, claro y oscuro) | B / D | En móvil con lista desplazada bajo `.mini-player`, el punto medio del hueco entre `.mini-player` y `.shell-nav` está cubierto por el backing opaco (ningún texto de lista visible a través del hueco); `.mini-player` tiene `overflow: hidden`; `.mini-player__mobile-progress` contenida dentro del rectángulo de `.mini-player` sin sobresalir; escritorio sin cambios. |
| **U-UX-06** | `tests/integration/check-download-feedback.mjs` + caso `ux-v65-search-rows` en Chromium y WebKit | B / D | Tocar resultado en Buscar muestra progreso compacto inline y desaparece al empezar a sonar; botón `⋯` (`≥ 44×44 px`) y long-press abren `TrackActionsMenu` para añadir a Biblioteca/playlist; `album`/`artist` conservan chevron `›`. |
| **U-UX-07** | `tests/integration/check-review-ui.mjs`, `check-web-keyboard.mjs`, `check-web-layout.mjs` (`320 px` y `390 px`, `100 %` y `200 %`) | B / D | Filas de cola sin cajas con borde ni textos `Subir`/`Bajar`/`Quitar` bajo el título; 3 botones de icono `≥ 44×44 px` a la derecha con `aria-label` intactos; teclado `Enter`/`Space` reordena y quita; 0 desbordamiento horizontal al `200 %`. |
| **U-UX-08** | `tests/integration/check-startup-splash.mjs` (`H01`/`H02`), `check-persistent-cache-main.mjs`, `check-functional-shell.mjs` + caso `ux-v65-home-albums` | B / D | Cero ocurrencias de «Continuar escuchando» y `.home-continue`; sección «Tus álbumes» visible cuando existen álbumes guardados y abre el álbum al pulsar; `.home-empty` visible cuando biblioteca y álbumes están vacíos. |
| **U-SYNC-01** | `tests/server/` (unitarias/Miniflare de `v65-neon-sync`) + prueba integrada de 2 contextos aislados (Dispositivo A crea/modifica playlist → sync → Dispositivo B limpio inicia sesión → playlist visible en Biblioteca e Inicio) + verificación en vivo en Cloudflare/Neon | U / B / T | `PUT /api/account-library` y `GET /api/account-library` devuelven HTTP `200`; Dispositivo B limpio muestra la playlist y sus entradas intactas en Biblioteca e Inicio sin errores ni pérdida de datos. |

---

## Plan de implementación en incrementos ordenados para Codex (`gpt-6.1-terra` medio)

Ejecutar con validación proporcional (`doc/SPEC.md` §V.2) tras cada incremento y una sola batería completa final antes de publicar:

### Incremento 1 · Paleta OLED + vino oscuro y primitivas compartidas (`U-THEME-01`, `U-UX-02`, base de `U-UX-01`/`U-UX-03`)
- Migrar `src/ui/design-tokens.css`, `src/style.css`, `index.html`, `public/manifest.webmanifest` y el estado inicial `theme = 'dark'` en `src/main.tsx` a la paleta negro puro OLED (`#000000`) + rojo vino oscuro (`#8c1630` / `#d84a67`), actualizando Favoritos, `--np-card` y gráfico de almacenamiento.
- Crear `src/ui/useLongPress.ts` + unitaria `tests/unit/use-long-press.test.ts`.
- Añadir apertura programática (`openSignal` o `ref`) a `src/ui/TrackActionsMenu.tsx`.
- Actualizar `src/ui/PlaybackIndicator.tsx` y `src/ui/playback-indicator.css` con variantes `inline` (usando `--pulso-accent-text`) / `overlay` y `prefers-reduced-motion: reduce`.
- En `src/main.tsx` y `src/ui/collection-detail.css`: mover `<PlaybackIndicator variant="overlay" />` sobre `.collection-track-art`, retirar posicionamiento flotante sobre texto (`L94-95`), añadir icono discreto de descarga + atenuación no descargadas + `useLongPress` en filas de Playlists/Biblioteca.
- Validación focal: `npm run typecheck && npm run lint && npm run test:unit` + `check-startup-splash.mjs`, `playlist-detail-cases`, `check-artwork-rows-dock.mjs`.

### Incremento 2 · Cabecera de Álbum, filas compactas y eliminación de tarjeta azul inline (`U-UX-01`, `U-UX-03`, `U-UX-04`)
- Ampliar acciones de pista (`src/library/selected-song.ts`, `src/main.tsx`, `src/ui/TelegramPanel.tsx`, `src/ui/MusicSearchController.tsx`) para exponer las 7 acciones en `TrackActionsMenu` de álbum.
- Refactorizar `src/ui/AlbumPageController.tsx`, `src/ui/album-page.css`, `src/ui/app-polish.css`:
  - Cabecera unificada (portada centrada móvil, pluralización limpia sin `1 discos`, barra **▶ / ⇄ / ↓ / `⋯`** con *Retirar álbum* y *Fuente de los metadatos* dentro de `⋯`).
  - Filas de 2 líneas con `PlaybackIndicator` sustituyendo al número, icono discreto de descarga, `opacity: .65` en no descargadas, `⋯` + `useLongPress`, sin `.album-track-badges`.
- Simplificar `src/ui/SelectedSongActions.tsx` y `src/ui/selected-song-actions.css` a estado compacto inline solo para `pending` o `error` (oculto en `phase === 'done'` sin error).
- Validación focal: unitaria de metadatos de cabecera + `check-playlist-full-download-main.mjs` (modos de álbum y `queue-v64-album-playback`) + `check-download-feedback.mjs`.

### Incremento 3 · Búsqueda limpia (`U-UX-06`)
- Actualizar `src/ui/MusicSearchPanel.tsx`, `src/ui/MusicSearchController.tsx` y `src/ui/music-search.css`:
  - Progreso/error compacto inline bajo la fila `track` que desaparece al empezar a sonar.
  - Botón `⋯` (`TrackActionsMenu`) + `useLongPress` en resultados `track`.
  - `<PlaybackIndicator variant="overlay" />` sobre `.catalog-art` en pistas activas.
- Validación focal: `check-download-feedback.mjs` + casos de búsqueda en `check-playlist-full-download-main.mjs`.

### Incremento 4 · Sellado inferior del MiniPlayer móvil, Cola compacta e Inicio (`U-UX-05`, `U-UX-07`, `U-UX-08`)
- `src/ui/responsive-shell.css`, `src/ui/mini-player.css`, `src/ui/design-fidelity.css`: backing/degradado opaco móvil bajo `.mini-player` + `.shell-nav`, `overflow: hidden` en `.mini-player` móvil y `.mini-player__mobile-progress` a ancho completo inferior.
- `src/main.tsx` (`playerQueue`), `src/ui/NowPlayingView.tsx`, `src/ui/now-playing.css`, `src/ui/app-polish.css`: filas compactas de cola con iconos `↑`, `↓`, `×` (`≥ 44×44 px`) conservando `aria-label`.
- `src/ui/HomeView.tsx`, `src/main.tsx`, `src/ui/responsive-shell.css`, `src/ui/app-polish.css`: retirar «Continuar escuchando» (`.home-continue`), añadir «Tus álbumes» y conservar `.home-empty`.
- Validación focal: `check-review-ui.mjs`, `check-web-keyboard.mjs`, `check-web-layout.mjs`, `check-startup-splash.mjs`, `check-player-notice.mjs`, `check-persistent-cache-main.mjs`.

### Incremento 5 · Integración con `v65-neon-sync` (`U-SYNC-01`) y batería completa previa a publicación
- Integrar el arreglo de sincronización de `v65-neon-sync` y ejecutar la prueba de 2 dispositivos aislados (`U-SYNC-01`).
- Actualizar las suites de integración auditadas (sección §Auditoría) y ejecutar una sola vez la batería completa:
  - `npm run check` (`typecheck`, `lint`, `test:unit`, `test:cloudflare`, `test:py`), `npm run typecheck:tests`, `npm run build`.
  - Matrices de navegador en **Chromium y WebKit**.
- Revisión independiente (`gemini-4-neon` medio) antes de publicar en Cloudflare Workers (`v65`) y verificar en vivo. Las 16 pruebas físicas en iPhone (`docs/IPHONE-ACEPTACION.md`) permanecen **NO EJECUTADAS** hasta ejecución del propietario.

---

## Evidencia de validación previa a publicación (`release/v65`, commit `a4de1ae`)

### 1. Implementación y correcciones cerradas
- **Sincronización Neon entre dispositivos (`b7cbeef`, `U-SYNC-01`):**
  - Diagnóstico sobre Neon: 2 filas en `public.pulso_account_library` (`1 playlist / 10 pistas` y `2 playlists / 103 pistas`), 5 usuarios / 5 correos únicos (`duplicateEmailUsers: false`), RLS `SELECT/INSERT/UPDATE` operativo.
  - 3 fallos corregidos: `preparedLibraryAccount === activeAccount` en `librarySync.ready()` (elimina carrera en dispositivo nuevo); `applyAccountLibrary` devuelve `{changed, needsSync}` para encolar cambios concurrentes durante una sincronización; `librarySync.retry()` limpia `retryAt` en `conflict`/`unavailable` sin saltarse `rateLimited` (`429`).
- **Paleta OLED negro puro + rojo vino oscuro (`2342d6f`, `a4de1ae`, `U-THEME-01`):** modo oscuro por defecto (`#000000`, `#0d0b0d`, `#8c1630` rellenos, `#d84a67` texto/iconos/progreso con contraste WCAG AA), modo claro manual `#faf7f8`, `index.html` y `manifest.webmanifest` en `#000000`, Favoritos/letras/almacenamiento armonizados.
- **UX/UI estilo Apple Music (`2342d6f`, `b6e1024`, `07abea9`, `128ae7c`, `7f14983`, `a4de1ae`, `U-UX-01`–`U-UX-08`):**
  - `useLongPress` + apertura programática de `TrackActionsMenu` + `TrackMenuHost` admitido con `viewAct()` / `canOrganize` / `canAppend`.
  - `PlaybackIndicator` `inline` (sustituyendo número de pista en Álbumes) y `overlay` (centrado sobre carátula `48×48` en Playlists y Búsqueda), respetando pausa y `prefers-reduced-motion`.
  - Cabecera de álbum unificada (`formatAlbumHeaderMeta` sin `1 discos`, **▶ / ⇄ / ↓ / `⋯`** con *Retirar álbum* y *Fuente de los metadatos* en `⋯`), filas compactas de 2 líneas sin tarjeta azul inline.
  - Búsqueda limpia con `⋯` y long-press en resultados `track`; sellado inferior opaco móvil (`::after`) + `overflow: hidden` + progreso limpio en `.mini-player`; cola compacta con iconos SVG (`↑`, `↓`, `×`) conservando `aria-label` a `320 px` 200 %; Inicio sin «Continuar escuchando» y con «Tus álbumes».

### 2. Batería completa (local + navegadores Chromium y WebKit)
- **Batería completa en `2352881`:**
  - Estáticas (`typecheck`, `typecheck:tests`, `lint`, `build`): **PASS**.
  - Unitarias: **1063/1063 PASS** · Cloudflare/Miniflare: **74/74 PASS** · Servidor Python: **10/10 PASS**.
  - Navegadores (**Chromium / WebKit**): `check-ux-v65.mjs` **8/8 / 8/8** · `check-account-library-main.mjs` **5/5 / 5/5** · `check-artwork-rows-dock.mjs` **6/6 / 6/6** · `check-player-notice.mjs` **5/5 / 5/5** · `check-download-feedback.mjs` **8/8 / 8/8** · `check-startup-splash.mjs` **10/10 / 10/10** · `check-persistent-cache-main.mjs` **13/13 / 13/13** · `check-playlist-resume-main.mjs` **46/46 / 46/46** · `check-playlist-full-download-main.mjs` **62/62 / 62/62** (incl. `V64-08`, `V64-09`, `queue-v64-album-playback`) · `playlist-detail-cases` **10/10 / 10/10** · T27 `check-local-playback.mjs` integridad **14/14 / 14/14** y playlist **2/2 / 2/2**.
- **Revalidación tras los arreglos de revisión en `a4de1ae`:** `typecheck`, `typecheck:tests`, `lint`, `build`, **1063/1063** unitarias, UX **8/8 × 2**, inicio **10/10 × 2**, álbum **32**, feedback **8/8 × 2** — todo **PASS**.

### 3. Revisión independiente (`gemini-4-neon` medio)
- Primera revisión (`release/v64..2352881`): 1 hallazgo Alto (`trackMenuHost` usando `actWork` en vez de `viewAct`), 1 Medio (`error-bubble.css:40` contraste `:focus-visible`) y 4 Bajos → todos corregidos en `a4de1ae`.
- Revisión delta (`2352881..a4de1ae`): **0 Bloqueantes, 0 Altos, 0 Medios, 0 Bajos** → veredicto explícito **`Seguro publicar v65`**.

### 4. Publicación y verificación en vivo en Cloudflare Workers (`v65`)
- **Publicación (`86458bb` / código `a4de1ae`):** entrada `/releases/5a7eef31d22eabf1.html` (canónica `/releases/5a7eef31d22eabf1` HTTP `200`, redirección estándar `307` de Cloudflare Static Assets), despliegue `18c58796-f9f8-4e53-8572-9148055fec89`, versión `ebf4cb24-c183-4ea0-a27a-ac789f32f0d6` (**versionNumber 68**, 100 %).
- **Integridad del despliegue:** Worker `330.980` bytes (SHA-256 `841456dfb8b09ef6970d9375a70e7c420cfa13fe6a6e13a91fc6490f06978152`), manifiesto `86.546` bytes (SHA-256 `f0390526b616da6b44397a1a053ea364eb91ab153b2417bef5f1fd1ff87adf41`), Service Worker `54.921` bytes (`f28e6b68956769938b4fca17a529c0427901961ed797ed6fe3e9716a54adb3b8`), **346** rutas estáticas, **236** entradas históricas HTTPS conservadas, **13** bindings, **14** reglas `run_worker_first`, `observability` desactivado, sin `X-Pulso-Diag`, Turnstile CSP + `siteKey` conformes, `/api/account-profile` y `/api/account-library` anónimos `401`. Recibos en `.local/test-evidence/publish-v65/`.
- **Verificación en vivo con perfil autorizado (Chromium móvil `390×844`, sin borrar datos ni cerrar sesiones; `.local/test-evidence/publish-v65/live-verification.json`):**
  - `U-THEME-01` PASS: fondo OLED `#000000` (`rgb(0, 0, 0)`), `--pulso-accent: #8c1630`, `--pulso-accent-text: #d84a67`.
  - `U-SYNC-01` PASS: `GET /api/account-library` HTTP `200` (antes y después de pulsar «Sincronizar biblioteca»), 0 errores, estado sincronizado.
  - `U-UX-08` PASS: Inicio sin «Continuar escuchando» (`.home-continue: 0`), con «Tus álbumes» y «Tus playlists» visibles.
  - `U-UX-01`–`U-UX-05` PASS: álbum guardado con `0` ocurrencias de `1 discos`, cabecera con ▶ / ⇄ / `⋯`, reproducción de pista descargada con `<PlaybackIndicator>` en el número de pista y `0` tarjetas `.selected-song-actions`, menú `⋯` abre y cierra limpio, `.mini-player` móvil con `overflow: hidden`, barra de progreso contenida y backing `::after` activo (`position: fixed`, `zIndex: 18`); reproducción pausada y Chromium cerrado.

### 5. Pendientes abiertos
- Confirmación del propietario en un segundo dispositivo físico con la misma cuenta tras recargar **v65** (para validar en dispositivo real que las playlists ya aparecen sin bloqueos de arranque/reintento).
- Aceptación física en iPhone (`docs/IPHONE-ACEPTACION.md`, 16 pruebas): **NO EJECUTADA** (exclusiva del propietario).
