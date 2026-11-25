# T25 · Velocidad de adquisición y primer sonido de bots

- **Método:** ODD (`doc/SPEC.md` §C.5 y §V.2)
- **Estado:** S01 y S02 implementados. Validación local y de navegador ejecutada, con gate fallido. Revisión independiente pendiente.
- **Fecha:** 2026-11-25
- **Línea base:** v60 publicada (`086aaac`, rama `fix/album-tap-save-queue`, PR 20). Rama paralela `fix/artwork-rows-dock` (v61) fuera del pipeline de bots.
- **Requisitos SPEC vinculados:** W08, W10, W11, W13, W17, W18 · Invariantes SPEC: V2, V3, V5, V6, V8, V9, V10, V11, V13, V16, V17, V21, V22, V23, V24, V27, V28, V29, V30, V31
- **Documentos de soporte (fuera de Git):**
  - Inventario de `perf/faster-bot-pipeline` y plan detallado por incrementos: `.local/research/speed-odd/inventario-y-plan.md`
  - Trazado de latencia y diseño técnico base: `.local/research/latency-design-neon-2026-11-24/report.md`
  - Decisión sobre caché temporal (descartada por el propietario): `.local/research/telegram-cache-playback-2026-11-25/report.md`

---

## Propósito

Reducir de forma medible y verificable:
1. **El tiempo desde el toque hasta el primer sonido** de una canción no descargada (prioridad principal del propietario al retomar velocidad).
2. **El tiempo por pista y total al descargar playlists y álbumes completos** mediante los bots autorizados de Telegram.

Todo ello **sin degradar** la fiabilidad, la recuperación automática ni la clasificación única de fallos fijada por la PR 20 (`odd/tasks/T24-cola-colecciones.md`, requisitos `Q01–Q19` e invariantes `I01–I08`), manteniendo presupuesto **USD 0**, **pocos botones**, **«No existe en tus bots» sólo ante ausencia confirmada en todos los bots** y **cero trucos de segundo plano prohibidos** (`doc/SPEC.md:581`).

---

## Alcance autorizado

1. **Canal de avisos MTProto (wakeup) en el worker de sesión:** habilitar recepción de updates del servidor sin instanciar `UpdatesManager` (`disableUpdates: false, updates: false` en `src/telegram/temporary-sdk.ts:50`), despertar los sondeos de búsqueda y callback ante mensajes nuevos/editados del bot verificado y conservar el sondeo actual (`250/250/400/700/1000 ms`) como respaldo.
2. **Reducción de viajes de ida y vuelta (RPCs) por canción:** eliminar la relectura `messages.getMessages` redundante inmediatamente posterior al `getHistory` del callback (`src/telegram/bot-search-driver.ts:207`), evaluar la poda segura de `getHistory(1)` redundante pre-callback y amortiguar la comprobación HTTP `/latest.json` previa a cada descarga (`src/service-worker/automatic-update.ts:148-173`) si la app ya se comprobó hace < 60 s.
3. **Camino local ligero hacia el primer sonido y guardado incremental:** reducir el coste local tras recibir los bytes (`src/imports/import-file.ts`, `src/storage/asset-reader.ts`, `src/storage/database-realms.ts`, `src/main.tsx`, `src/playback/transport.ts`): coalescer los `refresh()` duplicados, refresco incremental del asset importado, reutilización segura del `import.worker.ts`, bloques OPFS de 512 KiB en escritura y verificación, extracción diferida de carátula/letras incrustadas fuera del bloqueo del primer sonido y eliminación del re-hash completo redundante en `startLocalSourcePreparation` cuando el asset acaba de verificarse.
4. **Espaciado por bot (`remoteClock` por `username`):** conservar ≥ 1.000 ms entre consultas al mismo bot sin penalizar el salto inmediato a un bot de respaldo distinto (`src/library/ordered-bot-acquisition.ts`, `album-acquisition.ts`, `album-download.ts`, `library-download.ts`).
5. **Rechazo temprano *fail-open* de archivos con etiquetas inequívocamente ajenas:** detener la descarga de MP3/M4A tras el bloque 0 (o bloque 0 + último bloque en M4A con `moov` al final, reutilizando dicho bloque sin bajarlo dos veces ni reducir las 4 solicitudes concurrentes) cuando título y artista sean inequívocamente ajenos (`src/telegram/bot-download-bytes.ts`, nuevo `src/telegram/early-audio-tags.ts`, integrado con `BotSearchFileError` y `classifyBatchFailure` de T24).
6. **Solapamiento acotado búsqueda/guardado en lotes (fase posterior):** solapar `search(i+1)` en el único carril de red Telegram mientras `save(i)` escribe en almacenamiento local, manteniendo el checkpoint anclado en `i` y tope de memoria RAM para Safari iOS.
7. **Reutilización worker-privada de localizadores de documento (fase opcional posterior):** índice LRU en el almacén privado del worker (`pulso-web-telegram-session-v1` v2, ligado al `lease`/`EPOCH`) para re-descargas tras «Quitar descarga» o reparación mediante 1 `messages.getMessages` + `upload.getFile`.
8. **Arnés reproducible de medición en local con Telegram sintético y actualización documental:** ampliar `tests/integration/check-playlist-full-download-main.mjs` y `tests/integration/playlist-full-download-sdk.ts` para medir todas las métricas objetivo, y sincronizar `docs/BOT-DOWNLOADS.md` y `docs/BOT-SEARCH-DIAGNOSTICS.md` con los límites vigentes.

## Fuera de alcance

- **Caché temporal con evicción LRU:** descartada expresamente por el propietario porque no acorta el primer sonido de una canción no descargada (ver `.local/research/telegram-cache-playback-2026-11-25/report.md`).
- **Streaming progresivo vía Service Worker o `ManagedMediaSource` (MSE):** descartado en esta tarea por incompatibilidad con M4A monolítico sin remuxer, choque con validación previa de identidad musical, restricción de AirPlay y alto riesgo bajo bloqueo en iPhone (`doc/SPEC.md:116,581`; `.local/research/telegram-cache-playback-2026-11-25/report.md:134-163`).
- **Consultas en paralelo a múltiples bots o múltiples `search`/`callback` simultáneos:** prohibido por riesgo de `FLOOD_WAIT`, corrupción de correlación en el chat del bot y ruptura del carril único (`V28`).
- **Relajar la validación de identidad musical** (título, artista completo, palabras de versión live/remix/cover o tolerancia de duración) para aceptar audios dudosos más rápido.
- **Nuevos bots/proveedores, modo inline no verificado, backends de audio o servicios de pago** (presupuesto estrictamente USD 0).
- **Cambios de interfaz ajenos** (carátulas, filas, dock y avisos del reproductor de la rama `fix/artwork-rows-dock` / v61), botones nuevos por canción o recuperación automática BFCache (`Q09b` de T24).
- **Trucos de segundo plano prohibidos por `doc/SPEC.md:581`** (audio silencioso, wakelock falso, timers keepalive, `skipWaiting` forzado).
- **Pruebas con Telegram real (`T`), aceptación física en iPhone (`D`) y publicación automática en Cloudflare:** requieren su etapa/verificación aplicable; esta tarea define requisitos, métricas y pruebas reproducibles antes de implementar.

---

## Métricas objetivo y línea base de v60

Todas las métricas primarias se miden en local sobre **loopback HTTP + Telegram sintético** (`tests/integration/check-playlist-full-download-main.mjs` y `tests/integration/playlist-full-download-sdk.ts`) con los drivers, worker de sesión, importador, IndexedDB/OPFS, Service Worker y `HTMLAudioElement` reales del producto, en **Chromium y WebKit**.

### Parámetros estándar del arnés sintético

- **Red sintética:** `__PLAYLIST_RPC_MS__ = 200` ms por RPC (simula RTT móvil típico), respuestas del bot con `delayMs ∈ {400, 1200}` ms.
- **Payload estándar:** MP3 de 8 MiB (`benchmarkBytes` en `tests/integration/playlist-benchmark-audio.mjs`) y WAV/MP3 cortos de fixture para pruebas de primer sonido con biblioteca poblada (`existingCount = 300`).
- **Verificación obligatoria en cada medición:** 100 % de las copias verificadas por longitud + SHA-256 exacto y cero errores de consola/CSP/página.

### Línea base estimada de v60 (`086aaac`) y objetivos por métrica

> **Nota sobre evidencia:** v60 (`086aaac`) conserva exactamente la ruta de transferencia y sondeo de v56/v57 (`T11-T12-lotes-locales.md:729-734,821-828`). Los valores marcados *(medido v56/v57)* proceden de actas registradas en ODD con el mismo arnés; los marcados *(estimado desde código v60)* se calculan sobre las constantes verificadas en `src/` y deberán fijarse con una corrida de línea base sobre `086aaac` antes del Incremento 1.

