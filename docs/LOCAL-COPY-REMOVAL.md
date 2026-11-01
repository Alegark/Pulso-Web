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
