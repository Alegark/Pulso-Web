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

| **U-V66-03** | Poda Cloudflare | Por decisión del propietario del 2026-11-27, conservar solo el candidato vigente y retirar los assets inmutables de versiones anteriores y el legado, salvo los compartidos por el candidato. Validar integridad, fechas, rutas estables y colisiones antes de retirar. |

---

## Matriz de trazabilidad

| ID | Prueba | Nivel | Criterio de paso |
|---|---|---|---|
| **U-V66-01** | `tests/integration/check-v66-polish.mjs` + `check-ux-v65.mjs` + `playlist-detail-cases` en Chromium y WebKit | B / D | Sin `content: "⌄"`, botón `.player-surface__grabber` centrado `≥ 44×44 px`, `art.top >= close.bottom`, clic y gesto swipe-down cierran el reproductor, `.mini-player__expand` muestra SVG de expansión limpio y abre el reproductor, 0 desbordamiento a `320 px` 200 %. |
| **U-V66-02** | `tests/integration/check-v66-polish.mjs` + `check-artwork-rows-dock.mjs` + `check-persistent-cache-main.mjs` en Chromium y WebKit | B / D | Álbum guardado sin `artworkUrl` (o con URL fallida) cuya pista 2 o pista en caché de escucha tiene portada incrustada muestra `<img>` en Biblioteca e Inicio; álbum cuya portada está en `PlayerArtworkCache` (`edition:<id>`) muestra `<img>` aunque `trackIds` esté vacío; portada manual oculta (`K01`) sigue oculta; reabrir Biblioteca tras cerrar el reproductor mantiene todas las portadas; `A01`/`A02b` y `C03`–`C07` PASS. |

| **U-V66-03** | `tests/server/cloudflare-retention.test.mjs` y simulación `prepare-cloudflare.mjs --dry-run` contra el manifiesto v65 | U / integración local | Sin copias ni versiones anteriores en el manifiesto; todos los assets antiguos no compartidos se retiran; se rechazan inventarios corruptos y colisiones. |

## Evidencia de batería previa (5088f85)

Typecheck, typecheck:tests, lint y build PASS; unitarias 1063/1063, Cloudflare 74/74, Python 10/10. Chromium y WebKit: v66 2/2 por motor; UX v65 8/8; cuenta 5/5; portadas 6/6; avisos 5/5; arranque 10/10; caché persistente 13/13; reanudación 46/46; descarga completa 62/62; feedback de descargas 16 casos; reproducción local integridad 14/14 y playlist 2/2 por motor. `playlist-detail-cases` no ejecutada por falta de `INTERFACE_FREEZE`; aceptación física iPhone no ejecutada. Resumen local: `.local/tmp/v66-battery/summary.txt`.

## Actualización U-V66-03 y pulido

Validación focal local: typecheck, typecheck:tests, lint, unitarias, Cloudflare (74/74) y build PASS. Retención: 5/5 pruebas; navegador v66 2/2 por motor, incluido el caso directo de pista sin archivo con fallback y proveedor, y portadas 6/6 por motor. La primera ejecución de caché persistente registró dos tiempos de espera en WebKit; la repetición pasó 13/13 por motor. El gesto interrumpido y la reapertura también pasan en ambos motores.

El `--dry-run` contra el archivo v65 indicado (SHA-256 `f0390526b616da6b44397a1a053ea364eb91ab153b2417bef5f1fd1ff87adf41`) rechaza su `publishedAt: null`, pues es un manifiesto congelado, no promovido. Con `--mark-published` y la fecha de creación `2026-11-26T21:15:19.047Z` del recibo MCP (precisión de milisegundos exigida por el preparador), se generó localmente una copia derivada SHA-256 `9dde0ce2e4f2ddfd9d1b246146f464a43fc98955c69b2620b8c80f125043648a`; sobre ella, la simulación devuelve 0 copias, 300 archivos retirados, 84397613 bytes, 0 publicaciones previas y sin legado. El manifiesto original no se modificó. La promoción autoritativa y verificación pública corresponden a integración.