| ID | Métrica | Línea base v60 (`086aaac`) | Objetivo T25 (tras Inc. 1–4) | Objetivo ampliado (tras Inc. 5) | Cómo medirla |
|---|---|---|---|---|---|
| **M1a** | **Toque → primer sonido** (canción nueva, flujo menú, 8 MiB, `rpcMs=200`, `delayMs=400`, OPFS, biblioteca 300 copias) | *(Estimado código v60)* ~**5,5–7,2 s** (9 RPCs metadatos + 16 partes en 4 ventanas + 2 sondeos ciegos ≥500 ms + `/latest.json` + worker nuevo + 256 I/O OPFS 64 KiB + `refresh` 300 pistas + 2.º `refresh` alias + re-hash completo en `transport.ts:220`) | **≤ 3,5 s** (reducción ≥ **35 %**, ahorrando ≥ **1,8 s**) | **≤ 3,2 s** | Escenario nuevo `first-sound` en `check-playlist-full-download-main.mjs`: `t0 = performance.now()` en el clic/tap sobre sugerencia de `MusicSearchPanel` hasta el evento `playing` real en `<audio>` (`currentTime > 0` o primer `timeupdate` > 0) + verificación SHA-256. |
| **M1b** | **Toque → primer sonido** (canción nueva, flujo menú, 8 MiB, `rpcMs=200`, `delayMs=1200`, OPFS/IDB) | *(Estimado código v60)* ~**8,2–10,0 s** (bot 1.200 ms cae tras los 250+250+400=900 ms y espera el tramo de 700 ms hasta 1.600 ms en ambas fases: +800 ms perdidos en polling) | **≤ 6,0 s** (reducción ≥ **28 %**, ahorrando ≥ **2,2 s**) | **≤ 5,6 s** | Mismo escenario `first-sound` con `delayMs = 1200` en OPFS e IDB forzado. |
| **M1c** | **Toque → primer sonido** (canción nueva, audio directo corto, `rpcMs=200`, `delayMs=400`, 300 copias) | *(Estimado código v60)* ~**2,4–3,5 s** | **≤ 1,5 s** (reducción ≥ **35 %**) | **≤ 1,3 s** | Escenario `first-sound-direct` (sin callback, fixture WAV/MP3) en Chromium y WebKit. |
| **M2a** | **RPCs de metadatos por canción (flujo menú, bot resuelto, 1 acierto por fase)** | **9 RPCs** base (`getHistory(1)`, `sendMessage`, `getHistory(20)`, `getMessages` menú, `getHistory(1)`, `callback`, `getHistory(20)`, `getMessages` pre-bytes, `getMessages` post-bytes) + **2–6 `getHistory(20)` vacíos** según `delayMs` (`bot-search-driver.ts:152-278`) | **≤ 8 RPCs** en Inc. 1 (**≤ 1 `getHistory(20)` por fase** con wakeup, ahorrando 2–6 sondeos vacíos + 1 `getMessages`) | **≤ 7 RPCs** en Inc. 5 (y **1 RPC** en re-descarga hit en Inc. 6) | Conteo exacto por tipo de RPC (`resolveUsername`, `getHistory`, `sendMessage`, `getMessages`, `getBotCallbackAnswer`, `upload.getFile`) registrado en `playlist-full-download-sdk.ts` y verificado en unitarias (`bot-audio-download.test.ts`, `bot-search-driver.test.ts`). |
| **M2b** | **RPCs de metadatos por canción (audio directo, bot resuelto)** | **5 RPCs** base + **1–3 `getHistory(20)` vacíos** (`bot-search-driver.ts:246-263,162,241`) | **5 RPCs** exactos (0 sondeos vacíos con wakeup) | **4 RPCs** (en re-descarga hit: **1 RPC**) | Mismo contador de RPC en unitarias e integración. |
| **M3a** | **Tiempo por pista en lote** (2 pistas 8 MiB, `rpcMs=200`, `delayMs=400`, OPFS / IDB) | *(Medido v56/v57 en `T11-T12:731-734`)* Chromium OPFS **4,96 s**, Chromium IDB **3,90 s**, WebKit IDB **6,60–6,69 s** | Reducción ≥ **20 %** en media por pista frente a línea base medida en la misma máquina sobre `086aaac` | Reducción ≥ **30 %** (con solapamiento Inc. 5) | `checkBenchmark` (`mode=benchmark`, 2 pistas) ejecutado sobre `086aaac` (línea base) y sobre cada incremento en la misma máquina y motor. |
| **M3b** | **Tiempo por pista en lote sobre biblioteca grande** (30 pistas 8 MiB, `existingCount=300`, `delayMs=400`, OPFS) | *(Estimado código v60)* crece linealmente con `existingCount` por `refresh(..., afterImport=true)` (`main.tsx:697-711`) + doble `refresh` (`main.tsx:574`) → **~5,8–7,5 s/pista** (mediana y `p90Ms`), `refreshMs` de cientos de ms/pista | **Mediana y `p90Ms` estables O(1)** respecto a `existingCount`; reducción de `refreshMs` ≥ **70 %** y reducción de `totalMs` ≥ **25 %** frente a `086aaac` | Reducción de `totalMs` ≥ **35 %** (con solapamiento Inc. 5) | `checkBenchmark(..., count=30, existingCount=300)` con `window.testDownloadTiming()` (registrando `medianMs`, `p90Ms`, `totalMs`, `refreshMs`, `writeMs`, `verifyMs`, `searchPollMs`, `callbackPollMs`). |
| **M4** | **Salto a bot de respaldo tras respuesta vacía (`betweenSearchesMs`)** | *(Estimado código v60)* ≥ **1.000 ms** forzados por `remoteClock.settledAt` global (`ordered-bot-acquisition.ts:103,236`) | **< 250 ms** entre el cierre de Bot 1 y la consulta a Bot 2 (ahorro ~**0,8–1,0 s** por salto), conservando ≥ **1.000 ms** al mismo bot | Igual | Escenario `turnaround/pacing` en `check-playlist-full-download-main.mjs` + unitaria en `ordered-bot-acquisition.test.ts`. |
| **M5** | **Bytes y chunks descargados en rechazo de etiquetas ajenas (8 MiB, 2 candidatos malos + 1 bueno)** | **48 chunks (24 MiB)** = 16 × 3 archivos completos (`tags-tail` sin rechazo temprano) | **≤ 26 chunks (≤ 13 MiB)** — ahorro ≥ **45 %** de bytes y **< 15 s** en `betweenSearchesMs` (≤ 5 chunks por candidato malo: 4 iniciales + 1 cola en M4A o ≤ 4 en MP3) | Igual | Escenario `turnaround/tags-tail` (MP4 8 MiB `moov` al final) y `turnaround/tags-mp3` (MP3 8 MiB ID3v2.3/v2.4 con UTF-16 y UTF-8). |
| **M6** | **Re-descarga tras «Quitar descarga» (opcional, Inc. 6)** | Igual a primera descarga (**9 RPCs** + sondeos + **~5–8 s**) | *(No aplica hasta Inc. 6)* | **1 RPC** de metadatos (`getMessages`) + `upload.getFile` (**0 `sendMessage`**, **0 `callback`**, ahorro ≥ **50 %**) | Escenario `reuse-after-remove` en navegador: descargar → quitar descarga → volver a descargar con mismo SHA-256. |

### Regla de medición comparativa

Dado que los tiempos absolutos dependen de la CPU del entorno local, **cada incremento debe medirse en el mismo host y sesión contra un snapshot de `086aaac` (v60)** con las mismas fixtures, registrando mediana, p90, desglose `DownloadTiming` (`searchPollMs`, `callbackPollMs`, `transferMs`, `analysisMs`, `writeMs`, `verifyMs`, `metadataMs`, `refreshMs`, `waitMs`) y conteos exactos de RPC. Las cifras de escritorio **nunca** se presentan como latencia confirmada en iPhone físico (`V30`).

---

## Requisitos funcionales y de rendimiento (`S01…S12`)

