# T30 · Nuevo control de reproductor y portada fiable de álbumes (v66)

- **Método:** ODD (`doc/SPEC.md` §C.5 y §V.2)
- **Estado:** Especificación ODD aprobada para implementación en `v66-polish`.
- **Fecha:** 2026-11-26
- **Línea base:** v65 publicada (`/releases/5a7eef31d22eabf1.html`, despliegue `18c58796-f9f8-4e53-8572-9148055fec89`, versión 68, rama `release/v65`).
- **Requisitos SPEC vinculados:** W04, W06, W08, W17, W18 · **Invariantes SPEC:** V11, V21, V27, V29, V30, K01 (prioridad manual/oculta de portada), T26 (caché persistente y revocación de ObjectURLs `A01`/`A02b`).
- **Evidencia de origen:** Capturas reales en iPhone aportadas por el propietario el `2026-11-26`:
  1. En «Ahora suena», el icono Unicode `⌄` arriba a la izquierda (`.player-surface__toolbar > button::before`) resulta tosco y asimétrico; y en el MiniPlayer el chevrón `∧` (`.mini-player__expand`) es mejorable.
  2. En Biblioteca, la tarjeta del álbum «mosca» (`17 canciones`) aparece con `♪` sin portada, mientras que al reproducir canciones de ese mismo álbum la portada sí aparece en el reproductor y en el MiniPlayer.

---

## Requisitos verificables

| ID | Área | Requisito y criterio de aceptación verificable |
|---|---|---|
| **U-V66-01** | Control de despliegue/colapso del reproductor (estilo Apple Music / iOS) | **(1)** En `PlayerSurface.tsx` + `design-fidelity.css`, retirar el glifo Unicode `⌄` flotando a la izquierda y reemplazarlo por un **tirador centrado de hoja** (`.player-surface__grabber`, píldora redondeada `38×5 px` dentro de un `<button type="button" aria-label="Cerrar reproductor">` centrado de `≥ 44×44 px`) con soporte de **gesto swipe-down** (`≥ 56 px` verticales dominantes en `.player-surface__toolbar`) para cerrar el reproductor, y etiqueta centrada sutil `Ahora suena` debajo; mantener `art.top >= close.bottom` y cierre por `Escape` / teclado. **(2)** En `MiniPlayer.tsx` + `mini-player.css`, sustituir el chevrón `∧` de `.mini-player__expand` por un icono SVG limpio de expansión diagonal (`16×16 px`, trazo `1.8` redondeado, objetivo `44×44 px`, hover suave `var(--pulso-surface-elevated)`), conservando `aria-label="Abrir reproductor desde minirreproductor"`. |
| **U-V66-02** | Portada fiable de tarjetas de álbum (caso «mosca») | **(1)** `libraryAlbumCards()` expone `coverTrackIds` (incluyendo todas las pistas resueltas localmente del álbum guardado, tanto Biblioteca como caché de escucha, sin alterar `trackIds` ni `albumRemovalMembership`). **(2)** `CollectionCover` (`variant="album"`) recibe `sharedArtworkKey` (`albumArtworkKey({ editionId, album, artist })`) y hasta `6` pistas candidatas (`available` primero) y las propaga a `CatalogArtwork` (`sharedArtworkKey` + `fallbackTrackIds`). **(3)** En `CatalogArtwork`, respetando estrictamente `K01` (si la pista principal tiene `manual: true` oculta `hidden`, no buscar fallbacks ni remotos), si la pista principal no tiene portada local `ready`, revisa las pistas candidatas de `fallbackTrackIds` antes de caer a `imageUrl` y luego a `cache.readProvider(sharedArtworkKey)`. **(4)** `preloadKeys` en `src/main.tsx` incluye también la clave `provider:<sharedArtworkKey>` y `catalogArtworkKey(group.artworkUrl)` de álbumes guardados aunque `group.trackIds` esté vacío. **(5)** `CollectionCover` comprueba visibilidad inmediata con `getBoundingClientRect()` al activarse `enabled` junto al `IntersectionObserver`, evitando que tarjetas de álbum queden en blanco tras transiciones `hidden → visible` en iOS Safari, y sigue liberando ObjectURLs cuando `enabled` pasa a `false` (`A01`/`A02b`). |

---

## Matriz de trazabilidad

| ID | Prueba | Nivel | Criterio de paso |
|---|---|---|---|
| **U-V66-01** | `tests/integration/check-v66-polish.mjs` + `check-ux-v65.mjs` + `playlist-detail-cases` en Chromium y WebKit | B / D | Sin `content: "⌄"`, botón `.player-surface__grabber` centrado `≥ 44×44 px`, `art.top >= close.bottom`, clic y gesto swipe-down cierran el reproductor, `.mini-player__expand` muestra SVG de expansión limpio y abre el reproductor, 0 desbordamiento a `320 px` 200 %. |
| **U-V66-02** | `tests/integration/check-v66-polish.mjs` + `check-artwork-rows-dock.mjs` + `check-persistent-cache-main.mjs` en Chromium y WebKit | B / D | Álbum guardado sin `artworkUrl` (o con URL fallida) cuya pista 2 o pista en caché de escucha tiene portada incrustada muestra `<img>` en Biblioteca e Inicio; álbum cuya portada está en `PlayerArtworkCache` (`edition:<id>`) muestra `<img>` aunque `trackIds` esté vacío; portada manual oculta (`K01`) sigue oculta; reabrir Biblioteca tras cerrar el reproductor mantiene todas las portadas; `A01`/`A02b` y `C03`–`C07` PASS. |
