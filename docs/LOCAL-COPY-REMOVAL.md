# Retirada explícita de una copia local

Incremento web entregado en `51c9bdf061455432`, con revisión independiente y selección integrada actual de22 grupos PASS en Chromium. P0-W/T12 y la aceptación física de iPhone siguen pendientes. La misma copia privada fue actualizada; allí la reproducción continúa en modo Blob y la retirada se bloquea porque no hay controlador Service Worker verificable. No se habilita una alternativa que eluda esa comprobación.

La función revisa una generación actual local de hasta8MiB y hasta32 fichas vinculadas. Conserva identidad de fichas, favoritos, playlists, correcciones históricas, datos de álbum, referencias de organización y huella de audio. Retirar audio no elimina las fichas. Reimportar los bytes originales exactos vuelve a enlazarlas; título y artista no se usan para fusionar canciones.

En una fila apta, «Revisar retirada» consulta archivo y referencias, termina su lectura corta, reserva la generación y comprueba el transporte actual. La cola actual, las colas preparadas, las preparaciones pendientes y las fuentes retenidas protegen sus archivos. No se pausa el reproductor para volver elegible una copia. El consentimiento exige una declaración sin preselección y una confirmación específica del plan. Descargar/exportar o pedir persistencia no demuestra que exista una copia externa.

El journal distingue intención preparada, fichas desvinculadas, eliminación en curso, ausencia confirmada y operación no confirmada. Cancelar no revierte una fase comprometida ni una llamada nativa pendiente: espera su cierre. Una inspección explícita puede asentar un recibo existente con exclusión y CAS, pero no borra ni repite una operación. Continuar una retirada parcial requiere revisar y confirmar otra vez. Perder una respuesta, obtener una lista vacía o terminar el estado ocupado no demuestra que no hubo escritura.

Al arrancar se lee sólo el prefijo propio de journals, después de abrir normalmente la base y antes de restaurar la cola. No se escanea toda la biblioteca ni se elimina un seguimiento por ausencia de journal. Los resultados terminales pueden comprobarse sin exigir que metadatos ajenos posteriores permanezcan iguales; una anomalía física conserva la necesidad de revisión. No hay borrado automático al abrir.

La UI retiene el intento durante su refresh propio aunque muestre un resultado terminal. Cerrar u otra inspección no liberan reserva ni runtime antes de terminarlo; cancelar y desmontar esperan la promesa propia. Un fallo de refresh se informa como secundario. El retorno de foco usa un encabezado alternativo cuando el invocador queda deshabilitado. Una lectura de tracking indisponible conserva la incertidumbre. Los callbacks antiguos de organización se comprueban antes de iniciar Activity o llamar a una API y no reviven al recuperar el permiso.

Cuando existe la API Service Worker, se exige controlador actual verificable con `physicalSources:1` e `idbLifecycle:1`. Una observación antigua de «no hay registro» no prueba su ausencia durante toda la operación; ese caso se bloquea. La ausencia real de la API mantiene la variante acotada documentada, sin eludir una denegación del transporte. Capacidad, integridad física, manifiesto, permiso y propiedad se comprueban por separado.

Evidencia separada, sin sumar etapas:

- Core R91:28 grupos nativos IDB/OPFS y4 unitarias con protección confiable sintética; revisión R99 favorable con8 probes nativos y4 Node propios.
- Runtime corregido: revisión R96 favorable; la ausencia de controlador con API presente se deniega conservadoramente.
- R97/R98 preservan tres defectos iniciales; R101 cierra el delta con20 probes de lógica propios. R102 preserva el nuevo defecto de exportación antigua; R103 lo cierra con35 probes Node y un control negativo. Los dobles de esas revisiones no acreditan integración nativa.
- R104 ejecuta una selección final completa de22 grupos sobre las107 fuentes actuales:20 originales y2 vecinos de callbacks/backup. IDB/OPFS, consentimiento, alias, fuentes protegidas, ACK perdido, recuperación, cancelación, settlement, foco y todos los almacenes comprobados. Los intentos previos y fallos del arnés están conservados.
- Build de producción: tipos/lint, archivos/rangos IDB+OPFS, teclado6, licencias3, actualización normal desde3899 y smoke nativo de retirada/reimportación o denegación sin controlador PASS. El origen del check de licencias se detuvo para su caso offline; la reapertura offline del check de archivos mantuvo disponible su origen.
- Acceso HTTPS privado: regresión amplia con datos propios y dos pestañas PASS. Una revisión de retirada sin controlador se deniega, conserva todos los datos y mantiene la reproducción. No acredita retirada positiva ni offline de ese acceso.