| ID | Requisito | Criterio de aceptación verificable |
|---|---|---|
| **S01** | **Despertar de sondeo por updates MTProto con respaldo intacto** | `BaseTelegramClient` se abre con `disableUpdates: false, updates: false` (`src/telegram/temporary-sdk.ts:50`), envía un `updates.getState` best-effort tras login nuevo (`!restored` y sin `cooldown`), y filtra únicamente `updateShortMessage` o `updateNewMessage`/`updateEditMessage` (acotado a 64 elementos en `updates`/`updatesCombined`, leyendo propiedades propias con `Object.getOwnPropertyDescriptor`, sin getters) de mensajes entrantes (`out !== true`) del `botId` aprobado exacto. El aviso **sólo** adelanta el próximo `messages.getHistory` respetando un suelo anti-ráfaga de **125 ms** desde `lastPollAt`; sin avisos, rige exactamente `250/250/400/700/1000 ms`, los topes de `19`/`63` lecturas y `releaseWakeup()` siempre se ejecuta al terminar, cancelar o pasar a transferencia. |
| **S02** | **Reutilización del mensaje de audio recién entregado por el sondeo del callback** | Cuando `poll()` tras un callback entrega el mensaje exacto del `selectedAudio`, `bot-search-driver.ts` lo valida con `validateKnown(raw, selected)` (peer exacto, `messageId`, `botSearchAudioFingerprint` y re-proyección `matchingSongRows`) sin emitir una llamada `messages.getMessages` redundante pre-transferencia, reduciendo de 3 a 2 los `messages.getMessages` del flujo de menú y conservando íntegras las relecturas exactas pre-callback (menú) y post-transferencia (bloqueo por `conflict` si el bot edita o borra durante `upload.getFile`). |
| **S03** | **Guardado local ligero, bloques OPFS de 512 KiB, worker reutilizable y refresco incremental** | (1) `import-file.ts` escribe en OPFS en bloques de **512 KiB** conservando `chunkSize: 65536` y `chunks: Math.ceil(bytes / 65536)` en el manifiesto `LocalAsset` (`library.ts:22`). (2) `asset-reader.ts` lee OPFS en bloques de **512 KiB** durante `verifyDetailed(true)` (manteniendo `readRange` ≤ 64 KiB para el SW). (3) `captureSongPlayback.save` coalesca `attachRestoredAccountTrack` y `rememberSongAlias` antes de un único `refresh(..., importedAssetId)`, que comprueba presencia del asset recién importado y reutiliza `availability` cacheada para pistas sin cambio de generación (conservando `checkIdbAssetPresence` / escaneo completo en `refresh(true)` y revisiones explícitas de Almacenamiento). (4) El `import.worker.ts` puede reutilizarse entre descargas consecutivas mediante `finishImportWorkerRealm()` (retirando puerto y conexiones IDB tras cada recibo terminal) y **se termina obligatoriamente** ante pérdida de control de pestaña, cambio de cuenta, logout, `pagehide`, error/anomalía de BD o `recoveryRequired`. |
| **S04** | **Camino rápido al primer sonido (metadatos opcionales diferidos y transporte local sin re-hash redundante)** | (1) Una vez sellada y publicada la copia de audio en `import-file.ts` (`state: 'sealed'`), la extracción opcional de portada incrustada (`storeEmbeddedArtwork`) y letras incrustadas (`storeEmbeddedLyrics`) no bloquea la resolución del guardado ni el inicio de `player.play()` para una canción interactiva; corre de forma acotada tras emitir el recibo o en segundo plano seguro bajo guardas de ámbito/revisión, preservando avisos no fatales (`V7`, `I.errors`). (2) En `src/playback/transport.ts`, `startLocalSourcePreparation` cachea la capacidad `physicalSources === 1` por instancia de `ServiceWorker` (eliminando 1 `MessageChannel` por reproducción) y, para un asset recién sellado cuyo `storageKey`+`revision`+`sha256` acaba de verificarse en esta sesión bajo `WRITER_LOCK` sin mutaciones intermedias (o con verificación de presencia + tamaño bajo `generationLock`), permite arrancar la reproducción sin re-hashear por tercera vez los 8 MiB completos (manteniendo verificación completa de integridad en restauraciones, reaperturas, fallback Blob y ante cualquier duda). |
| **S05** | **Espaciado por bot (`remoteClock` por `username`)** | `remoteClock` pasa de un sello global `{settledAt}` a un `Map<string, number>` indexado por `username.toLowerCase()` del bot (con fallback a `providerRef`), preservando ≥ **1.000 ms** entre consultas consecutivas al **mismo** bot (incluso si reconecta la sesión y rotan los `providerRef`) y eliminando la espera de 1.000 ms al saltar a un bot distinto, con un suelo global mínimo opcional no obstructivo (≤ 100 ms o 0 ms verificado contra `V28`). |
| **S06** | **Amortiguación segura de `/latest.json` previo a descarga y conexión tibia del DC de medios** | (1) `createAutomaticUpdater.beforeDownload` (`src/service-worker/automatic-update.ts:148-173`) omite el `fetch('/latest.json')` bloqueante cuando la sesión actual ya confirmó `state === 'current'` hace menos de **60 s** sin errores intermedios y sin transición `offline → online` ni `hidden → visible`, manteniendo intactos los traspasos `update-*` cuando existe actualización pendiente o han pasado ≥ 60 s. (2) Si `@mtcute/core` admite configurar `inactivityTimeout` para conexiones `download` sin parchear `node_modules`, elevarlo de 60 s a **180 s** (en caso contrario, documentar la limitación y omitir). |
| **S07** | **Rechazo temprano *fail-open* de archivos con etiquetas inequívocamente ajenas** | `assembleBotDownloadBytes` acepta un `probe` opcional (`earlyAudioTagProbe`) que inspecciona el bloque 0 (512 KiB) de MP3 (ID3v2.3/v2.4 en UTF-8, ASCII/Latin-1 y UTF-16 con BOM) y MP4 (`moov` al inicio o último bloque alineado de 512 KiB si `moov` está al final). El último bloque prefetcheado en MP4: (a) se mueve fuera de `pending` al resolverse para **no reducir la concurrencia de 4 a 3** en archivos válidos, y (b) se reutiliza una sola vez al llegar su offset en el hash final (0 descargas duplicadas). Sólo rechaza (`file-tag-mismatch`) si título **y** artista son inequívocamente ajenos (política estricta *fail-open*: jamás rechaza títulos compuestos, `recordingTitleCandidate`, coincidencia parcial, `aART` ambiguo, WAV o etiquetas incompletas). El error `file-tag-mismatch` se integra en `BotSearchFileError` / `classifyBatchFailure` (Fila 7 de T24), conserva el menú reutilizable en lotes y en búsqueda individual (`Q19`), incrementa `metadataRejections`, actualiza `sessionBotHealth` como `'metadata-rejected'` (sin confundirlo con `file-unsupported` de `Q15`) y nunca emite `not-found`. |
| **S08** | **Poda segura de `getHistory(1)` pre-callback mediante marca de agua acotada** | *(Incremento 5)* Cuando el menú acaba de proyectarse en la misma operación y el `baseline` de callback puede anclarse con seguridad sin perder detección de concurrencia ni mensajes editados (verificado por prueba explícita de edición del menú, mensaje concurrente y audio vecino antiguo), se elimina el RTT de `getHistory(limit=1)` previo al callback; si cualquier precondición falla, se conserva `getHistory(limit=1)`. |
| **S09** | **Solapamiento acotado búsqueda/guardado en lotes (1 único carril de red)** | *(Incremento 5)* En `downloadLibrarySelection` (y opcionalmente `acquireAlbum`), mientras `save(i)` escribe en almacenamiento local, el único carril de red Telegram puede ejecutar únicamente `searchBot(i+1)` (0 bytes de audio extra en RAM o tope ≤ 24 MiB combinados). Se separan `telegramNetworkTokens` de `queueSaveTokens` en `control.activity`, el checkpoint permanece anclado en `{cursor: i, pending: {kind:'save', ...}}` hasta confirmar `save(i)`, nunca inicia `save(i+1)` antes de liquidar `save(i)`, y una cancelación o fallo de metadatos de `save(i)` descarta/liquida limpiamente el prefetch sin corromper `cursor` ni el menú retenido. |
| **S10** | **Reutilización worker-privada de localizadores de documento para re-descargas** | *(Incremento 6, opcional)* El almacén privado del worker (`pulso-web-telegram-session-v1` v2) añade `bot-locators-v1` (LRU ≤ 2.000 entradas, ligado al `lease`/`EPOCH` y purgado atómicamente en logout/cambio de cuenta) guardando únicamente metadatos worker-privados (`botId`, `messageId`, `audioFingerprint`, `bytes`, `mime`). Al re-descargar una pista sin copia local (`assetId === null`), permite **como máximo 1 intento** de `messages.getMessages([messageId])` sobre un bot actualmente activo, validando `botSearchKnownMessage` + `botSearchAudioFingerprint` + `matchingSongRows` para renovar `fileReference` y saltar directo a `upload.getFile`. Ante borrado, edición, `FILE_REFERENCE_EXPIRED` o bot inactivo, borra el localizador y cae al flujo normal sin bucle (`doc/SPEC.md:397`). |
| **S11** | **Arnés reproducible de métricas de velocidad y no-regresión** | `tests/integration/check-playlist-full-download-main.mjs` incorpora: (a) escenario `first-sound` (flujo menú y directo, 8 MiB y corto, con `existingCount=300`) midiendo tiempo real hasta `playing`; (b) `benchmark` ampliado con `(opfs, 400, 30, 300)` y desglose `DownloadTiming` + conteo de RPCs; (c) `turnaround/pacing` midiendo `betweenSearchesMs`; (d) `turnaround/tags-tail` y `tags-mp3` verificando reducción real de chunks leídos; y (e) corrección/protección del `readGate` en `mode=queue` para que no supere el timeout de transferencia de 18 s por lentitud de los barridos táctiles del arnés. |
| **S12** | **Documentación sincronizada y preservación de las reglas del propietario** | `docs/BOT-DOWNLOADS.md` y `docs/BOT-SEARCH-DIAGNOSTICS.md` reflejan los límites reales (32 MiB, 4 × 512 KiB, 19/63 lecturas, 125 ms wakeup, rechazo temprano *fail-open*). No se añade ningún botón por canción ni se altera el dock flotante autoocultable ni la recuperación automática. |

---

## Invariantes (`J01…J08`)

