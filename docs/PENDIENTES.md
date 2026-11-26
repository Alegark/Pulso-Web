# Pendientes abiertos · 2026-11-25

Pulso sirve [v63](https://pulso-web.pruebassoftware.workers.dev/releases/87a4e7d0841ad483.html) desde `release/v63`. El registro de publicación está en [P0-W](../odd/tasks/P0-W.md#2026-11-25--publicación-de-v63). La [PR 20 de v60](https://github.com/Alegark/Pulso-Web/pull/20) queda abierta.

## Pendientes de v63

- **T26 C03 en WebKit.** Estabilizar el arnés de reapertura de playlist sin tráfico y corregir el caso de portada de proveedor que encontró una carrera entre `img.decode()` y la revocación de su URL de objeto en `CatalogArtwork.tsx`.
- **T26 C04 en WebKit.** Reparar el fixture de portada incrustada, que reescribe en IndexedDB un Blob leído del mismo registro y falla también en v62.
- **T27 P01.** La pista suelta tardó 550 → 495 ms en IDB (−10,0 %) y 1.114 → 574 ms en OPFS (−48,5 %) en Chromium sintético. La meta era −50 %. Queda completar la medición comparable en WebKit.
- **M1 con Telegram real.** Comprobar suspensión y reconexión bajo demanda, conservación de la sesión y presencia «en línea» tras restaurar la conexión. La prueba con Telegram real sigue **NO EJECUTADA**.

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

## 8. Estado al pausar · 2026-11-26 (leer primero al retomar)

El propietario detuvo todo el trabajo. La versión publicada es **v63**, rama `release/v63`, PR 23. No hay agentes en marcha. Antes de cualquier prueba, conviene leer `docs/CLOUDFLARE.md` (receta en `scripts/publish-cloudflare.mjs`) y las reglas de `AGENTS.md`:
- probar siempre en la app publicada en Cloudflare, no solo en local;
- usar modelos de bajo consumo;
- `gpt-6.2-sol` solo con autorización expresa del propietario.

### 8.1 Bloqueante · la biblioteca de cuenta no se sincroniza en producción
- **Síntoma:** con sesión válida, `/api/account-library` y `/api/account-profile` responden **503** (`LIBRARY_UNAVAILABLE` / `PROFILE_UNAVAILABLE`), en unos 90 ms. `get-session` y `/api/account-auth/token` responden 200. Al iniciar sesión en otro dispositivo, la biblioteca aparece vacía.
- **Comprobado en Neon** con el MCP en solo lectura: el proyecto, el cómputo y la Data API están activos; `pulso_account_library` y `pulso_account_preferences` existen con RLS y permisos correctos, y **tienen 0 filas**: nunca se ha guardado ninguna biblioteca. No hay restricción por IP.
- **Secreto actualizado:** `PULSO_NEON_DATA_API_URL` se cambió por la URL activa de Neon con autorización del propietario (Worker, versión `8e363ec5-06fc-47d1-9d62-6fff66e8525c`, con el mismo módulo que v63). **El 503 sigue.**
- **Ejecución local:** el router real (`deployment/cloudflare/account-data.mjs`) con el mismo token y la URL activa devuelve **200**. El fallo solo ocurre dentro del Worker de Cloudflare.
- La observabilidad del Worker está desactivada, así que no hay registros.
- **Siguiente paso:** instrumentar temporalmente en Cloudflare cada rama del handler que acaba en `unavailable()` (líneas 59, 76, 83, 92, 95, 97, 108 y 110), sin registrar secretos ni tokens, o activar la observabilidad. **Requiere autorización del propietario**, porque es un cambio en Cloudflare.
- **Evidencia:** `.local/research/sync-live-2026-11-25/report.md` y `.local/research/live-e2e-2026-11-26/report.md`.

### 8.2 v64 a medias · fallos de la prueba real en Cloudflare
La rama `fix/v64-live` está en el worktree `orca/workspaces/Pulso-Web/v64-live`, sin commits propios. Los cambios sin terminar están en `.local/test-evidence/stopped-2026-11-26/v64-wip.patch`. La tarea ODD prevista es T28. Pendientes:
- **D01:** al tocar «Get Lucky» (Daft Punk) sale «Las opciones del bot no pudieron vincularse con el título y artista elegidos». Faltan los textos reales de las opciones del bot. Corregir sin aceptar canciones equivocadas (J03 de T25).
- **Aviso visible «Cola lista y pausada. Pulsa Reproducir»** al tocar una canción de Biblioteca, que sale aunque la canción ya avanza. Lo provoca el `status` de la preparación manual; el de la restauración ya está oculto desde v63.
- **Aviso transitorio «No se pudo guardar la canción»** a mitad de la descarga de un álbum de 9 pistas, aunque al final bajan 9/9. El álbum tardó unos 5 minutos.
- **Portadas:** salen con ♪ en la búsqueda y tardan tras recargar Biblioteca.

### 8.3 Sesiones de prueba que hay que cerrar
- `.local/tmp/live-browser/profile` contiene la sesión de Pulso **y la de Telegram** de la cuenta del propietario. Cuando el propietario lo indique: cerrar la sesión de Telegram desde la app o desde Telegram → Ajustes → Dispositivos, y borrar el perfil. No compartir ese perfil.
- El MCP de Neon está conectado en Codex con permiso de solo lectura.

### 8.4 Limpieza pendiente
- Los worktrees `orca/workspaces/Pulso-Web/startup-splash` y `t25-inc1` solo tienen actas WIP ya integradas en v63. Se pueden retirar.
- `v64-live` se conserva mientras siga la v64.