El presupuesto de metadatos retenidos es estimado: no garantiza heap y el clon nativo de un registro puede ocupar más transitoriamente. No se implementa GC/LRU de generaciones antiguas ni borrado seguro de disco; no se garantiza espacio liberado. No hay prueba de crash/purga física, iPhone, VoiceOver o zoom real. USD0. Evidencia y hashes en [evidence-local-copy-removal-web.json](evidence-local-copy-removal-web.json).

## Retirar una playlist o un álbum: candidato local

Biblioteca incorpora «Eliminar playlist» y «Retirar álbum». La revisión presenta la colección completa, las copias potencialmente elegibles y las compartidas. El álbum se calcula sobre toda Biblioteca, aunque la vista tenga filtros. La confirmación es explícita; abrir la revisión no elimina archivos.

Eliminar una playlist conserva la pertenencia de sus canciones a Biblioteca. Retirar un álbum quita de Biblioteca sus miembros. Después se examina cada archivo físico una sola vez: se conservan los favoritos, otras playlists, otras pertenencias a Biblioteca, las referencias de cola y las fuentes o lectores activos. No se pausa ni se vacía la cola para volver elegible un archivo. Las fichas y sus huellas permanecen para reconocer una futura reimportación.

Las escrituras organizativas comparten el bloqueo de la retirada. Cada archivo exige una reserva y comprobación de runtime nuevas; su cierre nativo, recibo y actualización de la vista preceden a la liberación. Cancelar impide nuevas retiradas, pero no deshace un commit confirmado. Una incertidumbre detiene el lote y se presenta en la revisión manual existente, sin reintentos automáticos. El puntero de seguimiento se limpia antes de podar un recibo terminal; si el ACK falla, sólo se restablece cuando una lectura fresca demuestra que el journal original sigue presente. Un ACK que ya comprometió su limpieza no genera un puntero huérfano.

La evidencia local está en `.local/collection-removal-final-main/REPORT.md`: main minificado y CSS real, retirada física IDB/OPFS con SW real, protección de referencias compartidas, continuidad del audio y Pausar, álbum global filtrado, fallo de ACK y recuperación por la UI. Las barreras y fallos inyectados se identifican como TESTONLY. La prueba de 35 archivos verifica ACK secuenciales sin elevar el límite de journals; las carreras físicas preservan el siguiente archivo. La barrera OPFS retiene la observación de la promesa original y no demuestra un syscall físicamente prolongado.

El control de versión de DB y el retorno de control entre pestañas tienen pruebas acotadas; no se afirma una pérdida forzada de owner durante una escritura ya enviada ni una matriz exhaustiva de cola persistida. La geometría se comprobó con CSS compilado a 320 × 568 y zoom de escritorio del 200 %. El resultado de desbordamiento del arnés de desarrollo no se atribuye al producto: sus estilos inyectados estaban bloqueados por CSP. No se modificó música real. Este candidato aún no está publicado y no acredita iPhone, fallos físicos del dispositivo ni cierre global P0-W.


## Comprobación actual · 2026-11-09

La entrega funcional `9709829634c283c5` se comprobó con archivos propios en Chromium y Service Worker nativo. Quitar una descarga individual pasó en IndexedDB y OPFS: desaparecen manifiesto y bytes, conservando la ficha, pertenencia a Biblioteca y organización. No existe aquí una afirmación de borrar la canción de Biblioteca.

Retirar un álbum con tres pistas, una oculta por un filtro, retiró de Biblioteca sus tres miembros y eliminó las dos copias exclusivas. Conservó la copia protegida por favorito y playlist, además de la playlist, cola y audio activo. Cancelar la revisión no modificó esos datos. Los tres casos pasaron sin cambiar producto ni tocar música real. Informe: `.local/song-album-removal-check/REPORT.md`. No acredita liberación física de disco del sistema, borrado seguro ni iPhone.


## Caché de escucha y colecciones compartidas · 2026-11-09

La limpieza de caché reutiliza la revisión, snapshot, CAS, bloqueo de escritor, reservas físicas y recibos de la retirada de colecciones. Su fase organizativa no borra playlists ni cambia la pertenencia a Biblioteca; cada archivo se vuelve a comprobar antes de retirarlo. Si una canción pasa a Biblioteca o una playlist entre revisión y confirmación, la revisión se rechaza sin borrar sus bytes. Un resultado incierto conserva el seguimiento y no se repite automáticamente.

La regresión de eliminar playlists confirmó nuevamente que desaparecen las copias exclusivas y se conservan los archivos de otras playlists, Biblioteca, álbumes y favoritos. En caché se retiraron dos archivos propios IDB/OPFS, manteniendo referencias compartidas, alias separados, cola y reproducción. Los casos de alias detached y cambios concurrentes son fixtures negativos. No se retiró música real. Véase [evidencia de caché](evidence-listening-cache-web.json); iPhone continúa pendiente.
