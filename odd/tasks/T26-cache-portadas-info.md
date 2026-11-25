# T26 · Caché permanente y acotada de portadas e información de catálogo

- **Método:** ODD (`doc/SPEC.md` §C.5 y §V.2)
- **Estado:** Incremento 1 implementado sobre `f803135`. Verificaciones y pendientes al final.
- **Fecha:** 2026-11-25
- **Línea base:** v62 publicada (`f97ebb5`, rama `perf/t25-inc1`). Ramas abiertas sobre v62: `perf/t25-m1` (`f9515ed`) y `fix/startup-splash-notice` (`f803135`).
- **Requisitos SPEC vinculados:** W04, W05, W06, W07, W08, W10, W11, W17, W18 · **Invariantes SPEC:** V2, V6, V7, V8, V9, V10, V11, V17, V21, V22, V23, V24, V27, V28, V29, V30, V31
- **Documento técnico acompañante (fuera de Git):**
  - Inventario completo de portadas/info, diseño detallado con alternativas descartadas, encaje con ramas y medición aparte de reproducción de canciones descargadas: [diseno-inventario-y-medicion.md](file:///data/home/Proyectos/Pulso-Web/.local/research/cache-odd/diseno-inventario-y-medicion.md)

---

## Propósito

Dotar a Pulso Web de una **caché local persistente, acotada y separada de la Biblioteca** para:
1. **Miniaturas de portadas** (catálogo iTunes, Cover Art Archive/MusicBrainz, Spotify enriquecido y portadas resueltas por el reproductor).
2. **Información textual de canciones, álbumes, artistas y búsquedas** (resultados de búsqueda LRCLIB/iTunes/MusicBrainz, fichas de álbum, discografías de artista y enlaces pista→portada).

Objetivos observables para el usuario:
- **Apertura y navegación instantáneas:** al abrir la app, Biblioteca, Inicio o una playlist, las portadas y datos ya consultados aparecen de inmediato desde almacenamiento local.
- **Menor consumo de datos móviles:** evitar re-descargar portadas y búsquedas idénticas cada vez que se cierra y reabre la app.
- **Funcionamiento sin conexión:** en modo avión o sin red, las portadas y fichas ya cacheadas siguen visibles sin emitir ninguna petición de red (complementando las canciones ya descargadas, que ya suenan sin conexión).

---

## Cambio de criterio sobre T7 (decisión expresa del propietario)

- **Regla previa (`odd/tasks/T7-portadas-metadata.md:103,133,141,238`):** las imágenes externas y metadatos de catálogo/proveedor debían mantenerse exclusivamente en RAM temporal (*«sin imagen comercial almacenada»*, *«El fallback no escribe imágenes externas ni URLs en IndexedDB u OPFS»*).
- **Decisión del propietario (2026-11-25):** el propietario autoriza expresamente **guardar en el teléfono una caché permanente y acotada** de miniaturas de portadas e información textual de canciones, álbumes y búsquedas, sustituyendo el criterio de solo-RAM de T7 para habilitar arranque rápido, ahorro de datos móviles y portadas disponibles sin internet.
- **Qué permanece intacto de T7:**
  1. La caché persistente **no escribe** en `pulso-web-local-v1` (`artwork:v1:*`, `tracks`, `assets`, `chunks`, `playlists`), ni en OPFS (`pulso-assets-v1`), ni en backups exportados, ni en la sincronización de cuenta (`account-library`), ni en Cloudflare/Git/fixtures.
  2. Toda imagen externa sigue tratándose como **contenido no confiable**: validación obligatoria de firma binaria, estructura, dimensiones y `createImageBitmap` (`src/imports/artwork.ts:56-68`) antes de persistir; prohibidos SVG/HTML y `<img src="https://...">` directos.
  3. Las imágenes cacheadas permanecen estrictamente para uso personal en el dispositivo del usuario (sin redistribución ni almacenamiento en servidor).

---

## Alcance autorizado

1. **Almacén persistente dedicado y aislado (`pulso-web-cache-v1` en IndexedDB):**
   - Base independiente de `pulso-web-local-v1` (cero migración del esquema de Biblioteca, cero bloqueo de `WRITER_LOCK`, cero riesgo de `versionchange` sobre audio/SW).
   - Stores: `artwork` (miniaturas ≤ 300×300 px en `ArrayBuffer` + metadatos de LRU/SHA-256), `catalog` (fichas JSON ya validadas y enlaces pista→portada) y `meta` (estadísticas agregadas por cuenta).
   - Aislamiento estricto por `accountId` en todas las claves e índices, con purga inmediata de RAM y limpieza de la cuenta saliente al cerrar sesión o cambiar de cuenta.
2. **Límites, normalización y desalojo LRU con marca baja:**
   - Portadas: tope **30 MiB** (31.457.280 B) y **800 entradas**; marca baja **24 MiB / 640 entradas**; miniatura normalizada a **≤ 300×300 px** y **≤ 256 KiB** por entrada persistida.
   - Información textual: tope **5 MiB** (5.242.880 B) y **500 entradas**; marca baja **4 MiB / 400 entradas**; **≤ 128 KiB** por entrada JSON.
   - Degradación *fail-open* ante `QuotaExceededError` o indisponibilidad de IDB: jamás bloquea audio, descargas ni Biblioteca.
3. **Integración unificada de portadas (L1 RAM + L2 IDB) y prioridad estricta:**
   - Orden inmutable: **manual/local (`artwork:v1:*`) > catálogo (`catalogCovers`/`artworkUrl`) > proveedor (`PlayerArtworkProvider`)**. La ocultación manual (`manual: true, state: 'absent'`) siempre gana.
   - Enlace persistente `(accountId, sharedArtworkKey)` → portada validada para que las carátulas obtenidas por `PlayerArtworkProvider` persistan al reabrir y se muestren en filas, minirreproductor, reproductor, MediaSession, menú de acciones, Inicio y `CollectionCover`.
   - Precarga por lote en una sola transacción `readonly` de IDB al abrir Biblioteca/playlist y carga diferida de red acotada solo para filas visibles (`IntersectionObserver`), sin disparar consultas al proveedor por fila.
4. **Caché persistente de información de catálogo y búsqueda:**
   - Unificar las tres instancias aisladas de `AlbumCatalog` (`MusicSearchController.tsx:33`, `AlbumPageController.tsx:25`, `ArtistCatalogView.tsx:6`) y compartir la caché L1/L2 + *singleflight* para búsquedas (LRCLIB, iTunes album/artist/song, MusicBrainz), detalles de álbum (`AlbumDetail`) y discografías de artista (`artistAlbums`).
   - Políticas TTL + *stale-while-revalidate* (SWR) con conexión, bypass explícito en «Actualizar sugerencias» y modo 100 % offline con cero red.
5. **Optimización de transporte HTTP y del relay (USD 0):**
   - Sustituir `Cache-Control: no-store` por cabeceras de caché privada acotadas en respuestas HTTP 200 de `/catalog/artwork`, `/catalog/musicbrainz/artwork`, `/catalog/itunes/*`, `/catalog/musicbrainz/*` y `/catalog-config.json` en `deployment/cloudflare/worker.mjs`, y `cache: 'default'` en el cliente.
   - Eliminar el doble reloj de 3,1 s (`album-catalog.ts:241` + `catalog-fetch.ts:28`) dejando un único espaciador global estricto de 3.100 ms con cola de prioridad (`high` visible vs `low` precarga/SWR) y alinear concurrencia de imágenes entre cliente y `relay.mjs:32`.
6. **Ajustes → Almacenamiento:**
   - Mostrar tamaño ocupado por la caché de portadas e información en MB (`formatStorageMB`), separado de «Descargas conservadas» y «Caché de escucha».
   - Añadir botón **«Limpiar caché de portadas»** (borra únicamente `pulso-web-cache-v1` de la cuenta activa y la caché L1 RAM). Cero botones nuevos en filas de canciones.

## Fuera de alcance

- **Modificación del almacenamiento o reproducción de audio** (`pulso-web-local-v1`, OPFS `pulso-assets-v1`, Service Worker `/_pulso/media/*`, T24 `Q01–Q19`, T25 `S01–S12`). La mejora de latencia al tocar canciones ya descargadas (medida aparte en el punto 6) queda recomendada como **incremento propio separado** para no mezclar riesgos.
- **Caché persistente de letras externas** (mantener `player-lyrics-provider.ts` en RAM salvo decisión aparte bajo D08).
- **Caché en el borde de Cloudflare (`caches.default`)** o compra de dominio personalizado: verificado en documentación oficial que `caches.default` no tiene efecto en `*.workers.dev`, y el presupuesto es estrictamente **USD 0**.
- **Cambios en la cola de descargas, bots de Telegram, `perf/t25-m1` o splash de `fix/startup-splash-notice`.**
- **Sincronización en la nube** de la caché de portadas/búsquedas hacia Neon/Cloudflare (es 100 % local al dispositivo).
- **Aceptación física en iPhone (`D`) y publicación automática en Cloudflare:** requieren sus verificaciones y pasos aplicables posteriores a la implementación.

---

## Métricas objetivo y línea base medida en v62 (`f97ebb5`)

### Condiciones de medición de línea base (2026-11-25)

Medida real en local sobre bundle de producción compilado de `f97ebb5` (`vite build` + `sw.js` real, perfil persistente Playwright en loopback HTTP, viewport móvil `390×844`, `latencyMs = 120 ms` por petición HTTP al simulador de catálogo/relay, playlist de 30 canciones con `catalogRelease.artworkUrl`, 200×200 PNG sintético de 1.869 B de media; motores **Chromium 154** y **WebKit 27.2**). Los artefactos temporales en `.local/tmp/cache-design/` se eliminaron tras recoger los resultados.

> **Nota sobre bytes reales:** las portadas reales servidas hoy por Apple CDN en `600×600bb` pesan ~35–90 KiB cada una (30 portadas ≈ **1,2–2,5 MB** por reapertura en v62); el arnés usa PNG sintéticos reproducibles de ~1,87 KiB (56,1 KiB para 30 portadas), por lo que la métrica primaria de ahorro de tráfico se expresa tanto en **número de peticiones HTTP** como en **% de bytes ahorrados al reabrir**.

| ID | Métrica | Línea base v62 (`f97ebb5`) — Chromium / WebKit | Objetivo T26 | Cómo medirla |
|---|---|---|---|---|
| **M-C1** | **Tiempo hasta ver todas las portadas visibles al abrir playlist de 30 canciones (con red, tras reabrir la app)** | **1.468 ms** (Chromium) / **1.517 ms** (WebKit) *(1ª apertura fría: 2.046 / 2.370 ms)* | **≤ 200 ms** en reapertura online (**reducción ≥ 85 %**); primera apertura fría de solo filas visibles ≤ 600 ms | Arnés `check-persistent-cache-main.mjs`: abrir nueva página en perfil persistente, entrar en Biblioteca → playlist 30 pistas y medir `performance.now()` hasta `img.complete && naturalWidth > 0` en todas las filas del viewport. |
| **M-C2** | **Portadas visibles al abrir playlist de 30 canciones SIN red (`navigator.onLine = false`, tras reapertura)** | **0 / 30** (0 %) en ambos motores (todo `♪`) | **100 %** de las portadas cacheadas visibles en **≤ 200 ms**, con **0 peticiones de red** | Mismo arnés tras recargar en modo offline (`navigator.onLine = false` + aborto de red): contar `img` decodificadas con píxeles válidos vía Canvas y verificar `requests === 0`. |
| **M-C3** | **Peticiones HTTP de catálogo/portadas al reabrir la app y abrir la playlist de 30 canciones** | **31 peticiones** (1 `/catalog-config.json` + **30** `/catalog/artwork`) en ambos motores | **0 peticiones** de portadas frescas (≤ 1 `/catalog-config.json` si expiró HTTP `max-age`; **0** `/catalog/artwork`) | Contador de peticiones en middleware loopback durante la sesión 2 (nueva página tras cierre de la sesión 1). |
| **M-C4** | **Bytes descargados de portadas al reabrir la app (playlist de 30 canciones)** | **100 % re-descargado** (56.126 B sintéticos; ~1,2–2,5 MB en portadas reales 600×600) | **0 bytes** en reapertura dentro de TTL fresco (**ahorro 100 %**); en 1ª descarga fría de 300×300, ahorro ≥ **50 %** frente a 600×600 | Suma exacta de `Content-Length` / bytes enviados por el servidor loopback en sesión 2. |
| **M-C5** | **Tiempo hasta ver resultados de una búsqueda repetida tras reabrir la app** | **3.771 ms** (Chromium) / **3.774 ms** (WebKit) y **8–9 peticiones HTTP** *(idéntico a 1ª búsqueda: 3.707 / 3.820 ms)* | **≤ 600 ms** (debounce UI 450 ms + lectura IDB < 50 ms) y **0 peticiones HTTP** dentro de TTL fresco (**reducción ≥ 80 %**) | Escribir «Nsqk» en Buscar tras reapertura en perfil persistente y medir hasta ≥ 6 resultados renderizados con portadas decodificadas y conteo HTTP = 0. |
| **M-C6** | **Apertura repetida de ficha de álbum o artista tras reabrir la app** | Requiere 1–2 consultas de red (≥ 120–3.220 ms) y falla sin red | **≤ 150 ms**, **0 peticiones HTTP** dentro de TTL fresco, y **disponible offline** | Navegar a Álbum y Artista previamente abiertos tras reapertura (online y offline). |

---

## Requisitos funcionales (`C01…C12`)

| ID | Requisito | Criterio de aceptación verificable |
|---|---|---|
| **C01** | **Almacén persistente separado `pulso-web-cache-v1`** | La caché de portadas e información reside en una base IndexedDB propia (`pulso-web-cache-v1`) con stores `artwork`, `catalog` y `meta`. Ninguna escritura de caché abre `pulso-web-local-v1`, adquiere `WRITER_LOCK` ni toca `pulso-assets-v1` (OPFS) ni `pulso-shell-*` (Cache API). Los blobs se almacenan como `ArrayBuffer` validados (`mime`, `width`, `height`, `byteLength`, `sha256`), compatibles con contextos persistentes de Chromium y WebKit/Safari. |
| **C02** | **Normalización de miniaturas y límites acotados con LRU + marca baja** | Toda portada persistida se valida con `validateArtwork` y se normaliza a **≤ 300×300 px** y **≤ 256 KiB** (solicitando `/300x300bb` en Apple CDN cuando proceda o redimensionando en cliente antes de persistir). `artwork` respeta **≤ 30 MiB y ≤ 800 entradas** (desalojo LRU por `lastAccessedAt` hasta marca baja **24 MiB / 640 entradas**). `catalog` respeta **≤ 5 MiB y ≤ 500 entradas** (marca baja **4 MiB / 400 entradas**, entrada ≤ 128 KiB). Ante `QuotaExceededError`, intenta liberar el 50 % más antiguo de caché o degrada sin error visible ni bloqueo de audio/Biblioteca. |
| **C03** | **Persistencia de portadas entre reaperturas (catálogo y proveedor)** | Las portadas obtenidas tanto por URL de catálogo (`catalogArtwork`) como por el proveedor del reproductor (`PlayerArtworkProvider`, mediante enlace `(accountId, sharedArtworkKey) → artworkKey`) sobreviven al cierre y reapertura de la app y se decodifican en filas de lista, minirreproductor, reproductor, MediaSession, menú de acciones, Inicio y `CollectionCover` con **0 peticiones HTTP** dentro del TTL fresco. |
| **C04** | **Prioridad estricta y respeto a decisiones manuales/locales** | En todas las vistas rige: **manual/local (`artwork:v1:*`) > catálogo > proveedor**. Una carátula manual o local válida prevalece sobre cualquier entrada de `pulso-web-cache-v1`; una ocultación manual (`manual: true, state: 'absent'`) impide mostrar portadas de caché persistente o pedir red; tras cada operación asíncrona/red se recomprueba el estado local antes de publicar. |
| **C05** | **Operación sin conexión (offline) con cero red** | Con `navigator.onLine === false`, todas las portadas y fichas presentes en `pulso-web-cache-v1` (incluso vencidas respecto a su TTL fresco) se sirven al instante y **no se emite ninguna petición HTTP** a `/catalog-config.json`, `/catalog/*`, `itunes.apple.com`, `mzstatic.com` ni `lrclib.net`. Lo no cacheado muestra su placeholder habitual sin errores de consola ni bloqueos. |
| **C06** | **Aislamiento por cuenta y limpieza al cerrar sesión o cambiar de cuenta** | Todas las claves en `pulso-web-cache-v1` están prefijadas por `accountId` y consultadas por índice/rango de cuenta. La cuenta B nunca lee portadas ni búsquedas cacheadas por la cuenta A. Al cambiar de cuenta (`A → B`) o cerrar sesión explícitamente (`signOut`), se vacía la caché L1 RAM, se revocan los object URLs y se borran todas las entradas de la cuenta saliente en `pulso-web-cache-v1` sin afectar a `pulso-web-local-v1`. |
| **C07** | **Invalidación temporal y *stale-while-revalidate* (SWR)** | Portadas: frescas **30 días**, *stale* revalidables en segundo plano **30–90 días**, expiración online > 90 días (offline siempre servibles si existen). Búsquedas: frescas **24 h**, SWR **1–7 días**. Álbumes/artistas: frescos **7 días**, SWR **7–30 días**. Con conexión, una entrada *stale* se pinta de inmediato y lanza revalidación acotada en segundo plano (sin parpadeo ni bloqueo; si falla la red se conserva el valor anterior). Pulsar «Actualizar sugerencias» omite la caché de búsqueda cuando hay red. |
| **C08** | **Caché persistente de búsquedas, fichas de álbum y artista, y compartición entre vistas** | `MusicSearchController`, `AlbumPageController` y `ArtistCatalogView` comparten un único almacén L1/L2 y deduplicación *singleflight* (sin 3 instancias desconectadas de `AlbumCatalog`). Repetir una búsqueda o reabrir un álbum/artista tras reiniciar la app entrega los resultados desde caché en **≤ 600 ms / ≤ 150 ms** con **0 peticiones HTTP**. Si cambia la identidad de una pista (`sharedArtworkKey`), el enlace antiguo deja de aplicarse automáticamente. |
| **C09** | **Precarga no bloqueante de Biblioteca/playlist y carga diferida de red** | Al abrir Biblioteca o una playlist, las portadas cacheadas de las filas/tarjetas visibles se hidratan en lote (una transacción `readonly` de IDB) antes de pintar o en el primer frame, sin bloquear scroll ni reproducción. Solo las filas visibles (`IntersectionObserver`) que falten en caché lanzan peticiones de red, acotadas en concurrencia y sin invocar `PlayerArtworkProvider` por fila. |
| **C10** | **Cabeceras HTTP de caché en Worker y cliente sin depender de borde `workers.dev`** | En `deployment/cloudflare/worker.mjs`, las respuestas HTTP 200 de `/catalog/artwork` y `/catalog/musicbrainz/artwork` devuelven `Cache-Control: private, max-age=604800, immutable`; las de `/catalog/itunes/*` y `/catalog/musicbrainz/{search,artists,artist-albums,release}` devuelven `Cache-Control: private, max-age=3600, stale-while-revalidate=86400`; `/catalog-config.json` devuelve `Cache-Control: private, max-age=300`. Errores (`!= 200`), `/api/account-*`, `/telegram-config.json` y HTML conservan `no-store`. El cliente usa `cache: 'default'` (y `cache: 'reload'` solo en reintento manual). No se usa `caches.default` del borde en `workers.dev`. |
| **C11** | **Mitigación de la espera de 3,1 s sin violar cuotas externas** | Se elimina el doble temporizador redundante de 3,1 s entre `album-catalog.ts:241` y `catalog-fetch.ts:28`, dejando un único espaciador de **≥ 3.100 ms** para metadatos iTunes y **≥ 1.100 ms** para MusicBrainz, con cola de prioridad (`high` para interacción visible, `low` para SWR/precarga) y deduplicación *singleflight*. La concurrencia cliente de `/catalog/artwork` en modo relay se alinea con `relay.mjs` (sin provocar 429 espurios al abrir una playlist nueva). |
| **C12** | **Ajustes → Almacenamiento: visibilidad y botón «Limpiar caché de portadas»** | `StorageSettings` muestra una línea dedicada **«Caché de portadas e información»** con su tamaño exacto en MB (`formatStorageMB`), separada de descargas conservadas y caché de escucha, y un botón **«Limpiar caché de portadas»** que vacía únicamente `pulso-web-cache-v1` de la cuenta activa y la RAM L1, actualiza el contador a `0,00 MB`, no detiene audio ni toca copias/Biblioteca, y no añade botones en las filas de canciones. |

---

## Invariantes (`K01…K08`)

| ID | Invariante | Regla que nunca puede romperse |
|---|---|---|
| **K01** | **La carátula manual y local siempre gana** | Ninguna lectura de caché persistente, revalidación SWR ni respuesta tardía de red puede sobrescribir una carátula manual, una ocultación manual (`manual: true, state: 'absent'`) ni una portada local incrustada prioritaria (`artwork:v1:*`). |
| **K02** | **Sin conexión, cero peticiones de red** | Cuando `navigator.onLine === false`, ningún componente ni módulo de caché emite `fetch` de catálogo, portadas, configuración o SWR (0 peticiones observadas). |
| **K03** | **Cero fuga o mezcla entre cuentas** | Ninguna entrada de `pulso-web-cache-v1` ni de RAM L1 creada bajo la cuenta A puede leerse bajo la cuenta B; al cerrar sesión o cambiar de cuenta se purgan RAM y entradas persistentes de la cuenta saliente. |
| **K04** | **Caché estrictamente acotada y *fail-open*** | `artwork` nunca supera 30 MiB / 800 entradas tras compactación y `catalog` nunca supera 5 MiB / 500 entradas; ningún fallo de IDB o `QuotaExceededError` bloquea reproducción, importación, descargas ni Biblioteca. |
| **K05** | **Separación total respecto a copias de audio, Biblioteca y backups** | `pulso-web-cache-v1` no escribe ni modifica `pulso-web-local-v1`, OPFS `pulso-assets-v1`, manifiestos `LocalAsset`, `account-library` ni exportaciones de organización; «Limpiar caché de portadas» conserva el 100 % de audios, playlists, favoritos y carátulas manuales/incrustadas. |
| **K06** | **No regresión de T24 (`Q01–Q19`, `I01–I08`) ni T25 (`S01–S12`, `J01–J08`)** | Las descargas de bots, la cola FIFO de colecciones, la clasificación de fallos, el dock autoocultable y las mejoras de velocidad de T25 permanecen intactas. |
| **K07** | **Seguridad de contenido, cuotas externas y cero botones por fila** | Toda imagen pasa `validateArtwork` (sin SVG/HTML ni `<img src="https://...">`); los límites de 3,1 s (iTunes) y 1,1 s (MusicBrainz) y los cooldowns 429/503 jamás se reducen; no se añade ningún botón en las filas de canciones. |
| **K08** | **Presupuesto USD 0 y separación de evidencia por entorno (`V17`, `V29`, `V30`)** | Cero costes, cero servicios nuevos, cero dominios de pago, cero caché de borde simulada en `workers.dev`; los PASS de escritorio (Chromium/WebKit) nunca se declaran aceptación física en iPhone. |

---

## Matriz de trazabilidad (Requisito / Invariante → Prueba → Nivel)

Niveles según `doc/SPEC.md` §V.2: **U** (unitaria con módulos reales y dependencias controladas), **B** (navegador real Chromium y WebKit en loopback con DOM/IDB/OPFS/SW reales), **D** (iPhone físico del propietario).

| ID | Prueba propuesta (archivo y casos) | Nivel | Qué verifica exactamente |
|---|---|---|---|
| **C01** | `tests/unit/persistent-cache-store.test.ts` (apertura `pulso-web-cache-v1`, serialización `ArrayBuffer`, tolerancia a error IDB); `tests/integration/check-persistent-cache-main.mjs` (comparación snapshot `pulso-web-local-v1` + OPFS + `caches.keys()` antes/después) | U / B | Base separada real en Chromium y WebKit (sin `Blob` en IDB), 0 mutaciones en Biblioteca/OPFS/SW. |
| **C02** | `tests/unit/persistent-cache-lru.test.ts` (topes 30 MiB/800 y 5 MiB/500, marca baja 80 %, orden LRU, `QuotaExceededError` fail-open, reescalado ≤ 300 px y ≤ 256 KiB); `tests/integration/check-persistent-cache-main.mjs` (caso `lru-quota`) | U / B | Cumplimiento exacto de cotas, desalojo LRU a marca baja y supervivencia sin errores ante cuota llena. |
| **C03** | `tests/integration/check-persistent-cache-main.mjs` (casos `reopen-playlist-30` y `reopen-player-provider-artwork`: cerrar página, abrir nueva página en mismo perfil, comprobar píxeles vía Canvas en fila, mini, reproductor, MediaSession, acciones, Inicio y `CollectionCover`, con `requests === 0`) | B / D | Persistencia real tras reapertura y propagación a todas las vistas con 0 tráfico. |
| **C04** | `tests/integration/check-artwork-rows-dock.mjs` (A02 ampliado con caché persistente fría/caliente) + caso `manual-beats-persistent-cache` en `check-persistent-cache-main.mjs` (manual, ocultación manual y local incrustada ganan incluso si existe entrada previa en `pulso-web-cache-v1`) | U / B | Prioridad estricta manual/local > catálogo > proveedor y recomprobación post-async. |
| **C05** | `tests/integration/check-persistent-cache-main.mjs` (caso `offline-reopen-30`: calentar 30 portadas + búsqueda + álbum, cerrar página, reabrir con `navigator.onLine = false`, verificar 30/30 portadas decodificadas + búsqueda/álbum visibles y `requests === 0`) | B / D | Disponibilidad offline completa de caché (incluyendo entradas *stale*) con 0 peticiones de red. |
| **C06** | `tests/unit/persistent-cache-account.test.ts` (claves `[accountId, key]`, purga por rango); `tests/integration/check-persistent-cache-main.mjs` (caso `account-switch-and-logout`: cuenta A calienta portada/búsqueda → cambio a cuenta B / `signOut` → B no ve datos de A, registros de A purgados en IDB, `pulso-web-local-v1` intacto) | U / B | Aislamiento estricto por cuenta y limpieza real al cerrar sesión o cambiar de cuenta. |
| **C07** | `tests/unit/persistent-cache-swr.test.ts` (ventanas fresh/stale/expired con reloj inyectado, SWR actualiza solo si cambia SHA-256, fallo de red conserva valor viejo, bypass en «Actualizar sugerencias»); `tests/integration/check-persistent-cache-main.mjs` (`swr-revalidate`) | U / B | Frescura, SWR no bloqueante sin parpadeo y refresco manual explícito. |
| **C08** | `tests/unit/catalog-cache-shared.test.ts` (caché compartida + *singleflight* entre búsqueda, álbum y artista); `tests/integration/check-persistent-cache-main.mjs` (`reopen-search-album-artist`: medir M-C5 y M-C6 con 0 peticiones HTTP) | U / B | Reducción ≥ 80 % en búsqueda repetida tras reapertura y compartición entre pantallas. |
| **C09** | `tests/integration/check-persistent-cache-main.mjs` (`preload-batch-and-lazy-viewport`: playlist 50 filas → transacción única de hidratación para cacheadas, solo viewport pide red para faltantes, 0 llamadas a `PlayerArtworkProvider` por fila, scroll/play sin bloqueo) | B | Precarga por lote rápida y ausencia de tormenta de red fuera del viewport. |
| **C10** | `tests/server/test_cloudflare_worker.mjs` (o `tests/server/*.test.mjs`: cabeceras `Cache-Control` exactas por ruta 200 vs 4xx/5xx vs `/api/account-*` vs HTML); `tests/unit/catalog-fetch.test.ts` (`cache: 'default'` vs `'reload'`) | U | Cabeceras HTTP correctas en Worker y cliente sin romper `no-store` en rutas privadas/errores. |
| **C11** | `tests/unit/catalog-fetch.test.ts` (único reloj 3.100 ms sin doble espera, prioridad `high` adelanta a `low`, *singleflight*, 429/503 cooldown intacto); `tests/server/*.test.mjs` (concurrencia relay de imágenes sin 429 para 2–4 portadas) | U | Respeto estricto de cuotas externas y eliminación de retardos artificiales/429 espurios. |
| **C12** | `tests/unit/storage-summary.test.ts` (categorías disjuntas incluyendo caché de portadas); `tests/integration/check-persistent-cache-main.mjs` (`settings-storage-clear`: verifica MB mostrados, pulsa «Limpiar caché de portadas», verifica `0,00 MB`, audio sonando sin corte y Biblioteca/manual intactos) | U / B | UI limpia en Ajustes → Almacenamiento, 0 botones en filas, limpieza segura y verificada. |
| **K01–K08** | Regresión cruzada: `npm run check`, `check-artwork-rows-dock.mjs` (12/12 × 2 motores), `check-playlist-full-download-main.mjs` (regresión T24/T25), `check-download-feedback.mjs` (5/5 × 2 motores), auditoría CSP (`external.size === 0`, 0 `img-src` externos) | U / B / D | Cumplimiento simultáneo de todos los invariantes, cero regresiones de T24/T25/v61 y USD 0. |

---

## Plan resumido en incrementos pequeños (ordenados por ganancia y riesgo)

El desglose técnico y archivos de cada incremento están en [diseno-inventario-y-medicion.md](file:///data/home/Proyectos/Pulso-Web/.local/research/cache-odd/diseno-inventario-y-medicion.md).

| Orden | Incremento | Requisitos | Ganancia esperada | Riesgo | Medida de éxito |
|---|---|---|---|---|---|
| **Inc. 1** | **Almacén `pulso-web-cache-v1` + caché persistente de portadas + modo offline** | C01, C02, C03 (catálogo + proveedor), C04, C05, C06 | **Mayor ganancia visible:** portadas al instante al reabrir (M-C1 ≤ 200 ms vs 1,5 s), **0 bytes / 0 reqs** al reabrir (M-C3/M-C4), **100 % portadas offline** (M-C2 vs 0/30). | **Bajo** (BD nueva aislada, sin tocar `pulso-web-local-v1` ni `sw.js`). | M-C1 ≤ 200 ms, M-C2 = 30/30 offline con 0 reqs, M-C3 = 0 reqs al reabrir, K01–K05 PASS en Chromium y WebKit. |
| **Inc. 2** | **Ajustes → Almacenamiento («Limpiar caché de portadas») + precarga por lote + `IntersectionObserver` en filas** | C09, C12 | Control explícito del usuario sobre el espacio en el teléfono + eliminación de tormenta de 30–50 lecturas/peticiones al abrir playlists largas. | **Muy bajo** (UI localizada en `StorageSettings.tsx` y `CatalogArtwork.tsx`). | Contador MB exacto, limpieza a `0,00 MB` sin tocar audio/manual, ≤ 1 transacción IDB de hidratación inicial en playlist de 30–50 pistas. |
| **Inc. 3** | **Caché persistente de información (búsquedas, álbumes, artistas) + unificación de `AlbumCatalog` + SWR** | C07, C08 | Búsquedas repetidas de **3,8 s → ≤ 600 ms** con 0 reqs (M-C5); álbumes y artistas de **120–3.200 ms → ≤ 150 ms** y disponibles offline (M-C6). | **Bajo-medio** (toca `MusicSearchController.tsx`, `AlbumPageController.tsx`, `ArtistCatalogView.tsx`). | M-C5 ≤ 600 ms y 0 reqs, M-C6 ≤ 150 ms y offline PASS, SWR verificado con reloj inyectado y bypass manual operativo. |
| **Inc. 4** | **Cabeceras HTTP `Cache-Control` en Worker + unificación de cola 3,1 s con prioridad + concurrencia relay** | C10, C11 | Elimina doble espera de 3,1 s y `429` espurios de imágenes en Cloudflare; mejora carga fría y respeta cuotas Apple/MusicBrainz. | **Bajo** (toca `worker.mjs`, `relay.mjs`, `catalog-fetch.ts`, `album-catalog.ts`; requiere validación de pruebas servidor Cloudflare). | 100 % pruebas de servidor PASS, 0 `429` al abrir playlist fría de 30 portadas en relay, ≥ 3.100 ms estrictos en iTunes y prioridad `high` > `low` verificada. |
| **Inc. aparte** *(fuera de T26)* | **Inicio rápido de canciones ya descargadas** *(recomendado por la medición del punto 6)* | Nueva tarea / T25 | Resuelve el **timeout > 30 s en OPFS** (30 pistas) y baja el arranque de **14,5 s (IDB 30 pistas) / 1,88 s (1 pista)** a **< 250 ms**. | **Medio** (toca `main.tsx`, `transport.ts`, `sw.ts`, `asset-reader.ts`; requiere rigor de seguridad/integridad de T13/T24). | Arranque de canción descargada en playlist de 30 pistas ≤ 300 ms en OPFS e IDB sin reducir verificación de corrupción en lectura. |

---

## Encaje con el trabajo en curso sobre v62

- **`perf/t25-m1` (`f9515ed` — suspende Telegram en reposo):** 15 archivos, centrados en `src/telegram/*` y pruebas de bots. **Choque nulo** con Inc. 1, 2 y 4; **choque mínimo** (6 líneas en `src/ui/MusicSearchController.tsx`) con Inc. 3. Compatible en paralelo.
- **`fix/startup-splash-notice` (`f803135` — logo de entrada y avisos silenciosos de restauración):** 5 archivos, principalmente `src/main.tsx` (+58/-14 líneas en arranque, `status`/`startupStatus` y `PlayerSurface`). **Choque moderado en `src/main.tsx`** al conectar `accountBoundary`, props de `StorageSettings` y precarga. Recomendación: fusionar primero `fix/startup-splash-notice` (o aislar la lógica de caché en `src/cache/*` para reducir el diff en `src/main.tsx`).

---

## Límites y pendientes

1. **Aceptación física en iPhone (`D`) — NO EJECUTADA:** las 16 pruebas vigentes de `docs/IPHONE-ACEPTACION.md` (`A1–E1`, iPhone 13 / iOS 27 declarado) permanecen **NO EJECUTADAS**. Además, al entregar T26 convendrá añadir en esa lista (cuando corresponda) comprobación física de **reapertura en modo avión con portadas visibles** (extensión de `D4`) y **persistencia tras reinicio** (`E1`), tanto en Safari pestaña (sujeto a ITP 7 días) como en Pantalla de Inicio (exento de ITP 7 días).
2. **WebKit desktop vs Safari iOS:** las mediciones de línea base en WebKit 27.2 (Linux WPE) no acreditan cuota, comportamiento de `navigator.storage.persist()`, rendimiento de OPFS ni purga real bajo presión de memoria de iOS.
3. **Variante Apple CDN `300x300bb`:** pendiente de verificación pública acotada en implementación (si alguna URL Apple devolviera 404 para `300x300bb`, se mantiene fallback a `600x600bb` + redimensionado local ≤ 300 px antes de guardar en IDB).
4. **Estado de memoria Engram en esta inspección de solo lectura:** `python3 scripts/sync_odd_memory.py --read-only` expiró por timeout en `initialize` (`TimeoutError: Engram MCP request timed out`). No se modificó `.local/engram/` ni ningún archivo versionado; los archivos Markdown y el código del checkout `f97ebb5` se leyeron directamente como fuente canónica.

## Entrega del incremento 1 · 2026-11-25

Rama `perf/t26-inc1`, base de ejecución `f803135`. La decisión del propietario del 2026-11-25, registrada también en T7, autoriza esta persistencia acotada exclusivamente en el teléfono.

`pulso-web-cache-v1` guarda miniaturas de catálogo y del proveedor en formato binario y enlaces pista→miniatura. Los enlaces son el único uso del store `catalog` en este incremento. La caché pasa por validación de formato y decodificación, limita ambos ejes a 300 px y limita el tamaño a 256 KiB. La L1 comparte 64 entradas y 8 MiB para ambas fuentes. El desalojo actúa por cuenta y el fallo de cuota conserva la imagen validada en memoria. Al cambiar de cuenta o cerrar sesión se retira el ámbito activo y se purga su cuenta saliente. La identidad recordada de la misma cuenta permite reabrir con las imágenes guardadas en modo offline.

La prioridad estricta C04 se aplica también en la cabecera de una edición guardada. El inventario técnico describía una excepción histórica para la portada incrustada de esa vista. La indicación del propietario para este incremento da prioridad a la portada local en esa vista.

Los controles de Ajustes y la precarga por lote corresponden al incremento 2. Las fichas de información corresponden al incremento 3. Las cabeceras y la cola del relay corresponden al incremento 4. La comprobación pública de variantes Apple CDN y la aceptación física en iPhone siguen pendientes. D4 y E1 deben comprobar también que las portadas vuelven a mostrarse tras abrir sin red y tras reiniciar el teléfono.

### Evidencia funcional de reapertura

`tests/integration/check-persistent-cache-main.mjs` usa una playlist de 30 pistas, imágenes sintéticas de 200×200 px, un proxy bloqueado fuera de loopback y páginas nuevas en un perfil persistente. Cuenta los cuerpos HTTP de catálogo y portadas junto con los intentos de `fetch`. Estos conteos proceden de Chromium con carga alta, en modo funcional.

| Reapertura | `f803135`: portadas, peticiones, bytes | Incremento 1: portadas, peticiones, bytes |
|---|---|---|
| Con conexión | 30/30, 31, 17.802 B | 30/30, 0, 0 B |
| Sin conexión | 0/30, 0, 0 B | 30/30, 0, 0 B, incluso con 120 días de antigüedad |

Los tiempos M-C1 y M-C2 en `f803135` y en el incremento quedan pendientes de una serie admisible. El arnés `--measure --wait-load` comprueba `uptime` antes de lanzar cada motor, usa el SW del producto y simula 120 ms de latencia HTTP. La VM mantuvo una carga de un minuto por encima de 1,5 en los intentos que completaron la comprobación. Los milisegundos del modo funcional quedan excluidos de la comparación de rendimiento.

### Matriz del incremento 1

`tests/unit/persistent-artwork-cache.test.ts`: 0/6 en `f803135` y 6/6 en el incremento. Cinco fallos de base se deben a la ausencia de la política de caché. La prueba de transporte de base falla porque puede intentar resolver el relay estando offline.

| Requisito | Prueba U/B | `f803135` | Incremento 1 |
|---|---|---|---|
| C01 | Límites de admisión U, almacén independiente y representación binaria B | FAIL U y Chromium, falta el almacén | PASS U y apertura real en Chromium y WebKit |
| C02 | Dimensiones, bytes y marcas LRU U, normalización real y cuota B | FAIL U y normalización persistente en Chromium | PASS U y normalización 600×400 → 300×200 en Chromium. Diagnóstico de almacén real PASS en Chromium y WebKit, 801 → 640 registros y reintento de cuota 640 → 321. Recorrido completo del arnés pendiente |
| C03 | Vigencia U, 30 filas y proveedor en fila, mini, reproductor, MediaSession, menú e Inicio B | FAIL U y Chromium, 31 peticiones al reabrir y proveedor ausente en la fila | PASS U y Chromium, 0 peticiones y proveedor decodificado en las superficies enumeradas |
| C04 | Prioridad y ocultación U, portadas manual e incrustada B | FAIL U. La regresión nueva de portada incrustada en vista de edición queda pendiente de ejecución completa | PASS U. A02 confirma manual visible y oculta en Chromium. Falta el resultado de la ejecución completa del caso nuevo de edición |
| C05 | Expiración offline y transporte sin sondeo U, 30 portadas envejecidas B | FAIL U y disponibilidad en Chromium, 0/30 | PASS U y Chromium, 30/30 y 0 intentos |
| C06 | Rango de clave U, cambio de cuenta y cierre B | FAIL U y ausencia de almacén en Chromium | PASS U y A02c en Chromium para cambio y revocación en RAM. El diagnóstico de almacén PASS en ambos motores confirma aislamiento del mismo ID, bloqueo de escritura del ámbito retirado y purga selectiva. Falta el resultado del recorrido combinado hasta verificar cambio y cierre en ambas interfaces |
| K05 | Snapshot de Biblioteca, OPFS y Cache API B | El inventario coincide. Falta el almacén para la aserción compuesta | PASS Chromium con portadas persistidas |

La comparación de interfaz en Chromium mantuvo los tres destinos de la navegación, la playlist de 30 pistas, el orden de las filas y sus acciones. La carga elevada causó timeouts y terminaciones en las primeras ejecuciones completas. La batería de navegador en Chromium y WebKit y la comparación final de interfaz en WebKit se registran según los resultados observados, con aceptación física separada.

### Memoria y batería local

La lectura inicial de la copia Engram detectó una divergencia de T8. El SHA-256 del recibo coincide con T8 en el padre de `f803135` y el archivo canónico incorpora la modificación de `f803135`. Ante el timeout y la salida del MCP durante `initialize` en el clon SQLite, se prepara un almacén temporal aislado con otra copia de los archivos ODD para verificar sus bytes y SHA-256. La base compartida queda fuera de ambas operaciones.

Validaciones locales completas: `npm run test:unit` 1047/1047, `npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, `npm run build`, `npm run test:cloudflare` 73/73 y `npm run test:py` 10/10. El diagnóstico de IndexedDB real usó datos sintéticos y comprobó los stores separados, el enlace del proveedor, la cuenta con la misma clave, el desalojo exacto, una cuota inyectada seguida de reintento y la purga selectiva.

Publicación y verificaciones de v63 en [P0-W](P0-W.md#2026-11-25--publicación-de-v63).
