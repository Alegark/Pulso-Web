# T24 · Cola de colecciones y descargas de la PR 20

- **Método:** ODD (`doc/SPEC.md` §C.5 y §V.2)
- **Estado:** Verificación local y en navegador de la octava ronda. Producto revisado en `5e27f1b`, frente a `e21639c` para Q09a y a la versión publicada v59 (`7d41d25`) para el alcance de la PR 20.
- **Fecha:** 2026-11-25
- **Requisitos SPEC vinculados:** W05, W07, W10, W11, W13, W17, W18 · Invariantes SPEC: V2, V3, V5, V8, V9, V10, V16, V23, V27, V28, V30, V31

---

## Objetivo

Fijar de forma verificable y cerrada los requisitos funcionales (`Q01…Q19`, con Q09 dividido en Q09a y Q09b), invariantes (`I01…I08`), matriz de trazabilidad por nivel (§V.2) y límites de la PR 20 (`fix/album-tap-save-queue`), evitando la introducción de requisitos nuevos entre rondas de revisión y verificando que el conjunto no degrada las playlists normales ni la interfaz frente a v59 (`7d41d25`).

---

## Alcance y autorización

1. **Toque en tarjetas de álbum de búsqueda:** toda la superficie de la tarjeta (carátula, título y esquina vacía) abre el álbum al primer toque, también con una descarga activa.
2. **«Guardar álbum» sin descargar:** guarda la ficha del álbum en Biblioteca («En Biblioteca») sin iniciar descargas ni consultas a Telegram.
3. **Cola persistente de colecciones (álbumes y playlists):** cola FIFO por cuenta en almacenamiento local, dock flotante autoocultable y diálogos de gestión («Seguir descargando / Cancelar descarga» y «Mantener en cola / Quitar de la cola»), con recuperación automática sin bucles.
4. **Clasificación única de fallos de bot en lotes:** tabla de 10 filas centralizada en `classifyBatchFailure` (`src/library/ordered-bot-acquisition.ts`) y mensajes de `src/library/download-song.ts` compartidos por playlists y álbumes en cola.

## Fuera de alcance

- **Propiedad de pestaña en el shell.** Q09b documenta el fallo heredado de v59. Se conserva como una tarea futura fuera de esta PR.

- **Búsqueda individual de una canción suelta** (`MusicSearchController.tsx` / `acquireFromOrderedBots` sin `accept`): conserva el comportamiento de v59 (`7d41d25`), salvo el ajuste mínimo exigido por R1 y R4 (reutilizar el menú ante `file-unsupported`, consumir el menú al completar con éxito y avanzar al siguiente bot ante `needs-start` / `USER_IS_BLOCKED` sin dañar la sesión).
- **Mejoras de velocidad** (`perf/faster-bot-pipeline`), nuevos proveedores/bots, publicación en Cloudflare, despliegue automático y pruebas con Telegram real o iPhone físico.

---

## Requisitos funcionales

