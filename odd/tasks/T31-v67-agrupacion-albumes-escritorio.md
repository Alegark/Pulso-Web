# T31 · Agrupación fiel de álbumes sincronizados en escritorio (v67)

- **Método:** ODD (`doc/SPEC.md` §C.5 y §V.2)
- **Estado:** Especificación ODD aprobada para implementación en `v67-album-grouping`.
- **Fecha:** 2026-11-27
- **Línea base:** v66 publicada (`/releases/c70c6318de067d99.html`, despliegue `2b4a6230-af7e-4ef7-8b89-7f978596d553`, versión 69, rama `release/v66`).
- **Requisitos SPEC vinculados:** W05, W06, W07, W08, W17, W18 · **Invariantes SPEC:** V11, V21, V29, V30.
- **Evidencia de origen (2026-11-27):**
  - El propietario observó que al abrir su sesión en escritorio, canciones pertenecientes a un mismo álbum aparecían como un álbum aparte, mientras que en el teléfono (donde agregó los álbumes) aparecían correctamente agrupadas.
  - Consulta agregada de solo lectura en Neon (`.local/tmp/v67-diag/album-split-report.json`, cero PII): en la cuenta del propietario (`account_1`), 23 pistas de Biblioteca proceden de solo **2** ediciones iTunes (`distinctITunesEditionIds: 2`), pero producen **4** álbumes normalizados distintos con **2** pistas con discrepancia `itunesAlbumMismatch` (etiqueta ID3 `track.album` distinta de `catalogChoice.album`, p. ej. `"- Single"` en el archivo entregado por el bot) generando **2** álbumes falsos de 1 canción en escritorio (y en `account_4`: 9 pistas de 1 edición con 1 `itunesAlbumMismatch` → 2 álbumes en vez de 1).
  - Causa raíz exacta: en el teléfono, `savedAlbums` (local al dispositivo) absorbe todas las pistas resueltas por `editionId` en una sola tarjeta; en escritorio (`savedAlbums = []`), `groupAlbums()` llama a `albumEditionId(track)` → `searchedITunesRelease(track)` / `searchedAlbumChoice(track)` en `src/library/catalog-release.ts:41-52`, que descartaba el `catalogChoice` explícito (`itunes` / `musicbrainz`) cada vez que la etiqueta ID3 `track.album` del bot difería de `catalogChoice.album`.

---

## Requisitos verificables

| ID | Área | Requisito y criterio de aceptación verificable |
|---|---|---|
| **U-V67-01** | Agrupación por edición de catálogo explícita en escritorio (`catalog-release.ts`, `groups.ts`) | **(1)** Cuando una pista tiene `catalogChoice` explícito de álbum (`source === 'itunes'` o `'musicbrainz'`) con `editionId` válido y **sin ediciones manuales** (`manualOverrides` vacío), `searchedAlbumChoice(track)` y `searchedITunesRelease(track)` conservan su `editionId` aunque la etiqueta ID3 `track.album` del archivo descargado difiera de `catalogChoice.album` (p. ej. `"- Single"` o edición alternativa). **(2)** En `groupAlbums()` / `displayTrackAlbum()`, la tarjeta de ese grupo de catálogo usa el título canónico `catalogChoice.album` (sin sobrescribir nunca `manualOverrides` ni el contrato existente de `trackCatalogRelease` de Spotify). **(3)** `orderAlbumRows()` usa `(disc, position)` de `catalogChoice.id` como respaldo cuando el archivo carece de `localAlbum` ID3 `disc`/`track`, preservando el orden del álbum en escritorio. **(4)** En un dispositivo secundario limpio (sin `savedAlbums`) sincronizado por Neon, pistas del mismo `editionId` con tags ID3 `album` dispares se agrupan en **una sola tarjeta de álbum** en Biblioteca e Inicio, sin crear álbumes falsos de 1 canción. |

---

## Matriz de trazabilidad

| ID | Prueba | Nivel | Criterio de paso |
|---|---|---|---|
| **U-V67-01** | `tests/unit/groups.test.ts` (pistas de un mismo `editionId` iTunes y MusicBrainz con `track.album` distinto / `"- Single"`, prioridad absoluta de `manualOverrides`, ordenación por `catalogChoice.id` cuando falta ID3, contrato Spotify intacto) + `tests/integration/check-account-library-main.mjs` (dispositivo B limpio sin `savedAlbums` recibe por sync pistas del mismo álbum iTunes con un `track.album` distinto y muestra **1** sola tarjeta de álbum en Biblioteca e Inicio) en Chromium y WebKit | U / B | 0 álbumes duplicados/fragmentados de 1 canción cuando comparten `editionId`; etiqueta canónica del álbum; `manualOverrides` sigue ganando siempre; batería completa PASS en ambos motores. |
