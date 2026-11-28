# T35 · Importación de playlists de YouTube en Conexiones (v70)

## Origen y alcance
Integración endurecida de la colaboración **PR #30** (`luisjose1010:feat/youtube-playlist-import`, commit `7a4efd7`) sobre `release/v69`, conservando la autoría del colaborador y las correcciones de rutas Windows (`scripts/telegram-source.mjs`, `.gitattributes`).

**Decisiones expresas del propietario (2026-11-28):**
1. Usar la **YouTube Data API v3** oficial (nivel gratuito 10.000 unidades/día, **USD 0**), sin OAuth de YouTube ni permisos adicionales en el registro/login con Google y sin sincronización automática al iniciar sesión.
2. Ubicar la importación de playlists (Spotify y YouTube) en **Configuración → Conexiones** (no en General ni en el primer login).
3. Autorizar en Cloudflare Workers Free (`pulso-web`) el alta de la ruta `/api/youtube-playlist` en `run_worker_first` (`14 → 15` reglas) y el secreto `YOUTUBE_API_KEY` (`13 → 14` bindings), sin guardar la clave en Git, recibos ni Engram.

## Requisitos
- **U-V70-01 · Importación manual en Configuración → Conexiones:** el importador unificado de playlists (Spotify y YouTube) vive en **Configuración → Conexiones**; nunca importa ni sincroniza automáticamente al iniciar sesión. Admite URLs de Spotify, URLs de YouTube / YouTube Music e IDs sueltos de playlist de YouTube (`type="text"` / `inputMode="url"`). Al importar desde YouTube crea o actualiza la playlist en Biblioteca **sin iniciar descargas automáticas**; en el resultado ofrece «Abrir en Biblioteca» y, si faltan pistas, un botón manual opcional «Descargar faltantes (N)».
- **U-V70-02 · Seguridad y protección de cuota en `/api/youtube-playlist`:** exige `GET`, origen mismo sitio (`Origin` / `Sec-Fetch-Site`), **sesión Pulso autenticada** vía `accountAuth` (`401` anónimo, propagando `Set-Cookie` de refresco), y **rate limit** vía `PULSO_SPOTIFY_LIMIT` por cuenta y por IP (`429` + `Retry-After: 60`) antes de consultar `googleapis.com`. Sin `YOUTUBE_API_KEY` responde `503 not-configured`. Usa `redirect: 'manual'`, lectura JSON acotada (`readBoundedJson`), deadline global + propagación de `request.signal` (máx. 1.500 ítems / 30 páginas), cabeceras de seguridad estándar y nunca expone la clave ni `videoId` ni cuerpos de error crudos.
- **U-V70-03 · Integridad de Biblioteca, reimportación segura y rendimiento IDB:** usa `WRITER_LOCK`, `ACTIVE_LIBRARY_ACCOUNT`, `LIBRARY_LIMITS`, `makeLibraryMembership(track.id, false)`, `duration: 0` compatible con `validateAccountLibrary` (Neon sync) y reutiliza pistas existentes prefiriendo copias disponibles. Precarga alias en lote dentro de IndexedDB (sin bucle de hasta 1.500 lecturas secuenciales). Vincula playlists importadas por `youtubePlaylistId` para actualizar en reimportación **sin sobrescribir una playlist manual** del usuario que coincida solo por nombre.
- **U-V70-04 · Pruebas proporcionales y despliegue controlado:** cobertura unitaria, Cloudflare/Miniflare (`tests/server/youtube-playlist.test.mjs`), navegador Chromium y WebKit (`tests/integration/check-youtube-import.mjs` en `.local/tmp/` con limpieza en `finally`, más actualización de `tests/integration/check-spotify-import.mjs` a `Conexiones`) y comprobación en `scripts/publish-cloudflare.mjs` de `/api/youtube-playlist` anónimo `401` con transición explícita autorizada de reglas (`14 → 15`) y bindings (`13 → 14`).

## Invariantes
Mantener SPEC §W01–W10, USD 0, `T13`/`T16`/`T21`/`T22`/`T23` y privacidad: cero credenciales de usuario hacia Google, cero secretos en Git/Engram/evidencia, cero descargas automáticas sin acción del usuario, cero regresión en Spotify import, álbumes ni sincronización Neon.