| ID | Requisito | Criterio de aceptación verificable |
| --- | --- | --- |
| **Q01** | Toque completo en tarjetas de álbum | Tocar la carátula, el título o un espacio vacío de una tarjeta de álbum en Buscar abre el álbum al primer toque, incluso mientras hay una descarga de colección activa (`searchPending` no deshabilita la tarjeta). |
| **Q02** | «Guardar álbum» sin descargar | Pulsar «Guardar álbum» guarda la ficha en Biblioteca, muestra «En Biblioteca» y no inicia descargas ni consultas a Telegram; si Almacenamiento bloquea el guardado o se alcanza el límite de 500 álbumes, muestra el aviso correspondiente. |
| **Q03** | Cola persistente FIFO por cuenta sin pérdida de admisión | Encolar álbumes y playlists los persiste por cuenta en orden FIFO sin duplicados por clave; diferir la admisión por bloqueo de Almacenamiento, comprobación de versión, refresco inicial de Biblioteca o una canción suelta en vuelo conserva la entrada persistida y respeta el orden. |
| **Q04** | Dock flotante, autooculto y con pocos botones | El dock de descargas es flotante, se oculta automáticamente cuando no hay descargas activas, pendientes, en cola ni avisos, no añade botón por canción y expone diálogos modales con foco inicial en conservar («Seguir descargando / Cancelar descarga» para activa; «Mantener en cola / Quitar de la cola» para en espera). |
| **Q05** | Cancelación, detención y prioridad de checkpoint | «Cancelar descarga» liquida la entrada y descarta el checkpoint de playlist incluso con la cola vacía, conservando copias verificadas y recibos pendientes; «Detener» conserva el checkpoint manual; al recargar, un checkpoint automático de playlist tiene prioridad sobre la cola y retirar la colección descarta su checkpoint protegiendo el recibo. |
| **Q06** | Exclusión y refresco de inspección de copias de álbum | La página de álbum no inicia ni conserva inspecciones de copias locales mientras el despachador o una descarga/canción están activos (`running`, `dispatching`, `songFlight`), y re-inspecciona al liquidar el trabajo sin reiniciar inspecciones al cambiar elementos en espera. |
| **Q07** | Recuperación acotada de álbum en cola sin bucle infinito | Un álbum en cola usa `collectionTelegramWait` para cortes transitorios de Telegram; si agota reintentos tras `reconnectForDownload()`, cambia la selección de bots o falla Almacenamiento, queda pausado en cola con su motivo persistente en el dock y «Reintentar descarga en cola», conservando las copias verificadas y sin relanzarse en bucle. |
| **Q08** | Reanudación automática de cabeza pausada por primer plano o red | Un álbum en cola pausado por interrupción (incluido si se pausó en segundo plano con `visibilityState === 'hidden'` o si `online` llegó justo antes de `settle`) se reanuda automáticamente al volver a primer plano (`visibilitychange` `hidden → visible`) o al recibir `online`, sin exigir botón manual. |
| **Q09a** | Reanudación de cola tras `pageshow` persistido y recuperación del control | Tras `pagehide` y `pageshow` con `persisted: true`, la cola conserva la pausa mientras la pestaña está sin control, sin relanzamientos ni bucle. En cuanto el usuario recupera el control por el camino normal del shell, la cabeza pausada por interrupción se reanuda sola, sin pulsar «Reintentar descarga en cola», y la siguiente colección avanza. |
| **Q09b** | Recuperación automática del control de la pestaña tras BFCache | FALLO ABIERTO heredado de v59, fuera de la PR 20. El shell pierde el control en `pagehide` y no lo recupera automáticamente en `pageshow` persistido. El usuario puede recuperarlo mediante «Usar en esta pestaña». |
| **Q10** | Tope de relanzamientos inmediatos sin frenar diferimientos normales | `MAX_AUTOMATIC_QUEUE_RELAUNCHES` sólo cuenta relanzamientos consecutivos cuando no existe bloqueo observable (`!ready()` o comprobación de versión en curso) y se reinicia al arrancar el trabajo o ante un evento de recuperación; los diferimientos normales se reanudan solos y, si se agota el tope, el motivo persiste en el dock más allá de 5 s. |
| **Q11** | Clasificación Fila 1 (suspensión y menú reutilizado) | Un resultado inconcluso tras suspensión en cualquier fase (`search`, `selection`, `callback`, `download`), incluido un menú reutilizado que arrastraba `file-invalid` o `file-too-large` de la opción previa, devuelve `suspended`, renueva Telegram, conserva el mismo bot (`resumeBot`) y excluye las opciones ya rechazadas (`rejectedOptions`) incluso tras rotar referencias. |
| **Q12** | Clasificación Filas 2–4 (canal, entrega incierta y timeout previo) | Ante canal caído (`channelDown`), entrega incierta (`delivery: 'uncertain'`, salvo `needs-start` explícito), `network`, `session-expired`, `rate-limit`, `uncertain` o `timeout` con `delivery: 'not-dispatched'`, el lote detiene la pista en Bot 1 devolviendo `telegram` sin probar Bot 2 y entra en espera/reconexión sin marcar ausencia ni archivo inválido. |
| **Q13** | Clasificación Fila 5 (`timeout` tras acuse, incluido audio directo) | Un audio directo verificado fija `delivery: 'acknowledged'` antes de `upload.getFile`; cualquier `timeout` tras acuse (búsqueda, callback o transferencia) o agotamiento del presupuesto de bot cede al Bot 2 y, si se agotan todos, marca sólo esa canción «Telegram no respondió a tiempo» y continúa el lote. |
| **Q14** | Clasificación Fila 6 (`needs-start`, `bot-limit`, `unsupported`) | Un rechazo `USER_IS_BLOCKED` en RPC o un aviso cerrado de `/start` (sin falsos positivos en títulos de canciones) se clasifica como `needs-start`; junto con `limit*` (`bot-limit`) y `unsupported` de protocolo, cede al siguiente bot y, si se agotan todos, muestra su motivo específico sin afirmar «No existe en tus bots». |
| **Q15** | Clasificación Fila 7 (errores de archivo, formatos Ogg/FLAC y desajuste) | `file-too-large`, `file-invalid`, `file-unsupported` (MIME `audio/*` incompatible como Ogg/FLAC) y `audio-mismatch` conservan las opciones restantes del menú del mismo bot sin penalizar `sessionBotHealth`; si otro candidato entrega audio compatible rechazado después en guardado local, no se muestra aviso de formato incompatible. |
| **Q16** | Clasificación Fila 8 (ausencia confirmada en todos los bots) | El mensaje «No existe en tus bots» (`reason: 'not-found'`) sólo se emite cuando ningún bot entregó archivo ni fallo de proveedor/compatibilidad y todos confirmaron ausencia explícita (`botSearchReportsNoResults`). |
| **Q17** | Clasificación Filas 9 y 10 (conflicto, caducidad e inconclusos) | Un `conflict` tras acuse en descarga (`delivery-conflict`) pasa al siguiente bot; un `conflict` o `expired` antes del despacho reintenta una vez y avanza; una admisión denegada en `selection` o un `expired` ajeno en `search` quedan inconclusos (`telegram`) sin cerrar la pista como archivo inválido. |
| **Q18** | Continuidad del lote tras fallos definitivos por canción | Ningún fallo definitivo individual (`not-found`, `no-valid-file`, `needs-start`, `bot-limit`, `unsupported`, `file-unsupported`, `timed-out`, `missing-metadata`) detiene el resto de canciones de la playlist o álbum ni bloquea la siguiente colección en cola. |
| **Q19** | Búsqueda individual acotada (delta mínimo R1/R4) | La búsqueda individual (`!p.accept`) conserva el comportamiento de v59 para fallos inciertos/transitorios, pero avanza al siguiente bot ante `needs-start`/`USER_IS_BLOCKED`, reutiliza el menú ante `file-unsupported` y consume el menú al descargar con éxito sin disparar `expired` a los 120 s. |