| ID | Invariante | Regla que nunca puede romperse |
|---|---|---|
| **J01** | **Preservación integral de T24 (`Q01–Q19` e `I01–I08`)** | Ninguna optimización rompe la tabla de clasificación de 10 filas (`classifyBatchFailure`), la monotonía de entrega (`I01`), la cuarentena de protocolo (`I02`), el consumo del menú tras éxito individual (`I03`), la ausencia de bucles de cola (`I04`), la no regresión en playlists normales sin cola (`I05`) ni el tratamiento de `file-unsupported` (`Q15`, `Q19`). |
| **J02** | **Cero incremento de riesgo de `FLOOD_WAIT` (`V28`)** | Un único carril activo de consultas a bots; nunca consultas paralelas entre bots ni entre pistas; espaciado ≥ **1.000 ms** entre consultas consecutivas al mismo bot; suelo mínimo **≥ 125 ms** entre lecturas adelantadas por wakeup; topes intactos de `19` / `63` lecturas y `22` / `69` respuestas; `floodSleepThreshold: 0`, `maxRetryCount: 0` y respeto estricto al `cooldown` compartido y a `FLOOD_WAIT_N`. |
| **J03** | **Nunca reproducir ni publicar un audio equivocado (`V6`, `V8`, `V22`)** | Un update MTProto jamás aporta datos proyectados ni `messageId` (es sólo señal); toda descarga conserva validación de peer privado exacto, re-proyección `matchingSongRows`, `known` post-transferencia antes de publicar bytes, cabecera mágica, longitud exacta, SHA-256 verificado sobre bytes persistidos y validación completa en `import-file.ts`. El rechazo temprano es estrictamente *fail-open*: cero falsos rechazos en títulos compuestos, `recordingTitleCandidate` o codificaciones no reconocidas. |
| **J04** | **«No existe en tus bots» sólo por ausencia confirmada (`Q16`, `I07`)** | `reason: 'not-found'` («No existe en tus bots») únicamente se emite cuando todos los bots activos respondieron explícitamente sin resultados (`botSearchReportsNoResults`) y ninguno devolvió archivo, `file-tag-mismatch`, `file-unsupported`, `needs-start`, `bot-limit`, `unsupported` ni fallo inconcluso. |
| **J05** | **Integridad de almacenamiento, autoridad y actualización SW (`V2`, `V8`, `V9`, `V10`, `V11`, `V24`, `V31`, `I06`, `I08`)** | `LocalAsset` conserva `chunkSize: 65536` y layout compatible con v60 y su Service Worker sin `skipWaiting`; ningún `idleBotImportWorker` sobrevive a pérdida de control, cambio de cuenta, logout, `pagehide`, `recoveryRequired` o anomalía de BD; ninguna cancelación borra copias verificadas ni recibos pendientes; la verificación explícita de Almacenamiento (`refresh(true)`) sigue detectando copias purgadas o corruptas. |
| **J06** | **Aislamiento worker-privado y privacidad (`V21`)** | Ningún `botId`, `messageId`, `documentId`, `fileReference`, update crudo ni dato privado de Telegram sale del worker hacia el hilo principal, `pulso-web-local-v1`, diagnósticos, backups ni Cloudflare. Todo localizador almacenado en el worker (`S10`) se purga atómicamente al cerrar sesión o cambiar de cuenta/lease. |
| **J07** | **Presupuesto USD 0 y cero trucos prohibidos de segundo plano (`V17`, `V29`, `doc/SPEC.md:581`)** | Ningún cambio añade costes, infraestructura externa, audio silencioso, wakelock falso, timers keepalive ni afirmaciones de funcionamiento en segundo plano en iPhone sin observación física real. |
| **J08** | **Reglas de interfaz del propietario intactas (`Q04`, `I08`, `V27`)** | Cero botones nuevos por canción, dock flotante autoocultable sin regresiones de foco/accesibilidad frente a v60, y recuperación automática conservada sin exigir pasos manuales adicionales. |

---

## Matriz de trazabilidad propuesta (Requisito / Invariante → Prueba → Nivel)

Niveles según `doc/SPEC.md` §V.2: **U** (unitaria con módulos reales y dependencias controladas), **B** (navegador real Chromium y WebKit en loopback con DOM/IDB/OPFS/workers/SW), **T** (Telegram real con cuenta autorizada), **D** (iPhone físico del propietario).

| ID | Prueba propuesta (archivo y casos) | Nivel | Qué verifica exactamente |
|---|---|---|---|
| **S01** | `tests/unit/bot-wakeup-update.test.ts` (tipos válidos/inválidos, `out:true`, otro `userId`, canal, >64 updates, getter trampa); `tests/unit/bot-search-driver.test.ts` (wakeup antes del ACK, ráfaga de 10 hints con suelo 125 ms, cancelación limpia sin fugas, respaldo sin updates); `tests/unit/bot-callback-history.test.ts` (update antes del ACK despierta edición de menú); `tests/integration/check-playlist-full-download-main.mjs` (`benchmark`, `first-sound`) | U / B / T | Adelanto real de `getHistory`, suelo ≥125 ms, 0 uso de payload del update, respaldo idéntico sin updates, reducción de `searchReads`/`callbackReads` y `searchPollMs`/`callbackPollMs`. |
| **S02** | `tests/unit/{ans,bot,kd,lyd}-audio-download.test.ts` (2 `getMessages` en vez de 3; conflicto si edita tras bytes bloquea entrega); `tests/unit/bot-callback-history.test.ts`; `tests/unit/ordered-bot-driver.test.ts` (regresión Q11–Q19) | U / B | Eliminación del `getMessages` pre-transferencia, validación estricta del mensaje de `getHistory` y preservación del bloqueo post-bytes. |
| **S03** | `tests/unit/asset-reader-legacy.test.ts` (layout 64 KiB + SHA-256 + lectura 512 KiB OPFS); `tests/unit/database-realm-protocol.test.ts` (rebind de worker tras recibo terminal y rechazo tras `poisoned`/anomalía); `tests/browser/opfs.ts` (presencia tras purga con `checkIdbAssetPresence` y `refresh(true)`); `tests/integration/check-playlist-full-download-main.mjs` (`benchmark` 30×300, `full`, `queue-cancel`, `queue-reload`) + prueba B de terminación de `idleBotImportWorker` en `pagehide`/cambio de cuenta/logout | U / B | Bloques 512 KiB OPFS, 1 único `refresh` incremental (reducción ≥70 % de `refreshMs`), worker reutilizado y terminado ante revocación/anomalía, compatibilidad de manifiestos v60. |
| **S04** | `tests/unit/import-file-metadata-defer.test.ts` (audio confirmado antes de decodificar portada/letras; fallo de portada/letras no revierte audio); `tests/unit/local-source-transport.test.ts` (caché `physicalSources`, verificación rápida solo para asset recién sellado vs re-hash completo en restauración/reapertura/corrupción); `tests/integration/check-playlist-full-download-main.mjs` (`first-sound`, `first-sound-direct`) + regresión `artwork`/`lyrics` | U / B / D | Reducción real de tiempo toque→`playing` (M1a/M1b/M1c), portada/letras guardadas sin bloquear audio ni perder avisos, detección intacta de corrupción externa. |
| **S05** | `tests/unit/ordered-bot-acquisition.test.ts` (salto inmediato Bot 1 → Bot 2, espera ≥1.000 ms al mismo bot incluso tras cambio de `providerRef` con mismo `username`); `tests/integration/check-playlist-full-download-main.mjs` (`turnaround/pacing`) | U / B | `betweenSearchesMs < 250 ms` entre bots distintos y ≥1.000 ms hacia el mismo bot. |
| **S06** | `tests/unit/automatic-update.test.ts` (omisión de `/latest.json` dentro de 60 s de `current`; re-comprobación tras ≥60 s, `online`, `visible` o fallo previo; traspasos `update-*` intactos); `tests/integration/check-playlist-resume-main.mjs` (todos los casos `update-*`) | U / B | Eliminación del RTT bloqueante en sesión reciente sin romper ninguna actualización previa a descarga. |
| **S07** | `tests/unit/early-audio-tags.test.ts` (ID3v2.3/v2.4 UTF-8, Latin-1 español, UTF-16 BOM, APIC grande fail-open, título compuesto, `recordingTitleCandidate`, MP4 faststart, MP4 `moov` al final con `aART`, reutilización del último bloque sin doble descarga y **pico de 4 solicitudes concurrentes**, WAV fail-open); `tests/unit/ordered-bot-driver.test.ts` (`file-tag-mismatch` en `classifyBatchFailure` Fila 7, menú retenido en lote y en búsqueda individual Q19, `health` penalizado sin confundir con `file-unsupported`, nunca `not-found`); `tests/integration/check-playlist-full-download-main.mjs` (`turnaround/tags-compound`, `tags-unrelated`, `tags-tail`, `tags-mp3`, `unsupported-format`) | U / B | Rechazo temprano ≤5 chunks en 8 MiB, 0 falsos rechazos, concurrencia 4 intacta en M4A válido, integración limpia con T24 Q15/Q16/Q19. |
| **S08** | `tests/unit/bot-callback-history.test.ts` y `bot-audio-download.test.ts` (edición del menú, audio vecino previo excluido, mensaje concurrente detectado, conteo exacto de `getHistory`) | U / B | Menor conteo de RPC sin pérdida de correlación ni aceptación de audios previos. |
| **S09** | `tests/unit/library-download.test.ts` (solapamiento `save(i)` + `search(i+1)`, cancelación en medio del solapamiento, fallo de metadatos de `save(i)`, recuperación con checkpoint en `i`); `tests/integration/check-playlist-full-download-main.mjs` (`benchmark` 30×300, `full`, `resume`, `queue-cancel`) | U / B | `search(i+1)` arranca antes del fin de `save(i)`, 1 solo carril de red, checkpoint íntegro y 30/30 SHA-256. |
| **S10** | `tests/unit/saved-session.test.ts` y `bot-search-driver.test.ts` (hit con 1 `getMessages`, renovación `fileReference`, miss por mensaje borrado/editado/bot desactivado limpia entrada y cae al flujo normal en 1 intento, purga atómica en logout/cambio de `lease`); `tests/integration/check-playlist-full-download-main.mjs` (`reuse-after-remove`) | U / B / T | 0 `sendMessage`/0 `callback` en re-descarga hit, 0 fugas fuera del worker, 0 bucles. |
| **S11** | Ejecución en Chromium y WebKit de `first-sound`, `first-sound-direct`, `benchmark` (2 y 30×300), `turnaround` completo y `queue` completo (verificando `heldReadMs` acotado y 30/30) | B | Medición comparativa reproducible contra `086aaac` con recibos compactos y limpieza de `.local/tmp/`. |
| **S12** | Revisión de `docs/BOT-DOWNLOADS.md`, `docs/BOT-SEARCH-DIAGNOSTICS.md` y matriz de interfaz (`check-download-feedback.mjs`, comparación UI v60) | R / B | Documentación exacta y cero regresiones de UI/botones. |
| **J01** | Suite completa de T24: `tests/unit/ordered-bot-driver.test.ts`, `ordered-bot-acquisition.test.ts`, `session-bot-search-client.test.ts`, `collection-download-queue.test.ts`, `library-download.test.ts`, `album-acquisition-completion.test.ts`; `check-playlist-full-download-main.mjs` (54/54 × 2 motores) y `check-playlist-resume-main.mjs` (46/46 × 2 motores) | U / B | 0 regresiones en `Q01–Q19` e `I01–I08`. |
| **J02** | `tests/unit/bot-search-driver.test.ts` (ráfaga wakeup ≥125 ms, topes 19/63), `ordered-bot-acquisition.test.ts` (≥1.000 ms mismo bot, 1 carril), `check-playlist-full-download-main.mjs` (`flood`, `pacing`, `long-cooldown`) | U / B / T | Sin paralelismo de consultas ni violación de cooldown/flood. |
| **J03** | `tests/unit/bot-wakeup-update.test.ts`, `bot-audio-download.test.ts` (edición tras bytes), `early-audio-tags.test.ts` (fail-open), `check-playlist-full-download-main.mjs` (`wrong-*`, `tags-compound`, `tags-unrelated`, `tags-tail`, verificación SHA-256) | U / B | 0 audios equivocados reproducidos o publicados; 0 falsos rechazos. |
| **J04** | `tests/unit/ordered-bot-acquisition.test.ts` y `ordered-bot-driver.test.ts` (combinaciones `file-tag-mismatch` + `no-results`, `file-unsupported` + `no-results`, `needs-start` + `no-results`); `check-playlist-full-download-main.mjs` (`missing`, `queue-*-bot-*`) | U / B | «No existe en tus bots» sólo cuando todos los bots confirman ausencia explícita. |
| **J05** | `tests/unit/asset-reader-legacy.test.ts`, `database-realm-protocol.test.ts`; `tests/browser/opfs.ts`; actualización SW `old → new` (v60 → candidato) sin `skipWaiting`; pruebas de corte/recuperación y `pagehide`/logout | U / B | Compatibilidad SW/IDB/OPFS intacta, worker limpio al perder control, copias conservadas. |
| **J06** | `tests/unit/bot-wakeup-update.test.ts`, `bot-search-protocol.test.ts`, `saved-session.test.ts` (inspección de DTOs, `pulso-web-local-v1` y diagnósticos exportables) | U / B | 0 IDs de Telegram o payloads crudos fuera del worker. |
| **J07** | Revisión estática de dependencias/diff y CSP en `check-playlist-full-download-main.mjs` (`external.size === 0`, 0 APIs prohibidas, 0 costes) | R / B | USD 0 y cumplimiento estricto de `doc/SPEC.md:581`. |
| **J08** | `tests/integration/check-download-feedback.mjs` (5/5 × 2 motores) y comparación de interfaz frente a v60 | B | Mismo nivel de accesibilidad/UI, 0 botones por canción, dock autoocultable. |