## Matriz de trazabilidad
| Requisito | Unitaria / Servidor | Chromium | WebKit |
|---|---|---|---|
| U-V70-01: Conexiones, URL/ID, sin auto-descarga, botón manual faltantes, Spotify intacto | PASS (unitarias y servidor) | PASS (12/12 YouTube; Spotify fixture y borrado) | PASS (12/12 YouTube; Spotify fixture y borrado) |
| U-V70-02: `/api/youtube-playlist` 401 anónimo, 429 rate-limit, 503, oversize, deadline, sin fuga de clave | PASS (88/88 Cloudflare, incluye Miniflare y tope de 30 páginas) | N/A | N/A |
| U-V70-03: IDB en lote, reimportación por `youtubePlaylistId` sin pisar manual, sync Neon válido | PASS (unitarias, incluida `validateAccountLibrary`) | PASS | PASS |
| U-V70-04: `publish-cloudflare.mjs` transición autorizada 15 reglas / 14 bindings y prueba en vivo | PASS: 4/4 grupos sintéticos + publicación Cloudflare (versión 74), HTTPS y verificación en vivo PASS | PASS (en vivo 1280×800 y 390×844) | PASS (matriz pre-publicación) |

## Validación inicial del commit `ffe00c8` · 2026-11-28

- `npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, `npm run build`: PASS.
- `npm run test:unit`: 1.088/1.088 PASS; `npm run test:cloudflare`: 83/83 PASS, incluido el Worker Miniflare; `npm run test:py`: 10/10 PASS.
- `check-youtube-import.mjs`: 12/12 PASS en Chromium y WebKit. `check-spotify-import.mjs`: fixture y borrado PASS en ambos motores.
- `check-settings-design.mjs`: 4/4 PASS en cada motor. `check-v69-album-during-download.mjs`: 2/2 PASS en cada motor.
- `wrangler.jsonc`: 15 reglas, incluida una sola `/api/youtube-playlist`; validación sintáctica de `publish-cloudflare.mjs`: PASS.
- No se hizo despliegue Cloudflare ni comprobación HTTPS en vivo en esta ronda. La aceptación física del propietario sigue pendiente.

Aceptación física iPhone: las 16 pruebas de `docs/IPHONE-ACEPTACION.md` siguen **NO EJECUTADAS** hasta informe del propietario.

## Corrección de los dos hallazgos bloqueantes · commit `f97bd6f` · 2026-11-28

- **Bloqueante #1:** `freeze.json` ahora conserva `beforeRuntimeSha256` con el runtime previo exacto y `runtimeSha256` con el runtime esperado tras `putWorker`. La comprobación inmediatamente anterior a `putWorker` coteja `ready` con el hash previo; `verifyDeployment` coteja el resultado posterior con el hash esperado.
- **Bloqueante #2:** en modo estricto (`addedSecrets.length === 0`) se conservan las igualdades exactas de `prior.deployment` y `prior.version`. En transición con secreto nuevo se exigen ambos IDs intermedios no vacíos y distintos de los IDs previos. `checkBefore` también fija deployment/version, puntero, módulo, reglas previas, bindings declarados y el conjunto exacto de secretos; `verifyDeployment` rechaza que siga activo tanto el deployment intermedio como el previo.
- La entrada CLI quedó protegida por el guard de `import.meta.url`; el módulo se importa desde las pruebas sin activar `main`. Los helpers puros de reglas, bindings, inputs de transición y verificaciones previa/lista/posterior son compartidos por producción y pruebas.
- `tests/server/publish-cloudflare.test.mjs`: **4/4 grupos PASS**, con modo estricto, transición v69 `14 reglas / 13 bindings` → intermedio `14 / 14` → esperado `15 / 14`, regla/secreto extra, secreto ausente e IDs antiguos. La regresión del hash comprueba que `ready` coincide con `beforeRuntimeSha256` y que el estado posterior coincide con `runtimeSha256`.
- `tests/server/youtube-playlist.test.mjs`: regresión de 30 páginas **PASS**; `truncated: true`, 1.500 ítems, 30 llamadas a `/playlistItems` + 1 a `/playlists` (31 Google) + 1 auth = 32 subrequests, bajo el máximo 50 de Workers Free.

## Batería local pre-publicación sobre `f97bd6fd31b2e4cd6936d735c9bbd1243c8bec94`

| Comprobación | Resultado |
|---|---|
| `npm run typecheck`, `typecheck:tests`, `lint`, `build` | PASS |
| `npm run test:unit` | 1.088/1.088 PASS |
| `npm run test:cloudflare` | 88/88 PASS; incluye los 4 grupos nuevos de publicación y el tope de 30 páginas |
| `npm run test:py` | 10/10 PASS |
| `check-youtube-import.mjs` | Chromium 12/12; WebKit 12/12 PASS |
| `check-spotify-import.mjs` | Chromium 2/2; WebKit 2/2 PASS (fixture y borrado; sin consulta pública) |
| `check-settings-design.mjs` | Chromium 4/4; WebKit 4/4 PASS |
| `check-v69-album-during-download.mjs` | Chromium 2/2; WebKit 2/2 PASS |
| `check-v68-continuous-and-album.mjs` | Chromium 12/12; WebKit 12/12 PASS |
| `check-v67-storage-removal.mjs` | Chromium 5/5; WebKit 5/5 PASS |
| `check-v66-polish.mjs` | 4/4 PASS (2 por motor) |
| `check-ux-v65.mjs` | 16/16 PASS (8 por motor) |
| `check-download-feedback.mjs` | Chromium 8/8; WebKit 8/8 PASS |
| `check-persistent-cache-main.mjs` | Chromium 13/13 PASS. En la ejecución conjunta inicial WebKit obtuvo 11/13; C06 `cambio de cuenta y cierre de sesión purgan persistencia` y C02 `desalojo real por cantidad y degradación ante cuota` fallaron. Reejecución focal WebKit: 13/13 PASS. Los 26 casos únicos quedan PASS tras esa reejecución. |
| `check-account-library-main.mjs` | Chromium 6/6; WebKit 6/6 PASS |

Las 11 suites de navegador se ejecutaron en serie (concurrencia máxima 1): 148 casos únicos, 74 Chromium y 74 WebKit; los 148 quedaron PASS tras la reejecución focal de WebKit de caché. La carga de 1 minuto antes de la matriz funcional de caché fue `0,64` (<1,5); antes de la reejecución WebKit fue `1,24` (<1,5).

Como comprobación adicional separada, `check-persistent-cache-main.mjs --measure --wait-load` registró cuatro mediciones (Chromium 1,43; WebKit 1,30 de carga antes de cada motor) y terminó con un timeout de `locator.waitFor` en WebKit antes de registrar casos funcionales. Esa variante de medición no forma parte de la matriz funcional listada arriba; queda anotada como resultado adicional, sin convertirla en PASS.

**Pendiente abierto tras publicación:** las 16 pruebas físicas en iPhone de `docs/IPHONE-ACEPTACION.md` siguen **NO EJECUTADAS** por el propietario. Ninguna prueba local ni de navegador acredita ese gate.

## Revisión independiente, publicación y verificación en vivo · 2026-11-28

- **Revisión independiente inicial (`gemini-4-neon` medio sobre `release/v69..ffe00c8`):** `0` Bloqueantes, `0` Altos y `0` Medios en el código de producto (Worker, cliente, IDB, UI y pruebas); `2` `[Bloqueante]` en `scripts/publish-cloudflare.mjs` (pre/post `runtimeSha256` y despliegue intermedio al subir secreto), corregidos y cubiertos con regresión en `f97bd6f`.
- **Revisión delta independiente (`gemini-4-neon` medio sobre `ffe00c8..09ec2d2`):** `14/14` pruebas servidor PASS, `0` Bloqueantes, `0` Altos, `0` Medios y `2` Bajos menores no bloqueantes — veredicto **`Seguro publicar v70`**.
- **Publicación en Cloudflare Workers Free (`pulso-web`):** entrada `/releases/8343797dc7910080.html` (`307` → `/releases/8343797dc7910080` `200`, meta `8343797dc7910080`), despliegue `17c2ecbe-3256-466d-953e-cb1fa79324d8`, versión `c1f200be-530d-4cec-aca8-8ec548db5840` (**versionNumber 74**, 100 %, `createdAt: 2026-11-28T08:04:00.490411Z`). Worker limpio `340.080` bytes (SHA-256 `1b7db4b24a78e86b1efbe37b66a8e4144cf4aabd6447f619813a9d91f9589ba8`), manifiesto promovido `.local/test-evidence/publish-v70/site-manifest.json` `9.577` bytes (SHA-256 `8edbc333f7859d14d89934b8dae35a097143772decff3b183a33141b8447eae6`), **50** rutas estáticas, `copiedFiles: 0`, `retainedPublications: 0`, `legacyRetained: false` (entrada v69 `/releases/0cf30b686e707151.html`: `404` directo y `200` navegación sirviendo v70), **15** reglas `run_worker_first` (+`/api/youtube-playlist`), **14** bindings (+`YOUTUBE_API_KEY` `secret_text`), `observability: null`, `logpush: false`, sin `X-Pulso-Diag`. Recibos en `.local/test-evidence/publish-v70/`.
- **Verificación en vivo con navegador autenticado (`.local/test-evidence/publish-v70/live-verification.json`, Chromium escritorio `1280×800` y móvil `390×844`):** PASS (`meta 8343797dc7910080`, `GET /api/account-library` HTTP `200`, importador ausente en **General** y presente en **Conexiones** con `<input type="text" inputMode="url">`, `/api/youtube-playlist` HTTP `200` `Cache-Control: no-store` autenticado con nombre válido y `2` ítems reales sin `videoId` ni fuga `AIza`, `400` con ID inválido y `401` anónimo; `0` `consoleErrors`/`pageErrors`/`diagResponses`, `0` canciones del usuario borradas).
- **Aceptación física iPhone (`docs/IPHONE-ACEPTACION.md`):** las 16 pruebas siguen **NO EJECUTADAS** por el propietario.
