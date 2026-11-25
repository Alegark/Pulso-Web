# Pendientes abiertos · pausados el 2026-11-25

El propietario paró este trabajo: «lo vamos a seguir en otro momento, no vas a publicar». **No publicar en Cloudflare ni fusionar nada de esta lista hasta que el propietario lo retome.** La versión pública sigue siendo la v59, `/releases/bd0ec4a786b465e5.html`, rama `feat/library-full-albums`.

## 1. PR 20 · `fix/album-tap-save-queue` · NO publicable

**Qué trae:**
- Toque completo en las tarjetas de álbum de la búsqueda.
- «Guardar álbum» que añade a Biblioteca sin descargar.
- Cola persistente de descargas de álbumes y playlists, con el diálogo «Seguir descargando / Cancelar descarga» y «Mantener en cola / Quitar de la cola».
- Una tabla única que clasifica cada fallo como fallo de bot, corte de Telegram o suspensión. Está en `odd/tasks/T11-T12-lotes-locales.md` de esa rama, sección «Cuarta revisión».

**Estado:**
- La rama remota está en `f13b770` (ronda 4).
- La quinta revisión independiente (Gemini Neon) concluyó «No es seguro publicar».
- Su informe completo está fuera de Git, en `.local/research/pr20-review-5-2026-11-25/report.md`.

**Hallazgos abiertos de la quinta revisión.** H1 y H2 están verificados por lectura del código.

| ID | Gravedad | Problema | Dónde |
| --- | --- | --- | --- |
| H1 | Bloqueante | Un álbum en cola se relanza sin fin tras `reconnectForDownload()`. `sessionCurrent` se captura antes de `run()`, y `captureBotLifetime` compara `this.worker===worker`, así que queda en `false` tras la reconexión. Con eso, un resultado `interrupted` no pausa ni sale de la cola. | `src/ui/LibraryDownloadController.tsx` ~530 y ~579-586, `src/telegram/session-client.ts:129-130`, `src/library/collection-telegram-wait.ts:96-99` |
| H2 | Alto | El timeout al bajar un audio directo (sin menú) sale como `delivery:'not-dispatched'`. La fila 4 lo trata como corte de Telegram: no prueba el bot 2 y pausa la playlist. Es una regresión frente a `7d41d25`. La prueba unitaria no lo vio porque inyecta `delivery:'acknowledged'`. | `src/telegram/bot-search-driver.ts` ~209-219, `src/library/ordered-bot-acquisition.ts` ~143-145, `tests/unit/ordered-bot-acquisition.test.ts:169` |
| H3 | Medio | Una admisión denegada en `selection`, o un `expired` ajeno en `search`, terminan en «Ningún bot entregó un archivo válido». | `ordered-bot-acquisition.ts` ~149, ~230-237, ~286-298 |
| H4 | Medio | Un menú reutilizado tras `file-invalid` o `file-too-large` ignora una suspensión en `selection` por el `error` residual. | `ordered-bot-acquisition.ts` ~132-142 y ~289, `session-client.ts:109-110` |
| M8 | Menor | Un `conflict` tras acuse en la descarga cae en `telegram`, con 4 reconexiones al mismo bot. Debería pasar al siguiente bot. | `ordered-bot-acquisition.ts` ~149-150 |
| M9 | Menor | «No existe en tus bots» también sale con `limit` y `needs-start`. Requisito del propietario: ese texto solo cuando ningún bot tiene la canción. | `src/library/download-song.ts:74` |

La revisión 5 dio por resueltos B1, B2, B3, M4, M6 y M7. M5 quedó parcial, roto por H1.

**Trabajo a medias de la quinta ronda (cancelada):**
- Está en la rama local `wip/pr20-quinta-ronda`, sin push.
- Contiene el merge de `ecea5e7` y cambios sin terminar ni probar en 7 archivos, guardados sin ejecutar los hooks.
- Úsala solo como referencia. El encargo original de esa ronda está en el hilo T3 «Quinta ronda: bucle de álbum en cola y timeout de audio directo».

**Al retomar:**
- Partir de `f13b770` e integrar `origin/feat/library-full-albums`.
- Corregir H1–H4 y los menores, con pruebas que usen la salida real del driver.
- Añadir un tope de relanzamientos automáticos en el despachador.
- `tap-baseline` solo se ejecuta contra `7d41d25`: afirma el bug antiguo y falla contra head a propósito.
- La prueba de interfaz ya fallaba en la base con el minirreproductor al 200 %.
- Después, una nueva revisión independiente, y publicar solo si el propietario lo autoriza en ese momento.

## 2. Mejoras de velocidad · rama local `perf/faster-bot-pipeline`

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

## 3. Aceptación física en iPhone

Ver `docs/IPHONE-ACEPTACION.md`. Son 16 pruebas que solo puede hacer el propietario. B1, B2 y C3 dependen de la PR 20.

## 4. Engram desincronizado entre ramas

- La base compartida `.local/engram` quedó sincronizada con los ODD de la PR 20 en `f13b770`. Los worktrees enlazan esa misma base.
- En el checkout principal (`feat/library-full-albums`), `python3 scripts/sync_odd_memory.py --read-only` falla con «Receipt/source mismatch» en P0-W, T10, T11-T12, T3 y T8.
- Es esa divergencia de ramas, no corrupción: el recibo de T3 coincide con `git show f13b770:odd/tasks/T3-gate-fisico.md`.
- Se resuelve al integrar la PR 20 con `ecea5e7` y sincronizar desde el resultado. No sobrescribir la memoria para esconderlo.

## 5. Decisiones del propietario sin responder

- Despliegue automático en Cloudflare al hacer push: sin decidir. No configurar nada.
- Bot privado de YouTube Music en un equipo de su casa: idea opcional, sin respuesta. El acceso directo desde la app web a YouTube no es viable; ver `.local/research/ytmusic-direct-neon-2026-11-24/report.md` y `.local/research/youtube-viability-2026-11-24/report.md`.
