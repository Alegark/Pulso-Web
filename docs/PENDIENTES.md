# Pendientes abiertos · 2026-11-25

Pulso sirve [v60](https://pulso-web.pruebassoftware.workers.dev/releases/b5f7b46a815f9364.html) desde `fix/album-tap-save-queue`. La [PR 20](https://github.com/Alegark/Pulso-Web/pull/20) queda abierta. El registro de publicación está en [T24](../odd/tasks/T24-cola-colecciones.md).

## 1. Hallazgos abiertos de v60

- **Q09b, heredado de v59.** El shell no recupera automáticamente el control al volver de BFCache. «Usar en esta pestaña» devuelve el control y la cola reanuda la descarga.
- **Menor 1 de la revisión 8.** Una recuperación de una pista anterior puede dar una ronda adicional acotada de reconexión a una pista posterior.
- **Menor 2 de la revisión 8.** El temporizador de un menú retenido puede sustituir `file-invalid` o `file-too-large` por `expired` a los 120 s en una descarga de canción individual.

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

El trabajo sigue pausado por el propietario.

## 3. Aceptación física en iPhone

[Las 16 pruebas](IPHONE-ACEPTACION.md) siguen **NO EJECUTADAS**. Solo puede ejecutarlas el propietario en su iPhone con Telegram real. B1, B2 y C3 ya cuentan con la v60 publicada.

## 4. Engram de Pulso Web

La base local compartida `.local/engram` está sincronizada con los ODD de `fix/album-tap-save-queue` tras registrar v60. Una invocación posterior en modo lectura verificó el proyecto `Pulso-Web`, contenido íntegro, bytes y SHA-256 de los 19 archivos. Un checkout con ODD de otra rama puede mostrar divergencias respecto a ese recibo.

## 5. Decisiones del propietario sin responder

- Despliegue automático en Cloudflare al hacer push: sin decidir. No configurar nada.
- Bot privado de YouTube Music en un equipo de su casa: idea opcional, sin respuesta. El acceso directo desde la app web a YouTube no es viable; ver `.local/research/ytmusic-direct-neon-2026-11-24/report.md` y `.local/research/youtube-viability-2026-11-24/report.md`.