---

## Invariantes

| ID | Invariante | Regla que nunca puede romperse |
| --- | --- | --- |
| **I01** | Monotonía de entrega publicada | `BotSearchDelivery` nunca retrocede de `uncertain` o `acknowledged` a `not-dispatched` entre el progreso `bot-search.sending` y la respuesta terminal del worker. |
| **I02** | Cuarentena de protocolo intacta | `TelegramSessionClient.receiveSearch()` (`src/telegram/session-client.ts:101`) siempre cuarentena y termina el worker con `error: 'protocol'` si recibe `bot-search.error` con `delivery: 'not-dispatched'` tras haber observado `delivery !== 'not-dispatched'`. |
| **I03** | Retención acotada del menú | El menú sólo se retiene mientras queden opciones pendientes de probar y nunca tras una descarga exitosa en búsqueda individual (`menuAfterSuccess: 'consume'`), evitando temporizadores de caducidad huérfanos. |
| **I04** | Ausencia de relanzamiento sin evento de recuperación | Una cabeza de cola pausada tras `interrupted` o por error persistente en primer plano nunca se relanza por eventos internos de Telegram (`reconnectForDownload`, cambio de revisión de bots, `visibilitychange` ya visible); sólo se rearma con `hidden → visible`, `online`, `pageshow` persistido o clic explícito en «Reintentar descarga en cola» (y sólo clic explícito si no tiene `recoverySince`). |
| **I05** | No regresión en playlists normales sin cola | Una playlist descargada sin cola conserva frente a v59 (`7d41d25`) las descargas completas verificadas, la reanudación tras recarga/suspensión/corte y la continuidad ante pistas ausentes o timeouts de bot. |
| **I06** | Integridad de cuenta, revisión y autoridad | Ninguna copia, liquidación de cola ni descarte de checkpoint se publica sin comprobar la cuenta activa, el control de pestaña (`sameOwner` / `hasControl`) y la cabeza persistida (`queue.read()[0]?.id === job.id`). |
| **I07** | Respuestas ajenas o inciertas nunca cierran bots | Ninguna respuesta ajena (`!ownReply`), caducada o con `delivery: 'uncertain'` —excepto el rechazo RPC explícito `USER_IS_BLOCKED` (`needs-start`) de la operación vigente con canal sano— puede marcar un bot completado ni afirmar «No existe en tus bots». |
| **I08** | Paridad de interfaz y preservación de copias verificadas | La accesibilidad/interfaz no introduce regresiones frente a v59 (`7d41d25`) y ninguna cancelación o interrupción elimina copias ya confirmadas ni recibos de guardado pendientes. |