---

## Plan resumido de incrementos (ordenados por ganancia y riesgo)

El detalle de cada incremento, archivos y relación con `perf/faster-bot-pipeline` está en `.local/research/speed-odd/inventario-y-plan.md`.

| Orden | Incremento | Requisitos | Ganancia estimada (1.er sonido / lote 30) | Riesgo | Base de `perf/faster-bot-pipeline` |
|---|---|---|---|---|---|
| **Inc. 1** | **Wakeup MTProto + reutilizar audio del callback** | S01, S02, S11 (parcial) | **~0,75–1,4 s** en 1.er sonido / **~22–42 s** en 30 pistas (−1 `getMessages` y −2 a 6 `getHistory` vacíos por pista) | **Muy bajo** (no toca `ordered-bot-acquisition.ts`, IDB, OPFS ni SW) | Conservar/rebasar `c69e9b9`, `7113b4b`, `bf992b6` |
| **Inc. 2** | **Camino local ligero al primer sonido y refresco incremental** | S03, S04, S06, S11, S12 | **~0,6–2,2 s** en 1.er sonido (crece con biblioteca) / **~15–60 s** en 30 pistas sobre 300 copias | **Bajo** (requiere prueba estricta de lifecycle del worker, purga y re-hash en reapertura) | Rehacer `9e51656` + añadir OPFS 512 KiB verify, diferir portada/letras, optimizar `transport.ts` y amortiguar `/latest.json` |
| **Inc. 3** | **Reloj de espaciado por bot (`remoteClock`)** | S05, S11 | **0 s** en 1.er bot (individual ya sin reloj) / **~0,8–1,0 s** por salto a respaldo (**~3–10 s** en lotes con fallback) | **Muy bajo** | Conservar/rebasar `caab363`, `be96a07` |
| **Inc. 4** | **Rechazo temprano *fail-open* de etiquetas ajenas** | S07, S11, S12 | **0 s** en archivo bueno / **~2,5–8 s** por candidato ajeno (**~10–45 s** en lotes con falsos positivos; ≥45 % menos bytes en rechazos) | **Bajo-medio** (integrar con `BotSearchFileError`/T24 Q15/Q19, arreglar concurrencia 4 en MP4 tail y soportar UTF-16/Latin-1) | Rehacer `3e02267` + reaplicar pruebas `38029cb`/`bdcf555` |
| **Inc. 5** | **Poda de `getHistory(1)` pre-callback + solapamiento `save(i)`/`search(i+1)` en lotes** | S08, S09 | **~0,2–0,4 s** en 1.er sonido / **~15–35 s** adicionales en playlists largas | **Medio** (acoplamiento `control.activity`, checkpoint y RAM Safari iOS) | Trabajo nuevo (no presente en la rama `perf`) |
| **Inc. 6** *(opcional)* | **Localizadores worker-privados `bot-locators-v1`** | S10 | **0 s** en canción nueva / **~2,5–7 s** por canción en re-descarga o reparación | **Bajo-medio** (migración v2 de IDB del worker y purga atómica en logout) | Trabajo nuevo (no presente en la rama `perf`) |

---

## Límites y pendientes

1. **Aceptación física en iPhone (`D`) — NO EJECUTADA:** las 16 pruebas de `docs/IPHONE-ACEPTACION.md` siguen **NO EJECUTADAS**. Ningún incremento de velocidad puede cerrar ni declarar aceptadas `C1–C7` o `D1–D4` en iPhone real sin la observación del propietario (modelo declarado: iPhone 13 con iOS 27).
2. **Telegram real (`T`) — NO EJECUTADO:** el arnés local usa respuestas y latencias sintéticas. Los tiempos reales de respuesta de `@ivkmbot`, `@lydbot`, `@ansmusicbot`, `@kdmusic_bot` y `@deezermusicbot` (típicamente 3–8 s) son externos a Pulso y no pueden acortarse desde el cliente; T25 elimina exclusivamente los retardos propios de Pulso (polling ciego, RTTs redundantes, bloqueos locales y descargas completas de candidatos ajenos).
3. **WebKit desktop (WPE) vs Safari iOS:** en escritorio WPE no abre escritor OPFS (`T11-T12-lotes-locales.md:759`) y utiliza fallback IDB; el rendimiento real de OPFS con bloques de 512 KiB en Safari iOS permanece **NO CONFIRMADO EN DISPOSITIVO**.
4. **Pendientes heredados de v60 fuera de T25:** `Q09b` (recuperación automática de control tras BFCache), Menor 1 de revisión 8 (una ronda adicional acotada de reconexión tras recuperación en pista previa) y Menor 2 de revisión 8 (temporizador de 120 s de menú retenido en canción individual tras `file-invalid`/`file-too-large`).
5. **Estado de memoria Engram en esta inspección de solo lectura:** `python3 scripts/sync_odd_memory.py --read-only` devolvió `Receipt/source mismatch` únicamente en `odd/tasks/T7-portadas-metadata.md` (recibo `06d417bdb908` frente a disco `034c0485df0f` en `fix/album-tap-save-queue`), divergencia esperada por la sincronización posterior de la rama activa `fix/artwork-rows-dock` sobre la base compartida `.local/engram/` (`docs/PENDIENTES.md:32`). No se modificó ni sobrescribió la memoria en esta tarea de solo lectura.

---

## Incremento 1 · Avisos de MTProto y mensaje del callback

