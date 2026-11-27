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

La batería registró un timeout en WebKit de v68 al esperar el álbum del catálogo simulado; la repetición completó 24 casos en ambos motores. La suite de caché persistente quedó interrumpida dos veces por superar la carga de un minuto de 1,5 durante mediciones; no se acredita como PASS. Quedan pendientes esa suite, las interacciones unitarias del controlador y la revisión independiente antes de publicar.
