# Obtención secuencial de canciones

La selección comprueba primero la copia local y su integridad. Una copia válida se reutiliza para reproducir o añadir a Biblioteca; no vuelve a consultar al bot. Escribir, pulsar Enter, abrir un artista o abrir un álbum sigue consultando sólo el catálogo de metadatos.

Cuando falta el archivo, la misma intención recorre los bots compatibles en el orden configurado por el usuario, hasta un máximo de cinco. Se conserva una captura del orden, la cuenta, el ámbito y el objetivo musical. Cada proveedor recibe como máximo una búsqueda y una selección de su respuesta. No se cambia el orden configurado ni se inicia un bot por sí solo.

Se avanza al siguiente proveedor tras un resultado confirmado sin coincidencia suficiente, un audio incompatible, un archivo mayor del límite o bytes inválidos antes de importar. Se detiene ante cancelación, cambio del orden o del objetivo, sesión revocada, FLOOD_WAIT, plazo agotado, conflicto de revalidación o entrega incierta. Un fallo al guardar/importar tampoco provoca otra descarga. El plazo total de obtención es de 180 segundos por pista, compartido entre proveedores; el límite individual de archivo sigue siendo 8 MiB y el de descarga 120 segundos. El lote conserva su separación entre operaciones y nunca comienza a reproducir por haber añadido el álbum.

La coincidencia y la identidad local usan el crédito completo del intérprete, incluidas colaboraciones. No se reduce a un artista principal para aceptar el archivo. El título, la versión y la duración conocida siguen comprobándose. Los datos opacos de callback pertenecen al menú exacto revalidado; no se inventan ni se siguen enlaces, anuncios, pagos o uniones.

La cancelación queda ligada al recibo del comando admitido. Un intento rechazado no puede cancelar otro productor y un callback de interfaz antiguo no puede cancelar un gesto posterior. La incertidumbre de una fila impide su reenvío al continuar el mismo recorrido, incluso tras desconectar y reconectar en esa página. Esto no declara persistencia de esa cuarentena al cerrar o recargar la página.

El pool activo es propio de cada conexión, pero la selección confirmada y su orden se conservan localmente junto a la autorización. La recarga crea referencias nuevas sin consultas musicales ni resolución automática de perfiles; la búsqueda posterior vuelve a verificar cada identidad. Los resultados y la cuarentena de intentos no se vuelven persistentes por este cambio. Véase [sesión conservada](TELEGRAM-PERSISTENCE.md). Las sugerencias de bots no garantizan gratuidad ilimitada ni disponibilidad de cada canción.

## Verificación local

La entrega funcional `6513c86cdcc77922` excluye los cambios visuales concurrentes D1. Su archivo de fuentes corresponde al snapshot funcional de 169 rutas; no se presenta como build del árbol raíz completo. Auditoría: 3.693 miembros de fuente exactos, avisos de licencia comprobados y ausencia de identidad/configuración privada.

Pruebas unitarias del snapshot final: 610/610. La matriz nativa de 15 grupos y los tres grupos adicionales se guardan en recibos separados: no se presentan como una única ejecución de 18. El plazo adicional se midió con reloj real y sondeo de un segundo; la matriz inicial usa una aceleración TESTONLY del transporte. También hay controles separados de reconexión tras ACK incierto y tras revocación, sin nuevos envíos al continuar.

Chromium y WebKit de escritorio comprobaron el build minificado con metadatos y audio propios. WebKit conserva diez eventos históricos `style-src-attr`, separados de la ausencia de otros errores. La actualización desde `fdb26a48f8502c10` mantuvo el audio anterior y activó el service worker después del cierre normal de los clientes. Es evidencia local; no acredita iPhone físico, offline privado, background, identificación acústica ni P0-W completo.

Recibos privados: `.local/ordered-bots-release-complete/`, `.local/bot-fallback-main/` y `.local/mosca-final-ordered-live/`. Los resultados de cuenta real se mantienen separados de los fixtures. No se guardan chats, sesiones, IDs privados, audio ni hashes de audio en esta documentación.

## 2026-11-09 · Títulos entre catálogos y respaldo Deezer

Se admite también el orden de presentación «intérprete - título». El único alias de versión añadido es el sufijo terminal literal «(Album Version)»: requiere álbum y duración conocidos para seleccionar el candidato y una diferencia máxima de un segundo para el audio. El importador exige título presente, crédito completo, álbum completo coincidente y duración realmente analizada dentro de ese segundo antes de iniciar escritura. El grupo `recordingTitle/album/durationSeconds` debe llegar completo y validado; las versiones Live, Remix, Album-Version u otras palabras no se eliminan. Los títulos ordinarios conservan la tolerancia anterior de cinco segundos.

Una copia con el alias puede reutilizarse entre catálogos sólo con ese contexto completo. Las fichas separadas siguen participando en la detección de ambigüedad y el vínculo exacto a una huella conserva su prioridad. La verificación no transforma tags ni demuestra identidad acústica.

KD obtuvo la pista pendiente en la prueba real y dejó MOSCA con 17/17 copias en Biblioteca; dos reselecciones no generaron más búsquedas o descargas. Deezer pasó una comprobación independiente de su archivo ya entregado, sin otra consulta/callback ni escritura musical. No se afirma fallback real a Deezer en el recorrido que KD resolvió. Véase [Bots sugeridos por Pulso](BOT-SUGGESTIONS.md).