Base de producto `086aaac`. Implementación `75ed228`, actualización del arnés `90aae8f` y tratamiento del borrado `4926e72` en `perf/t25-inc1`.

- S01 escucha avisos sólo mientras una búsqueda o un callback ocupa el carril del bot. El aviso válido es booleano para el driver. El historial conserva la autoridad sobre los mensajes, y el suelo de 125 ms se calcula desde el inicio de la última lectura. Se conserva el sondeo de respaldo y se retira el oyente al cancelar, liquidar o empezar la transferencia.
- S02 reconstruye y valida la referencia exacta sobre la página de historial que entregó el audio del callback. Conserva la relectura del menú antes del callback y la del audio tras recibir los bytes. El menú pasa de tres a dos llamadas `getMessages`. Una relectura post-transferencia que devuelve el `messageEmpty` del ID exacto bloquea la entrega con `conflict`; la base bloqueaba con `unsupported` ante esa respuesta.
- Cambios de producto en `src/telegram/temporary-sdk.ts`, `src/telegram/bot-wakeup-update.ts`, `src/telegram/bot-search-driver.ts` y `src/telegram/bot-search-page.ts`. Se adaptaron `c69e9b9`, `7113b4b` y `bf992b6`; el arnés de lotes tomó como referencia `38029cb`.
- La aceptación con Telegram real (T) y las 16 pruebas físicas de iPhone (D) siguen **NO EJECUTADAS**.

### Reproducción de las mediciones

Se usaron Chromium y WebKit de escritorio en el mismo host, con las mismas fixtures en ambos árboles. El arnés emite avisos sintéticos desde el worker al quedar lista la respuesta y suma cada RPC en ese límite. El RTT sintético es de 200 ms. El primer sonido se mide desde el toque hasta `playing`, confirmado con avance de `currentTime`. Los perfiles de 300 copias siembran MP3 existentes y verifican el número de assets antes y después. En cada muestra válida se verifica el audio nuevo por longitud y SHA-256 de los bytes persistidos.

```sh
PLAYLIST_FULL_ENGINE=chromium PLAYLIST_FULL_MODE=first-sound,first-sound-direct,benchmark \
  PLAYLIST_SPEED_FILTER=first-sound:opfs:400:1,first-sound:opfs:1200:1,first-sound:idb:1200:1,first-sound-direct:opfs:400:1,benchmark:opfs:400:2,benchmark:idb:400:2 \
  PLAYLIST_SPEED_REPEATS=3 node tests/integration/check-playlist-full-download-main.mjs
PLAYLIST_FULL_ENGINE=webkit PLAYLIST_FULL_MODE=first-sound,first-sound-direct,benchmark \
  PLAYLIST_SPEED_FILTER=first-sound:opfs:400:1,first-sound:opfs:1200:1,first-sound-direct:opfs:400:1,benchmark:opfs:400:2 \
  PLAYLIST_SPEED_REPEATS=2 node tests/integration/check-playlist-full-download-main.mjs
PLAYLIST_FULL_MODE=benchmark PLAYLIST_SPEED_FILTER=benchmark:opfs:400:30 PLAYLIST_SPEED_REPEATS=3 \
  node tests/integration/check-playlist-full-download-main.mjs
PLAYLIST_FULL_MODE=regression node tests/integration/check-playlist-full-download-main.mjs
node tests/integration/check-playlist-resume-main.mjs
node tests/integration/check-download-feedback.mjs
```

Para medir v60 se copian al snapshot de `086aaac` sólo `check-playlist-full-download-main.mjs` y `playlist-full-download-sdk.ts` del candidato. Los perfiles se cierran tras cada caso; los bundles y perfiles temporales pertenecen a `.local/tmp/t25-inc1-*/`. Los recibos compactos están en `.local/test-evidence/t25-inc1/`.

### Mediciones comparables en Chromium

Chromium 154 y Playwright 1.64.1. Las series válidas se midieron sobre `75ed228` con la instrumentación de `90aae8f`, antes de acotar la clasificación del mensaje borrado en `4926e72`. Se presentan las medianas y p90 de las muestras por pista, con rango observado. En primer sonido hay una muestra por corrida. En lotes se acumulan las pistas de las tres corridas. Las RPC totales incluyen resolución de bot cuando se necesitó y los fragmentos del archivo; «historial» suma las lecturas de 1 y 20 mensajes.

| Escenario | Motor y backend pedido | Bot (ms) | Corridas base/candidato | v60, mediana / p90 [mín–máx] (ms) | Candidato, mediana / p90 [mín–máx] (ms) | Variación de mediana | RPC/pista v60 (mensajes / historial / total) | RPC/pista candidato (mensajes / historial / total) |
| --- | --- | ---: | ---: | --- | --- | ---: | --- | --- |
| first-sound | chromium, opfs | 400 | 3/3 | 13918.0 / 18817.0 [8936.0–18817.0] | 11211.0 / 12798.0 [11209.0–12798.0] | -19.4 % | 3 / 4 / 26 | 2 / 4 / 25 |
| first-sound-direct | chromium, opfs | 400 | 3/3 | 4892.0 / 5004.0 [2860.0–5004.0] | 4516.0 / 4999.0 [4314.0–4999.0] | -7.7 % | 2 / 2 / 7 | 2 / 2 / 7 |
| first-sound | chromium, idb | 1200 | 3/3 | 12214.0 / 12497.0 [10759.0–12497.0] | 11195.0 / 11703.0 [9893.0–11703.0] | -8.3 % | 3 / 8 / 30 | 2 / 8 / 29 |
| first-sound | chromium, opfs | 1200 | 3/3 | 18920.0 / 19296.0 [17391.0–19296.0] | 13691.0 / 14289.0 [13017.0–14289.0] | -27.6 % | 3 / 8 / 30 | 2 / 8 / 29 |
| Lote 2 | chromium, idb | 400 | 3/3 | 6954.0 / 9910.0 [6025.0–9910.0] | 5711.5 / 8497.0 [4999.0–8497.0] | -17.9 % | 3 / 4 / 25.5 | 2 / 4 / 24.5 |
| Lote 2 | chromium, opfs | 400 | 3/3 | 6361.5 / 9582.0 [5124.0–9582.0] | 12460.5 / 42410.0 [8823.0–42410.0] | +95.9 % | 3 / 4 / 25.5 | 2 / 4 / 24.5 |
| Lote 30 | chromium, opfs | 400 | 3/3 | 6791.5 / 8398.0 [4811.0–10594.0] | 5960.5 / 7420.0 [4101.0–10402.0] | -12.2 % | 3 / 4 / 25.0333 | 2 / 4 / 24.0333 |

- Lote 30, chromium, base. Total en ms por corrida 208454, 193183, 213799. 90/90 copias por longitud y SHA-256.
- Lote 30, chromium, head. Total en ms por corrida 171669, 187246, 182600. 90/90 copias por longitud y SHA-256.

- first-sound chromium opfs 400 ms ×1, base. searchReads 1, callbackReads 1, searchPollMs 486, callbackPollMs 452, transferMs 925, analysisMs 23, writeMs 2411, verifyMs 2099, metadataMs 100, refreshMs 518, waitMs 0.
- first-sound chromium opfs 400 ms ×1, head. searchReads 1, callbackReads 1, searchPollMs 484, callbackPollMs 484, transferMs 1312, analysisMs 99, writeMs 1682, verifyMs 1319, metadataMs 11, refreshMs 312, waitMs 0.
- first-sound chromium idb 1200 ms ×1, base. searchReads 3, callbackReads 3, searchPollMs 1562, callbackPollMs 1537, transferMs 1501, analysisMs 97, writeMs 607, verifyMs 676, metadataMs 23, refreshMs 613, waitMs 0.
- first-sound chromium idb 1200 ms ×1, head. searchReads 3, callbackReads 3, searchPollMs 1403, callbackPollMs 1403, transferMs 1391, analysisMs 82, writeMs 310, verifyMs 601, metadataMs 15, refreshMs 419, waitMs 0.
- first-sound chromium opfs 1200 ms ×1, base. searchReads 3, callbackReads 3, searchPollMs 1598, callbackPollMs 1589, transferMs 1503, analysisMs 180, writeMs 2497, verifyMs 1996, metadataMs 99, refreshMs 701, waitMs 0.
- first-sound chromium opfs 1200 ms ×1, head. searchReads 3, callbackReads 3, searchPollMs 1402, callbackPollMs 1402, transferMs 1307, analysisMs 99, writeMs 1695, verifyMs 1315, metadataMs 14, refreshMs 313, waitMs 0.
- benchmark chromium opfs 400 ms ×30, base. searchReads 1, callbackReads 1, searchPollMs 461.5, callbackPollMs 482, transferMs 1018, analysisMs 113, writeMs 1050, verifyMs 992.5, metadataMs 71, refreshMs 480, waitMs 0.
- benchmark chromium opfs 400 ms ×30, head. searchReads 1, callbackReads 1, searchPollMs 469.5, callbackPollMs 480.5, transferMs 953.5, analysisMs 93.5, writeMs 802, verifyMs 792, metadataMs 12.5, refreshMs 400.5, waitMs 0.

El ahorro estable es una llamada `getMessages` por pista de menú. En estos retardos del bot no cayó el número de lecturas de historial. Con 1.200 ms, el aviso redujo el tiempo de sondeo de ambas fases, aunque las dos versiones hicieron tres lecturas por fase. Con 400 ms, ambas completaron las fases con una sola lectura. En la ruta directa se mantuvo el conteo.

