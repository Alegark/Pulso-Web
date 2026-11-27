# T34 · Estado de álbum durante descarga de playlist (v69)

## Causa y requisito
La inspección profunda se suspende durante descargas globales; un álbum recién abierto recibía copias vacías y bloqueaba reproducción aun con audio local verificado. **U-V69-01:** durante una descarga de playlist, mostrar y reproducir las pistas locales verificadas de cualquier álbum, conservar deshabilitadas las pendientes y no iniciar búsquedas adicionales ni interrumpir la descarga.

## Invariantes
Mantener SPEC §W05/W07/W08/W10, T13/T16 y V13–V16; solo usar disponibilidad local available con asset y resolución válida, sin falsos positivos de copias corruptas o huérfanas; respetar inspección profunda y no iniciar dos consultas concurrentes al bot. El botón completo exige todas las pistas disponibles y pertenecientes a Biblioteca.

## Matriz de trazabilidad
| Requisito | Unitaria | Chromium | WebKit |
|---|---|---|---|
| U-V69-01: copias, controles, pendientes y reproducción local sin consultas adicionales | Parcial: resolución de copias; faltan interacciones del controlador | PASS: álbum completo y parcial | PASS: álbum completo y parcial |
| Copias missing/invalid no aparecen descargadas | PASS: resolución sin falso positivo | Parcial: pista sin asset | Parcial: pista sin asset |

Aceptación física iPhone: las 16 pruebas de docs/IPHONE-ACEPTACION.md siguen NO EJECUTADAS hasta informe del propietario. Publicación sujeta a batería y revisión independiente.

La preparación de cola cambia temporalmente la admisión de operaciones. Tras completar esa preparación se captura una admisión nueva y se comprueban el alcance original y la época de cola; reutilizar la admisión anterior impedía iniciar audio aunque la cola se hubiera preparado.

La batería registró un timeout puntual en WebKit de v68 al esperar el álbum del catálogo simulado; la repetición completó `24/24` casos en ambos motores. Posteriormente, con carga de 1 minuto `< 1,5` (`0,69`), `tests/integration/check-persistent-cache-main.mjs` completó **`26/26` PASS** (`13/13` Chromium y `13/13` WebKit).

## Evidencia de validación y revisión independiente (pre-publicación v69)

- **Implementación:** `b1a22d5` (`src/library/album-effective-copy.ts`, `src/ui/AlbumPageController.tsx`, `src/ui/track-menu-host.ts`, `src/main.tsx`, `tests/unit/saved-albums.test.tsx`, `tests/integration/check-v69-album-during-download.mjs`).
- **Validación completa (`b1a22d5`):** `typecheck`, `typecheck:tests`, `lint`, `build`, `1083/1083` unitarias, `74/74` Cloudflare, `10/10` Python y suites de navegador en Chromium y WebKit: `check-v69-album-during-download.mjs` (`4/4`), `check-v68-continuous-and-album.mjs` (`24/24`), `check-persistent-cache-main.mjs` (`26/26`), `check-v66-polish.mjs` (`4/4`), `check-v67-storage-removal.mjs` (`10/10`), `check-ux-v65.mjs` (`16/16`), `check-download-feedback.mjs` (`16/16`) — todo **PASS**.
- **Revisión independiente (Antigravity `gemini-4-neon` medio):** PASS sobre `release/v68..b1a22d5` (`0` Bloqueantes, `0` Altos, `2` Medios no bloqueantes para seguimiento posterior: guarda defensiva `plan.queueTrackIds.length` + `id===targetId` en `onPlayTracks` y ampliar clics de `▶ Reproducir`/`⇄ Aleatorio` + unitarias directas del controlador, y `2` Bajos) — veredicto **`Seguro publicar v69`**.
- **Publicación y verificación en vivo (2026-11-27):** desplegada en Cloudflare Workers Free (`/releases/0cf30b686e707151.html`, versión 72, despliegue `80451b5b-d780-493f-aae5-bacfbe5e88a4`, poda limpia `copiedFiles: 0`, recibos en `.local/test-evidence/publish-v69/`). Verificación en vivo PASS en escritorio (`1280×800`) y móvil (`390×844`) (`.local/test-evidence/publish-v69/live-verification.json`): cuenta `200`, `9/9` pistas descargadas, `0` pendientes, estado completado, `▶ Reproducir`/`⇄ Aleatorio` habilitados, portada visible, `0` errores y `0` canciones borradas.
- **Pendiente abierto del propietario:** aceptación física en iPhone (`docs/IPHONE-ACEPTACION.md`, 16 pruebas NO EJECUTADAS).
