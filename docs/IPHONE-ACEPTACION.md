# Aceptación física en iPhone · PENDIENTE

Estado al 2026-11-25: **NO EJECUTADA**. Solo la puede hacer el propietario, con su iPhone (declaró iPhone 13 con iOS 27) y su cuenta de Telegram. Ninguna prueba de navegador, Chromium o WebKit, la sustituye.

## Dónde marca el propietario

Página privada «Pruebas iPhone de Pulso»: https://claude.ai/artifact/73vnYbLnwJ2NesjKX3euBp

- Guarda un documento por prueba en la colección `pruebas` de la base de datos de esa página: `estado` (`ok`, `falla` o `pendiente`), `nota`, `version` y `fecha`.
- `meta/sesion` guarda la versión en ejecución que anotó.
- Solo una sesión de Claude con la herramienta `ArtifactData` puede leerla. Un agente sin esa herramienta pide al propietario el «Resumen para el chat» de la página; no supone resultados.

## Reglas para agentes

- `pendiente`, una prueba sin documento o una nota ambigua significan NO EJECUTADO. Nunca PASS.
- Transcribir cada resultado a `odd/tasks/T3-gate-fisico.md`, separado de local y navegador, con:
  - versión (hash de `/releases/<hash>.html`);
  - fecha;
  - prueba;
  - resultado;
  - nota.

  Sin números, códigos, nombres de chats, audio ni otros datos reales de Telegram.
- Un fallo reportado se intenta reproducir en navegador y se corrige en una rama con PR. No se reinterpreta como PASS ni se descarta por no reproducirse en Chromium.
- B1, B2 y C3 dependen de la v60 (PR 20, rama `fix/album-tap-save-queue`). No pedirlas antes de que esa versión esté publicada.
- Recordar la aceptación pendiente una sola vez al cerrar una entrega que cambie lo que cubre. No volver a pedir modelo ni versión de iOS.
- Si cambia el comportamiento cubierto, actualizar esta lista. La página la actualiza una sesión de Claude publicando en la misma URL.

## Pruebas

| ID | Prueba | Debe pasar | Desde |
| --- | --- | --- | --- |
| A1 | Abrir desde la pantalla de inicio (Safari → Agregar a pantalla de inicio) | Abre a pantalla completa, sin barra de Safari | v59 |
| A2 | Entrar con su Telegram en Ajustes → Conexiones; cerrar y reabrir | Sigue conectado sin pedir otra vez el código | v59 |
| B1 | Tocar la tarjeta de un álbum buscado en carátula, título y esquina vacía, también durante una descarga | Abre el álbum al primer toque desde cualquier punto | v60 |
| B2 | «Guardar álbum» | Cambia a «En Biblioteca» y aparece en Biblioteca sin descargar canciones | v60 |
| C1 | Descargar y reproducir una canción suelta | Se descarga y suena | v59 |
| C2 | Descargar una playlist de 15 a 30 canciones de una vez | El recuadro flotante muestra el avance y el lote continúa tras un fallo de pista. En v60, «No existe en tus bots» requiere ausencia confirmada y los rechazos informan su causa | v59 (mensajes corregidos en v60) |
| C3 | Pedir otra descarga mientras baja un álbum; tocar de nuevo la activa y la que está en cola | La segunda queda «En cola» y arranca sola. La activa ofrece «Seguir descargando» o «Cancelar descarga». La de la cola ofrece «Mantener en cola» o «Quitar de la cola». Si el álbum agota la recuperación, queda en cola con «Reintentar descarga en cola» | v60 |
| C4 | Bloquear la pantalla unos 30 s durante una playlist | Sigue; ninguna canción queda «No existe en tus bots» por el bloqueo | v59 (la v60 corrige su clasificación) |
| C5 | Bloquear unos 5 min durante una playlist | Retoma sola; ninguna canción queda inexistente por el bloqueo | v59 |
| C6 | Pasar de wifi a datos durante una playlist | Espera y continúa; ninguna canción queda «No existe en tus bots» por el corte | v59 (la v60 corrige su clasificación) |
| C7 | Cerrar la app del todo a mitad de una playlist y reabrir | Retoma sin volver a bajar las que ya tenía | v59 |
| D1 | Reproducir con la pantalla bloqueada, sin repetición ni aleatorio, al menos 3 canciones | Pasa sola a la siguiente; se anota cuántas sonaron | v59 |
| D2 | Pausa, siguiente y anterior desde la pantalla bloqueada | Responden y muestran título y carátula | v59 |
| D3 | 10 canciones / unos 30 min con la pantalla bloqueada | No se corta | v59 |
| D4 | Modo avión, abrir desde el ícono y reproducir lo descargado | Abre y suena sin conexión | v59 |
| E1 | Al día siguiente o tras reiniciar el iPhone | La Biblioteca y las canciones siguen y suenan | v59 |

Relación con las aceptaciones pendientes:

- **A1:** modo Inicio.
- **D1 y D3:** el avance automático con la pantalla bloqueada (AC04) y la observación de 10 pistas / 30 minutos.
- **D4:** offline.
- **C4 a C7:** suspensión, red y reanudación de lotes en el dispositivo real.

Ninguna queda aceptada por estar en esta lista.

## Historial

El protocolo anterior con tonos y muestras sintéticas está en `docs/IPHONE-GATE-T3.md`; se conserva como historia. Las observaciones previas del propietario («Funciona bien aún con bloqueo», «Todavía no lo comprobé») siguen registradas en `odd/tasks/T3-gate-fisico.md` y no se elevan a PASS.