El lote de 30 ahorró 25,85 s en mediana del total de la corrida y 12,2 % en mediana por pista. La mejora de latencia no fue uniforme. El lote corto en Chromium OPFS empeoró 95,9 % en mediana, con p90 de 42,41 s. Los tiempos de transferencia, escritura y verificación variaron entre corridas en el host compartido. Las mediciones conservan esa dispersión completa.

### Confirmación en Chromium con el código final

Se repitió la serie completa de Chromium tras `4926e72`, con las mismas fixtures y la línea base de v60 arriba. La medición inicial se conserva para mostrar su dispersión. En esta repetición se confirmó una lectura `getMessages` menos en cada pista de menú. La reducción de tiempo del lote de 30 de la primera serie no se reprodujo: la mediana por pista sólo cayó 2,0 % y la del total 2,34 s.

| Escenario | Motor y backend pedido | Bot (ms) | Corridas base/candidato | v60, mediana / p90 [mín–máx] (ms) | Candidato, mediana / p90 [mín–máx] (ms) | Variación de mediana | RPC/pista v60 (mensajes / historial / total) | RPC/pista candidato (mensajes / historial / total) |
| --- | --- | ---: | ---: | --- | --- | ---: | --- | --- |
| first-sound | chromium, opfs | 400 | 3/3 | 13918.0 / 18817.0 [8936.0–18817.0] | 10260.0 / 11814.0 [7601.0–11814.0] | -26.3 % | 3 / 4 / 26 | 2 / 4 / 25 |
| first-sound-direct | chromium, opfs | 400 | 3/3 | 4892.0 / 5004.0 [2860.0–5004.0] | 4999.0 / 5394.0 [4406.0–5394.0] | +2.2 % | 2 / 2 / 7 | 2 / 2 / 7 |
| first-sound | chromium, idb | 1200 | 3/3 | 12214.0 / 12497.0 [10759.0–12497.0] | 9899.0 / 10113.0 [9687.0–10113.0] | -19.0 % | 3 / 8 / 30 | 2 / 8 / 29 |
| first-sound | chromium, opfs | 1200 | 3/3 | 18920.0 / 19296.0 [17391.0–19296.0] | 13091.0 / 13813.0 [13090.0–13813.0] | -30.8 % | 3 / 8 / 30 | 2 / 8 / 29 |
| Lote 2 | chromium, idb | 400 | 3/3 | 6954.0 / 9910.0 [6025.0–9910.0] | 4855.0 / 5083.0 [4113.0–5083.0] | -30.2 % | 3 / 4 / 25.5 | 2 / 4 / 24.5 |
| Lote 2 | chromium, opfs | 400 | 3/3 | 6361.5 / 9582.0 [5124.0–9582.0] | 5641.5 / 6789.0 [4206.0–6789.0] | -11.3 % | 3 / 4 / 25.5 | 2 / 4 / 24.5 |
| Lote 30 | chromium, opfs | 400 | 3/3 | 6791.5 / 8398.0 [4811.0–10594.0] | 6657.0 / 7814.0 [4398.0–9213.0] | -2.0 % | 3 / 4 / 25.0333 | 2 / 4 / 24.0333 |

- Lote 30, chromium, base. Total en ms por corrida 208454, 193183, 213799. 90/90 copias por longitud y SHA-256.
- Lote 30, chromium, head. Total en ms por corrida 188361, 206118, 206793. 90/90 copias por longitud y SHA-256.

- first-sound chromium opfs 400 ms ×1, base. searchReads 1, callbackReads 1, searchPollMs 486, callbackPollMs 452, transferMs 925, analysisMs 23, writeMs 2411, verifyMs 2099, metadataMs 100, refreshMs 518, waitMs 0.
- first-sound chromium opfs 400 ms ×1, head. searchReads 1, callbackReads 1, searchPollMs 454, callbackPollMs 496, transferMs 1205, analysisMs 95, writeMs 1415, verifyMs 1003, metadataMs 89, refreshMs 300, waitMs 0.
- first-sound chromium idb 1200 ms ×1, base. searchReads 3, callbackReads 3, searchPollMs 1562, callbackPollMs 1537, transferMs 1501, analysisMs 97, writeMs 607, verifyMs 676, metadataMs 23, refreshMs 613, waitMs 0.
- first-sound chromium idb 1200 ms ×1, head. searchReads 3, callbackReads 3, searchPollMs 1404, callbackPollMs 1402, transferMs 1201, analysisMs 92, writeMs 301, verifyMs 599, metadataMs 84, refreshMs 288, waitMs 0.
- first-sound chromium opfs 1200 ms ×1, base. searchReads 3, callbackReads 3, searchPollMs 1598, callbackPollMs 1589, transferMs 1503, analysisMs 180, writeMs 2497, verifyMs 1996, metadataMs 99, refreshMs 701, waitMs 0.
- first-sound chromium opfs 1200 ms ×1, head. searchReads 3, callbackReads 3, searchPollMs 1403, callbackPollMs 1402, transferMs 1218, analysisMs 85, writeMs 1298, verifyMs 1299, metadataMs 12, refreshMs 520, waitMs 0.
- benchmark chromium opfs 400 ms ×30, base. searchReads 1, callbackReads 1, searchPollMs 461.5, callbackPollMs 482, transferMs 1018, analysisMs 113, writeMs 1050, verifyMs 992.5, metadataMs 71, refreshMs 480, waitMs 0.
- benchmark chromium opfs 400 ms ×30, head. searchReads 1, callbackReads 1, searchPollMs 482, callbackPollMs 484, transferMs 1029, analysisMs 186.5, writeMs 1095, verifyMs 993.5, metadataMs 42.5, refreshMs 500.5, waitMs 0.

### Mediciones diagnósticas en WebKit

WPE no llegó a abrir la biblioteca de prueba con el controlador SW activo. Se repitió con el modo local Blob del arnés y el almacenamiento efectivo fue IndexedDB. Las filas muestran las corridas con SHA-256 y longitud verificados para todas las copias, aunque cada una salió con **FAIL** por la infracción heredada `style-src-attr` en ambos árboles. La segunda corrida de primer sonido directo del candidato agotó 60 s sin confirmar `playing` y quedó fuera de la tabla. Las series cortas del candidato preceden a `4926e72`; el lote de 30 ya incluye ese commit.

| Escenario | Motor y backend pedido | Bot (ms) | Corridas base/candidato | v60, mediana / p90 [mín–máx] (ms) | Candidato, mediana / p90 [mín–máx] (ms) | Variación de mediana | RPC/pista v60 (mensajes / historial / total) | RPC/pista candidato (mensajes / historial / total) |
| --- | --- | ---: | ---: | --- | --- | ---: | --- | --- |
| first-sound | webkit, opfs → idb | 400 | 2/2 | 11535.5 / 12116.0 [10955.0–12116.0] | 15173.0 / 17689.0 [12657.0–17689.0] | +31.5 % | 3 / 4 / 26 | 2 / 4 / 25 |
| first-sound-direct | webkit, opfs → idb | 400 | 2/1 | 8767.5 / 8805.0 [8730.0–8805.0] | 8988.0 / 8988.0 [8988.0–8988.0] | +2.5 % | 2 / 2 / 7 | 2 / 2 / 7 |
| first-sound | webkit, opfs → idb | 1200 | 2/2 | 16829.5 / 17989.0 [15670.0–17989.0] | 13326.0 / 13754.0 [12898.0–13754.0] | -20.8 % | 3 / 8 / 30 | 2 / 8 / 29 |
| Lote 2 | webkit, opfs → idb | 400 | 2/2 | 5255.5 / 6766.0 [4884.0–6766.0] | 4606.5 / 5997.0 [4293.0–5997.0] | -12.3 % | 3 / 4 / 25.5 | 2 / 4 / 24.5 |
| Lote 30 | webkit, opfs → idb | 400 | 3/3 | 5426.0 / 6894.0 [4105.0–8601.0] | 5794.0 / 7201.0 [3809.0–9508.0] | +6.8 % | 3 / 4 / 25.0333 | 2 / 4 / 24.0333 |

- Lote 30, webkit, base. Total en ms por corrida 151719, 181012, 164997. 90/90 copias por longitud y SHA-256.
- Lote 30, webkit, head. Total en ms por corrida 169611, 175125, 175880. 90/90 copias por longitud y SHA-256.

- first-sound webkit opfs 400 ms ×1, base. searchReads 1, callbackReads 1, searchPollMs 454, callbackPollMs 461, transferMs 931, analysisMs 259, writeMs 645, verifyMs 414, metadataMs 136.5, refreshMs 196, waitMs 0.
- first-sound webkit opfs 400 ms ×1, head. searchReads 1, callbackReads 1, searchPollMs 467.5, callbackPollMs 470.5, transferMs 1029.5, analysisMs 637.5, writeMs 1556, verifyMs 1020, metadataMs 136, refreshMs 291, waitMs 0.
- first-sound webkit opfs 1200 ms ×1, base. searchReads 3, callbackReads 3, searchPollMs 1580, callbackPollMs 1590, transferMs 1007, analysisMs 304, writeMs 1957.5, verifyMs 688.5, metadataMs 103, refreshMs 403.5, waitMs 0.
- first-sound webkit opfs 1200 ms ×1, head. searchReads 3, callbackReads 3, searchPollMs 1403.5, callbackPollMs 1403, transferMs 935.5, analysisMs 141, writeMs 646, verifyMs 269.5, metadataMs 76.5, refreshMs 152.5, waitMs 0.
- benchmark webkit opfs 400 ms ×30, base. searchReads 1, callbackReads 1, searchPollMs 467, callbackPollMs 452, transferMs 858.5, analysisMs 289.5, writeMs 580, verifyMs 314, metadataMs 78.5, refreshMs 208, waitMs 0.
- benchmark webkit opfs 400 ms ×30, head. searchReads 1, callbackReads 1, searchPollMs 481, callbackPollMs 483, transferMs 909.5, analysisMs 316, writeMs 609, verifyMs 484.5, metadataMs 88.5, refreshMs 294, waitMs 0.

