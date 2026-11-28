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
| U-V70-02: `/api/youtube-playlist` 401 anónimo, 429 rate-limit, 503, oversize, deadline, sin fuga de clave | PASS (83/83 Cloudflare, incluye Miniflare) | N/A | N/A |
| U-V70-03: IDB en lote, reimportación por `youtubePlaylistId` sin pisar manual, sync Neon válido | PASS (unitarias, incluida `validateAccountLibrary`) | PASS | PASS |
| U-V70-04: `publish-cloudflare.mjs` transición autorizada 15 reglas / 14 bindings y prueba en vivo | PASS de sintaxis/configuración local; preflight, publicación y verificación HTTPS NO EJECUTADOS | N/A | N/A |

## Validación local · 2026-11-28

- `npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, `npm run build`: PASS.
- `npm run test:unit`: 1.088/1.088 PASS; `npm run test:cloudflare`: 83/83 PASS, incluido el Worker Miniflare; `npm run test:py`: 10/10 PASS.
- `check-youtube-import.mjs`: 12/12 PASS en Chromium y WebKit. `check-spotify-import.mjs`: fixture y borrado PASS en ambos motores.
- `check-settings-design.mjs`: 4/4 PASS en cada motor. `check-v69-album-during-download.mjs`: 2/2 PASS en cada motor.
- `wrangler.jsonc`: 15 reglas, incluida una sola `/api/youtube-playlist`; validación sintáctica de `publish-cloudflare.mjs`: PASS.
- No se hizo despliegue Cloudflare ni comprobación HTTPS en vivo en esta ronda. La aceptación física del propietario sigue pendiente.

Aceptación física iPhone: las 16 pruebas de `docs/IPHONE-ACEPTACION.md` siguen **NO EJECUTADAS** hasta informe del propietario.