---

## Matriz de trazabilidad

Niveles según `doc/SPEC.md` §V.2: **U** (unitaria sobre módulos reales con dependencias controladas), **B** (navegador real Chromium/WebKit con DOM/IDB/workers/SW en loopback), **T** (Telegram real), **D** (iPhone físico). Los resultados **B** proceden del acta de la séptima revisión (`odd/tasks/T11-T12-lotes-locales.md:1022-1026`); los resultados **U** fueron reejecutados directamente sobre `5e27f1b`.

| ID | Prueba (archivo y caso) | Nivel | Cobertura | Resultado en `5e27f1b` |
| --- | --- | --- | --- | --- |
| **Q01** | `tests/integration/check-playlist-full-download-main.mjs`: `tap-active` (y `tap-baseline` en `7d41d25`) | B | CUBIERTO | PASS (2/2 motores) |
| **Q02** | `tests/integration/check-playlist-full-download-main.mjs`: `queue`, `queue-album-refresh`, `queue-album-read-error` | B | CUBIERTO | PASS (Chromium/WebKit) |
| **Q03** | `tests/unit/collection-download-queue.test.ts` (5 casos); `check-playlist-full-download-main.mjs`: `queue`, `queue-reload`, `queue-admission`, `queue-song-save`, `queue-song-order`, `queue-review-admission`, `queue-version-busy`, `queue-before-library-refresh` | U/B | CUBIERTO | PASS (U reejecutado; B en acta) |
| **Q04** | `tests/integration/check-download-feedback.mjs` (5 casos: dock flotante, posición, autoocultado, foco en diálogo); `check-playlist-full-download-main.mjs`: `queue`, `queue-paused-removal` | B | CUBIERTO | PASS (Chromium/WebKit) |
| **Q05** | `tests/unit/library-download.test.ts` (cancelación/descarte/recibos); `check-playlist-full-download-main.mjs`: `queue-cancel`, `queue-cancel-empty`, `queue-cancel-save`, `queue-paused-removal`, `queue-cancel-exception`, `queue-missing-paused-track` | U/B | CUBIERTO | PASS (U reejecutado; B en acta) |
| **Q06** | `tests/integration/check-playlist-full-download-main.mjs`: `queue-inspection` | B | CUBIERTO | PASS (Chromium/WebKit) |
| **Q07** | `tests/unit/album-acquisition-completion.test.ts`; `check-playlist-full-download-main.mjs`: `queue-album-reconnect-exhausted`, `queue-album-clear-retry`, `queue-album-interruption`, `queue-album-uncertain-send`, `queue-album-network` | U/B | CUBIERTO | PASS (U reejecutado; B en acta) |
| **Q08** | `tests/integration/check-playlist-full-download-main.mjs`: `queue-album-reconnect-foreground`, `queue-album-reconnect-online`, `queue-album-reconnect-online-before-settle` | B | CUBIERTO | PASS (Chromium/WebKit; `D` pendiente) |
| **Q09a** | `tests/integration/check-playlist-full-download-main.mjs` · `queue-album-reconnect-persisted-pageshow` | B | CUBIERTO | 0/2 en `e21639c` y 2/2 en `5e27f1b` (Chromium y WebKit). |
| **Q09b** | Observación explícita de la falta de control en `queue-album-reconnect-persisted-pageshow` y fallo de recuperación integral de la primera corrida de Q09 en ambos motores | B / lectura de v59 | FALLO ABIERTO · FUERA DE ALCANCE | FAIL en `e21639c` y `5e27f1b`. Los manejadores del shell son los mismos en `7d41d25`, comprobado por lectura. |
| **Q10** | `tests/integration/check-playlist-full-download-main.mjs`: `queue-dispatch-normal-deferrals`, `queue-dispatch-relaunch-cap` | B | CUBIERTO | PASS (Chromium/WebKit) |
| **Q11** | `tests/unit/ordered-bot-driver.test.ts` · `Q11 · H4 real client resumes a suspended menu after file-invalid and rotates references` y el caso `file-too-large`; Fila 1 de `ordered-bot-acquisition.test.ts`; suspensión de playlist en `check-playlist-resume-main.mjs` | U/B | CUBIERTO | Los dos casos nuevos con cliente y driver reales fallan en `f13b770` y pasan en `5e27f1b`. |
| **Q12** | `tests/unit/ordered-bot-acquisition.test.ts` (Filas 2–4); `tests/unit/library-download.test.ts`; `check-playlist-full-download-main.mjs`: `queue-album-uncertain-send`, `queue-album-network`, `queue-retry-at`, `queue-disconnected` | U/B | CUBIERTO | PASS (U reejecutado; B en acta) |
| **Q13** | `tests/unit/ordered-bot-driver.test.ts` · `Q13 · H2 real client advances after a direct audio transfer timeout`; Fila 5 de `ordered-bot-acquisition.test.ts`; `queue-{album,playlist}-bot-timeout` | U/B | CUBIERTO | El caso nuevo con cliente y driver reales falla en `f13b770` y pasa en `5e27f1b`. |
| **Q14** | `tests/unit/ordered-bot-driver.test.ts`: `R3 · real session survives blocked/menu-blocked` (4 casos con `TelegramSessionClient` real), `M9 · start-{recent,welcome,es,mention}`, `M9 · limit/unsupported`; `check-playlist-full-download-main.mjs`: `queue-{album,playlist}-bot-{unsupported,limit,needs-start}` | U/B | CUBIERTO | PASS (U reejecutado; B en acta) |
| **Q15** | `tests/unit/ordered-bot-driver.test.ts`: `R1 · menu-ogg/flac`, `unsupported audio across the menu never penalizes the bot`, `only an exhausted incompatible menu`, `delivered compatible file rejected locally`; `check-playlist-full-download-main.mjs`: `turnaround/unsupported-format` (worker + cliente reales) | U/B | CUBIERTO | PASS (U reejecutado; B en acta) |
| **Q16** | `tests/unit/ordered-bot-acquisition.test.ts` (Fila 8); `ordered-bot-driver.test.ts`: `M9 · empty`; `library-download.test.ts`; `check-playlist-full-download-main.mjs`: `missing`, `queue-*-bot-*` | U/B | CUBIERTO | PASS (U reejecutado; B en acta) |
| **Q17** | `tests/unit/ordered-bot-driver.test.ts` · `Q17 · H3 real client denies selection after a result without closing the bot`, `Q17 · H3 real client exposes an expired foreign search without closing either bot` y `Q17 · M8 real client advances after an acknowledged callback conflict` | U | CUBIERTO | Los tres casos nuevos con cliente y driver reales fallan en `f13b770` y pasan en `5e27f1b`. |
| **Q18** | `tests/unit/library-download.test.ts`; `album-acquisition-completion.test.ts`; `check-playlist-full-download-main.mjs`: `missing`, `queue-{album,playlist}-bot-{timeout,unsupported,limit,needs-start}` | U/B | CUBIERTO | PASS (U reejecutado; B en acta) |
| **Q19** | `tests/unit/ordered-bot-driver.test.ts` · `Q19 · real individual search keeps the session and advances after a blocked bot`, `Q19 · real individual search uses the next option of the same Ogg menu` y los casos R4 de la séptima ronda `real individual search consumes menu-valid/menu-ogg-three` | U | CUBIERTO | Los dos casos nuevos con cliente y driver reales fallan en `9b03e62` (bot bloqueado) y `e21639c` (Ogg), y pasan en `5e27f1b`. Los casos R4 fallan en `9b03e62` y pasan en `5e27f1b`. |
| **I01** | `tests/unit/ordered-bot-driver.test.ts`: `R3 · real session survives blocked/menu-blocked` (verifica `sending` → `error` con `delivery: 'uncertain'`) | U | CUBIERTO | PASS (reejecutado con `TelegramSessionClient` real) |
| **I02** | `tests/unit/session-bot-search-client.test.ts`: `delivery cannot regress from sending to not-dispatched, even with a syntactic closed DTO` | U | CUBIERTO | PASS (reejecutado con `TelegramSessionClient` real) |
| **I03** | `tests/unit/ordered-bot-driver.test.ts`: `R4 · real individual search consumes menu-valid/menu-ogg-three` | U | CUBIERTO | PASS (reejecutado con `TelegramSessionClient` real) |
| **I04** | `tests/integration/check-playlist-full-download-main.mjs`: `queue-album-reconnect-exhausted`, `queue-album-clear-retry`, `queue-dispatch-relaunch-cap`, `queue-album-read-error`, `queue-claim-error`, `queue-album-reconnect-persisted-pageshow` | B | CUBIERTO | PASS (Chromium/WebKit). El menor sobre un evento antiguo sigue pendiente. |
| **I05** | `tests/unit/ordered-bot-acquisition.test.ts`; `check-playlist-full-download-main.mjs`: `full` (×3), `resume`, `missing`, `stale-checkpoint`, `turnaround`; `check-playlist-resume-main.mjs` (46/46 × 2 motores) | U/B | CUBIERTO | PASS (U reejecutado; B en acta) |
| **I06** | `tests/unit/collection-download-queue.test.ts`; `library-download.test.ts`; `check-playlist-full-download-main.mjs`: `queue-resumed-album-pagehide`, `queue-unmount-update`, `queue-album-external-removal`, `queue-album-library-update`, `queue-album-expired-update` | U/B | CUBIERTO | PASS (U reejecutado; B en acta) |
| **I07** | `tests/unit/album-acquisition-completion.test.ts`: `unsettled, quarantined, foreign or still-compatible snapshots cannot establish catalogue absence`; `ordered-bot-driver.test.ts`: `H3`, `R3`; `ordered-bot-acquisition.test.ts` (Filas 3 y 10) | U | CUBIERTO | PASS (reejecutado) |
| **I08** | Comparación de interfaz (`11/12` idéntico en `7d41d25` y `5e27f1b`); `check-playlist-full-download-main.mjs`: `queue-cancel-save`, `queue-album-reconnect-exhausted` | B | CUBIERTO | PASS (paridad con v59; mismo fallo preexistente al 200 % con movimiento reducido) |