### Trazabilidad del incremento

El rojo de S01/S02 sobre `086aaac` obtuvo 64 PASS y 15 FAIL con las aserciones nuevas. El caso adicional de borrado también dio rojo en v60. La batería focalizada inicial obtuvo 79/79 en el candidato. Las 227 pruebas unitarias de regresión y guardas asociadas pasaron en ambos árboles. La batería final de unitarias pasó 1.035/1.035, junto con tipos de app y pruebas, lint, build, 73/73 pruebas de servidor y 10/10 pruebas de Python. Una primera corrida paralela de unitarias dio 1.032/1.033 por una aserción de latencia de letras. Las repeticiones en serie pasaron sin modificar ese código.

| ID | Prueba y nivel | Base `086aaac` | Candidato |
| --- | --- | --- | --- |
| S01, J03, J06 | U · `bot-wakeup-update`: tipos, peer/sender exacto, canal, salida, límite de 64 y getters | FAIL esperado, falta el filtro | PASS |
| S01, J02 | U · `bot-search-driver`: aviso antes del ACK, diez avisos con suelo de 125 ms, cancelación y tope de 19 | FAIL esperado en los 3 casos nuevos | PASS 3/3 |
| S01, J02 | U · `bot-search-driver`: respaldo sin avisos (250/250/400/700/1000 ms), presupuesto y cooldown tardío | PASS | PASS |
| S01, J02 | U · `bot-callback-history`: aviso antes del ACK para la edición exacta y tope de 63 con avisos persistentes | FAIL esperado en los 2 casos nuevos | PASS 2/2 |
| S02, J03 | U · `ans-audio-download`, `kd-audio-download`, `lyd-audio-download`: dos relecturas exactas en menú | FAIL esperado 0/3, las tres suites observan 3 RPC en menú | PASS 3/3 |
| S02, J03 | U · `bot-audio-download`: presupuesto, elección exacta, duración, opción compatible y conflicto tras la transferencia | FAIL esperado 0/5 en las aserciones nuevas | PASS 5/5 |
| S02, J03 | U · `bot-audio-download`: el ID de audio exacto devuelve `messageEmpty` después de la transferencia | FAIL esperado, bloquea con `unsupported` | PASS, bloquea con `conflict` |
| S02, J03 | U · `bot-callback-history`: edición del menú, exclusión de audio previo y peer ajeno | La edición devuelve el audio y falla la aserción de 2 RPC. Las guardas previas pasan | PASS |
| S02, J01, J02, J04 | U · `ordered-bot-driver`, `ordered-bot-acquisition`, `session-bot-search-client`, `collection-download-queue`, `library-download`, `album-acquisition-completion`: Q11–Q19, carril único, espera de 1.000 ms, errores de canal y ausencia confirmada | PASS | PASS |
| J03, J05, J06 | U · `bot-download-bytes`, `database-realm-protocol`, `bot-search-protocol` y `saved-session`: verificación de bytes, autoridad y DTOs | PASS | PASS |
| J06, J07 | R · Diff de dependencias, SW y DTOs. Aviso filtrado dentro de `TemporarySdk`; el driver recibe sólo la señal | PASS | PASS |
| J08 | B · `check-download-feedback` (foco, posición, arrastre, autoocultado y cancelación del dock) | Chromium 5/5, WebKit 5/5 | Chromium 5/5, WebKit 5/5 |
| J01, J08 | B · `tap-baseline` en `7d41d25` | PASS 2/2 en `7d41d25`, reproduce el bloqueo histórico | Aplica únicamente a `7d41d25` |
| J08 | B · `check-interface-main` | 11/12 por motor en la repetición. Minirreproductor al 200 % con movimiento reducido | 11/12 por motor; mismo escenario conocido de minirreproductor a 200 % con movimiento reducido |
| S01, J02, J03 | T · Telegram real y cooldown real | NO EJECUTADO | NO EJECUTADO |
| J01, J05, J08 | D · Aceptación física de `docs/IPHONE-ACEPTACION.md` | NO EJECUTADA | NO EJECUTADA |

### Estado de la validación

El gate completo quedó fallido. WebKit registró la infracción CSP heredada en las corridas de velocidad y un timeout de audio directo del candidato. El reintento reprodujo el audio y la infracción CSP. V60 reprodujo además un timeout de `update-startup` en Chromium. El caso de minirreproductor al 200 % coincidió con la excepción conocida.

El primer acceso a la memoria compartida agotó el tiempo de espera del MCP. La lectura de una copia SQLite de proyecto detectó una sola divergencia conocida en `T7-portadas-metadata.md`: el recibo `06d417bdb908` corresponde a `83e2c79` y v60 conserva `034c0485df0f`. Se usa la copia de proyecto en el presente worktree para conservar el recibo del otro árbol.

### Comparación de navegador y cierre del incremento

| ID | Prueba y nivel | Base `086aaac` | Candidato con `4926e72` |
| --- | --- | --- | --- |
| S01, S02, S11, J03 | B · `first-sound`, `first-sound-direct` y `benchmark` con Telegram sintético | Chromium 21/21 muestras comparables. WebKit 0/11 en el gate CSP, con 90/90 copias verificadas en el lote de 30 | Chromium 21/21 en la serie de confirmación. WebKit 0/11 en el gate de velocidad, con 90/90 copias verificadas en el lote de 30 |
| J01 | B · `check-playlist-full-download-main.mjs`, modo `regression`, 54 modos y 61 casos efectivos por motor con las tres corridas completas y los escenarios de `turnaround` | Chromium 61/61, WebKit 61/61 | Chromium 61/61, WebKit 61/61 |
| J01, J05 | B · `check-playlist-resume-main.mjs`, incluidos cambios de versión, recuperación y deduplicación | Chromium 45/46. `update-startup` agotó la espera de navegación en v60. WebKit 46/46 | Chromium 46/46, WebKit 46/46 |
| J02 | B · `full/flood`, espera de tasa, recuperación de transferencia y `long-cooldown` | PASS en ambos motores | PASS en ambos motores |
| J02, J04 | B · `turnaround/callback-timeout` | PASS 2/2 | PASS 2/2 |
| J03 | B · `wrong-live`, `wrong-remix`, `wrong-artist`, `wrong-duration`, `tags-compound` y `tags-unrelated` | PASS en ambos motores | PASS en ambos motores |
| J04 | B · `missing`, `stale-checkpoint` y ocho variantes `queue-*-bot-*` | PASS en ambos motores | PASS en ambos motores |
| J05 | B · `connected` con copia purgada y comparación de SHA-256 en OPFS/IDB local | Copia purgada PASS 2/2. Verificación Chromium PASS y WebKit con el fallo CSP registrado | Copia purgada PASS 2/2. Verificación Chromium PASS y WebKit con el fallo CSP registrado |
| J06 | B · DTO cerrado de tiempos, conteo sintético de RPC y verificación de audio en el worker | PASS en el recorrido instrumentado | PASS en el recorrido instrumentado |
| J07 | B · Consola, CSP y orígenes ajenos en el arnés de velocidad | Chromium PASS. WebKit FAIL, infracción `style-src-attr` conocida, 0 orígenes ajenos | Chromium PASS. WebKit FAIL, misma infracción, 0 orígenes ajenos |
| J08 | B · `tap-active` y comparación de interfaz | `tap-active` PASS 2/2. Interfaz 11/12 por motor, con el mismo fallo conocido | `tap-active` PASS 2/2. Interfaz 11/12 por motor, falla el minirreproductor al 200 % con movimiento reducido |

La repetición de audio directo en WebKit tras `4926e72` consiguió `playing` y verificó 2/2 copias. Observó 12.020 y 13.694 ms, mediana 12.857 ms y p90 13.694 ms. Ambas corridas conservaron el FAIL de CSP. La corrida con timeout queda en el registro.

Los escenarios `pacing` de S05, `tags-tail` de S07 y el ciclo de vida del importador reutilizable de S03 corresponden a incrementos posteriores. Esta comparación ejecuta las pruebas de versiones del arnés de reanudación en cada árbol. El código y layout del Service Worker se conservan en su fuente de v60.

### Limpieza

Se retiraron snapshots, bundles, perfiles interrumpidos y capturas redundantes. El espacio asignado a los artefactos identificados y eliminados fue de 204.816.384 bytes. `/data` tenía 6.100.840.448 bytes libres al inicio, 6.063.239.168 antes de la limpieza final y 6.166.953.984 después. Se conservan los recibos compactos y la memoria local de proyecto.
