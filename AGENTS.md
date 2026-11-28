# Pulso Web: trabajo y memoria local

Leer README.md, docs/architecture/SPEC.md, docs/guides/PENDIENTES.md y la tarea ODD aplicable antes de trabajar. Metodo: ODD + Engram local; no RDD/OpenDesign.

## Protocolo obligatorio de memoria

- Identidad exclusiva: `Pulso-Web` (Engram canoniza `pulso-web`). Base persistente propia: `.local/engram/`. Configuracion de contexto: `.engram/config.json`.
- `.engram/` conserva la configuracion local de contexto y está excluido del seguimiento Git; no borrarlo ni sustituirlo por una configuracion global.
- Al retomar, leer `odd/tasks/P0-W.md` y las tareas aplicables; ejecutar `python3 scripts/sync_odd_memory.py --read-only`. Debe devolver `FullContentVerified: true` para todos los archivos. Ante diferencias, investigar; no sobrescribir memoria para esconder una divergencia.
- Despues de cambios autorizados en ODD, ejecutar `python3 scripts/sync_odd_memory.py` y luego, en otra invocacion, `python3 scripts/sync_odd_memory.py --read-only`. Verificar proyecto, contenido completo, cantidad de bytes y SHA-256. No anunciar sincronizacion si falla.
- El helper conserva manifiestos y partes verificadas por MCP oficial, con un bloqueo del proyecto y recibos privados. Los Markdown y el codigo conservan autoridad.
- MCP nativo: `engram_pulso_web` en `.codex/config.toml`; ejecuta `python3 scripts/engram_local.py`. Si la sesion ya abierta no recarga herramientas, utilizar el helper inmediatamente: tambien llama al MCP oficial y no requiere reiniciar T3.
- Guardar decisiones, causas y evidencia local. No guardar credenciales, sesiones, chats privados, datos reales de Telegram, audio ni secretos. No usar bases globales, de Music_Telegram, otro proyecto o Engram Cloud. No ejecutar `engram setup` global ni inscripciones Cloud.
- `.local/` y `.tools/` quedan fuera de Git. Engram no es dependencia del producto ni forma parte del bundle.

## Alcance y evidencia

USD 0. Trabajar solo en este proyecto; no modificar servicios ajenos. Pruebas locales pueden usar loopback temporal. Publicacion HTTPS, cuentas reales y permisos sensibles requieren autorizacion aplicable. Local, navegador e iPhone fisico se registran separados. No convertir un pendiente en PASS ni declarar P0-W completo por un piloto o build.

**Pendiente abierto del propietario (2026-11-25): aceptación física en iPhone.** Leer `docs/guides/IPHONE-ACEPTACION.md` antes de cerrar cualquier entrega que toque descargas, reproducción, sesión de Telegram u offline. Tiene 16 pruebas que solo hace el propietario. Él las marca en la página privada que enlaza ese archivo. Sin su resultado, cada prueba sigue NO EJECUTADA. Transcribir lo que reporte a `odd/tasks/T3-gate-fisico.md`.

**Publicación vigente (2026-11-28):** v70 (`/releases/8343797dc7910080.html`), rama `release/v70`. La PR 20 sigue abierta.

**Mejoras de velocidad (2026-11-25):** el propietario las retomó como T25 (`odd/tasks/T25-velocidad-bots.md`); el incremento 1 está publicado en v62. La rama local `perf/faster-bot-pipeline` queda solo como referencia; no publicarla ni fusionarla.

## Entregas y colaboración

- Indicación expresa del propietario (2026-11-17): publicar en Cloudflare los cambios verificados de Pulso al cerrar la entrega, además de Git/PR; no dejar una entrega autorizada sólo en local o en la PR ni volver a pedir la misma autorización. Conservar USD 0, configuración y datos existentes, verificar la versión pública y registrar el resultado. Esta preferencia no autoriza cambios de infraestructura, servicios ajenos ni publicar trabajo que no haya pasado sus verificaciones.

- Indicación expresa del propietario (2026-11-25): publicar sin volver a preguntar cuando la entrega quede validada. Validada significa que cada parte corregida tiene su prueba en la matriz ODD de su tarea, en el nivel donde vive el fallo; que la batería completa pasa; y que la revisión independiente no deja hallazgos bloqueantes ni altos frente a la versión publicada. Si algo de eso falla, no se publica y se informa.
- Indicación expresa del propietario (2026-11-25, revisada): usar modelos de bajo consumo. Implementar, integrar y publicar: Codex `gpt-6.1-terra` medio. Commits, notas y tareas mecánicas: Codex `gpt-6-luna` bajo. Requisitos y revisión independiente: Antigravity `gemini-4-neon` medio. `gpt-6.2-sol` solo con autorización expresa del propietario. Si un agente falla, informar al propietario antes de subir de nivel.
- Indicación expresa del propietario (2026-11-25): solo el orquestador (Claude) o Gemini pueden orquestar, delegar o iniciar otros agentes. Los agentes Codex (`gpt-6.2-sol`, `gpt-6.1-terra`, `gpt-6-luna`) son ejecutores: no inician workers ni subagentes, no usan `orchestration worker-start` ni la sección SUB-DISPATCH del preámbulo de Orca, y sólo usan la orquestación para informar con `worker_done` o preguntar con `ask`.
- Entregar los cambios de Git en una rama y una PR con problema, comportamiento resultante, validación y pendientes, para que los colaboradores puedan revisarlos.