La matriz contiene 28 elementos. Hay 19 requisitos y ocho invariantes cubiertos por la PR 20, y un requisito del shell con fallo abierto fuera de alcance. Quedan cero huecos de nivel insuficiente y cero elementos sin prueba. La evidencia de los dos menores sigue registrada debajo.

## Verificación de la octava ronda

- Q09a se observa en el shell integrado con eventos de ciclo de vida inyectados en Chromium y WebKit. Tras `pageshow` persistido, se verifica que aparece «Usar en esta pestaña», que ambas entradas siguen en cola y que no hay otra admisión ni RPC. La prueba usa ese botón y comprueba que las dos colecciones se completan, con la primera copia del álbum conservada. En `e21639c` ambas entradas quedan pendientes aun después de recuperar el control. Q09b conserva una observación explícita de fallo de recuperación automática en el recibo del navegador.
- Las ocho pruebas U nuevas pasan sobre `5e27f1b` y fallan frente a los commits indicados en la matriz. El arnés usa `TelegramSessionClient` y el driver reales. En snapshots anteriores a `isBotSearchFileError` se adaptó la importación del fixture con cliente simulado, que los casos nuevos no usan.
- `npm run test:unit` pasó 1.027/1.027. Pasaron `npm run typecheck`, `npm run typecheck:tests` y `npm run lint`. `git diff --stat 5e27f1b HEAD -- src` carece de cambios. La evidencia local queda en `.local/test-evidence/pr20-r8/` y `.local/test-evidence/pr20-r8-followup/`.

