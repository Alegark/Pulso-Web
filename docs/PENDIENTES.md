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

La base local compartida `.local/engram` corresponde a v61 (`d718b9d`, `fix/artwork-rows-dock`). T25 usa la copia de proyecto en su propio worktree. La sincronización de T25 con la base compartida queda pendiente de la integración con v61.

## 5. Decisiones del propietario sin responder

- Despliegue automático en Cloudflare al hacer push: sin decidir. No configurar nada.
- Bot privado de YouTube Music en un equipo de su casa: idea opcional, sin respuesta. El acceso directo desde la app web a YouTube no es viable; ver `.local/research/ytmusic-direct-neon-2026-11-24/report.md` y `.local/research/youtube-viability-2026-11-24/report.md`.

## 6. Infracción CSP heredada en WebKit

WebKit WPE emite `style-src-attr` con `blockedURI: inline` para el selector de Apariencia de [src/main.tsx:1538](../src/main.tsx#L1538). El mapa de fuentes sitúa el evento en `node_modules/react-dom/cjs/react-dom-client.production.js:8514`, en la llamada que crea el elemento `select`. La política aplicada procede de [index.html:1](../index.html#L1). La reproducción se confirmó en v60 (`086aaac`). El arnés de velocidad registra esa infracción y decide frente a una ejecución de v60 del mismo perfil.