## Consumo de cuota de agentes

Indicación expresa del propietario (2026-11-25):
- Un trabajador nuevo por ronda. No encadenar rondas en el mismo hilo; el encargo nuevo resume lo necesario.
- Validación proporcional, conforme a docs/architecture/SPEC.md §V.2: en cada ronda, solo las pruebas del cambio y de su área. La batería completa (unitarias y matrices de navegador en ambos motores) se ejecuta una sola vez, antes de publicar.
- Salida mínima: leer solo los totales y los nombres de los casos fallidos. Nunca volcar registros completos al contexto; guardarlos en `.local/tmp/` y citar la ruta.
- Como máximo dos trabajos pesados (pruebas de navegador) a la vez. Medir tiempos solo con carga de 1 minuto menor de 1,5.
- Encargos cortos: citar secciones concretas en vez de pedir leer documentos enteros.
- Agrupar arreglos pequeños en una misma publicación.

## Espacio de disco y limpieza de pruebas

- Al terminar cada prueba, tanto si pasa como si falla, eliminar sus canciones descargadas o generadas, audios sinteticos, perfiles temporales de navegador, copias de codigo, compilaciones y dependencias duplicadas creadas exclusivamente para esa prueba. Usar directorios propios en `.local/tmp/<tarea>-<id>/` y limpieza en `finally`/teardown; no dejar archivos de prueba como almacenamiento permanente.
- Conservar solo evidencia minima: resultado, comandos, hashes, causa del fallo y capturas imprescindibles. Evitar reportes JSON que incrusten canciones, binarios, bundles completos o estados repetidos. Presupuesto normal: 20 MiB de evidencia por ejecucion y 200 MiB de evidencia temporal total; si una prueba necesita superar ese limite, justificarlo y limpiar sus archivos pesados al concluir. No sacrificar evidencia unica de un fallo sin conservar primero un resumen verificable.
- Revisar y retirar artefactos regenerables de pruebas antiguas de mas de 7 dias que no esten en uso ni sean necesarios para una regresion pendiente. La limpieza de estos artefactos del proyecto queda autorizada: inventariar rutas y tamanos, usar una lista explicita de destinos y comprobar sus rutas reales antes de borrar; no seguir enlaces ni cruzar montajes, y nunca borrar `.local/` entera. Los archivos pesados de la prueba actual se eliminan al terminar, sin esperar esos 7 dias.
- NO borrar canciones de la biblioteca real del usuario, descargas personales, sesiones de Telegram, credenciales, conversaciones de T3/Codex, bases de datos de la aplicacion, `.local/engram/`, `.engram/`, `.tools/`, archivos versionados ni material usado por procesos activos. Una carpeta no es descartable solo por llamarse temporal: comprobar su funcion. Si hay duda entre un audio real y uno de prueba, conservarlo y pedir aclaracion.
- Medir el espacio libre de `/data` antes y despues de las pruebas y de la limpieza. Con menos de 2 GiB disponibles, liberar primero artefactos propios verificadamente regenerables y no iniciar pruebas que puedan agotar el volumen. No modificar servicios ni datos de otros proyectos para conseguir espacio.
- Al cerrar cada tarea, informar brevemente de lo eliminado, el espacio recuperado y los artefactos conservados por una razon concreta. No declarar que la limpieza es automatica hasta comprobar el teardown real de las pruebas afectadas.

## Reglas permanentes de subida (Open Source)

1. **Ramas y PRs:** trabaja en ramas `feat/`, `fix/`, `docs/` o `chore/`; nunca hagas push directo a `main`. Entrega cambios revisables en una pull request con problema, comportamiento resultante, validación y pendientes.
2. **Ubicación:** código de la aplicación en `src/`; configuración y Worker en `deployment/` y sus archivos existentes; guías en `docs/guides/`; contratos y arquitectura en `docs/architecture/`; evidencia autorizada en `docs/evidence/`; historia en `docs/archive/`; decisiones de diseño en `design/`; pruebas en `tests/`. Mantén `odd/tasks/` en su ruta y no alteres sus tareas salvo autorización explícita.
3. **Prohibido subir:** credenciales, tokens, `api_id`, `api_hash`, valores de `YOUTUBE_API_KEY`, sesiones o códigos de Telegram, datos privados, audio personal, archivos `.env` reales, `.local/`, `.engram/`, `.codex/`, `.tools/`, `.wrangler/`, dependencias, builds, logs, perfiles de navegador y HTML compilados de prototipos.
4. **Checklist pre-commit/PR:** revisa la rama y todo el diff; ejecuta `git diff --check`; comprueba que solo estén staged los archivos previstos y que no haya secretos ni datos privados; ejecuta las pruebas de la matriz ODD correspondiente (para el chequeo general: `npm run check`, `npm run typecheck:tests` y `npm run build`; añade `npm run test:browser` y `npm run test:browser:run` para cambios de interacción); anota resultados, limitaciones y aceptación física pendiente; deja un commit coherente y un árbol limpio.