La limpieza retiró los perfiles, builds, datos sintéticos, cachés y snapshots. Se recuperaron al menos 12.083.200 bytes medidos en la continuación y 48.160.768 bytes en toda la ronda. En la continuación, `/data` tenía 7.554.207.744 bytes libres al inicio y 7.560.916.992 tras la limpieza. `.local/tmp/` quedó vacío. Se conservaron logs, recibos y huellas.

## Pendientes y límites

- **Q09b.** Recuperar automáticamente el control tras BFCache corresponde a una futura tarea del shell. `main.tsx` revoca el control al suspender y lo deja sin adquirir al restaurar. El fallo se conserva también en el informe de la reproducción integral anterior a la división de Q09.
- **Menor 1 de la revisión 8.** Una recuperación registrada en una pista anterior puede dar un ciclo adicional de reconexión al fallar una pista posterior. Queda acotado a una ronda adicional.
- **Menor 2 de la revisión 8.** Si la canción individual termina en `file-invalid` o `file-too-large`, el temporizador del menú retenido puede sustituir el motivo por `expired` a los 120 s.
- **Telegram real (T) e iPhone físico (D).** Cuenta, RPC y audio de prueba son sintéticos. Las 16 pruebas de `docs/IPHONE-ACEPTACION.md` permanecen NO EJECUTADAS. La prueba Q09a verifica los manejadores del shell con eventos inyectados en escritorio.
- **Fusión.** La PR 20 sigue abierta para revisión.

## 2026-11-25 · Publicación de v60

Cloudflare Workers Free (USD 0) sirve [v60](https://pulso-web.pruebassoftware.workers.dev/releases/b5f7b46a815f9364.html) desde el commit `933af5b843a6563cc4c3a706ab393acc727eb649` de la [PR 20](https://github.com/Alegark/Pulso-Web/pull/20). El MCP oficial confirmó la versión `7de9496b-b4f2-4ea0-ba66-1a52cd7c5f4d` al 100 % en el despliegue `bad72e9b-3421-4b29-b301-53e15f66079c`, creado a las `08:14:16.189414Z`. El Worker coincide por bytes (330.978) y SHA-256 (`b9fe9983c4d9e2a293f9e10d7de2b671d8c92b4bf72fc92cc2fd91d6bd23c03f`). Se conservaron los 13 bindings, Turnstile, los secretos, los límites, la configuración de ejecución y las 14 reglas de `run_worker_first` de v59.

Pasaron el build, 73/73 pruebas de servidor, la preparación de Cloudflare y la simulación de Wrangler 4.161.0. El freeze conservó 13 publicaciones anteriores y el inventario heredado, con cero rutas retiradas. El primer PUT recibió HTTP 400, error 10021, porque incluyó `serve_directly` junto con `run_worker_first`. El reintento conservó las reglas de `wrangler.jsonc`, cotejadas con la versión activa v59, y omitió `serve_directly`. Cloudflare ya tenía los 12 assets que solicitó en el primer intento y la sesión nueva pidió cero.

HTTPS confirmó `latest.json`, el 307 hacia la ruta sin `.html`, el 200 de esa ruta y el meta `pulso-release` con valor `b5f7b46a815f9364`. Coincidieron bytes y SHA-256 de 299/299 rutas estáticas públicas, incluido `sw.js`. Las 54 entradas históricas y la actual sirvieron el bundle vigente tanto con Fetch Metadata y Accept como con Accept solo. Se verificaron el mismo `turnstileSiteKey`, `challenges.cloudflare.com` en las directivas CSP de script y marco, y HTTP 401 para perfil y biblioteca anónimos.

El manifiesto publicado y los recibos compactos están en `.local/test-evidence/pr20-release-v60/`. `site-manifest.json` enumera 302 archivos, ocupa 73.111 bytes y tiene SHA-256 `ca63e8431eb54e87ccf2ef87afc659dad6b2b083320e701248bb5080d112174b`.

P0-W sigue abierto. Q09b sigue como fallo heredado de v59. Quedan los dos menores de la revisión 8: una ronda adicional acotada de reconexión y la posible sustitución tardía del motivo de archivo por `expired`. Las 16 pruebas físicas en iPhone siguen **NO EJECUTADAS**.
