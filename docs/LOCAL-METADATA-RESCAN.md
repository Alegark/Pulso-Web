# Reinspección local individual de etiquetas

Estado vigente: incremento entregado en `/releases/8cfb8eb02744ca5c.html`, en el acceso privado ya autorizado. R72 pasó la integración, R75 aprobó foco/resultado visible, R77 aprobó la clasificación de cancelación y R80 aprobó la apertura existente por solicitud. Los registros de etapas inferiores conservan sus fuentes y resultados históricos. P0-W e iPhone siguen pendientes.

La acción «Revisar datos del archivo» abre un panel para una canción. «Revisar archivo local» inicia una inspección explícita de su copia verificada IDB/OPFS, hasta 8 MiB. No se ejecuta al navegar, reimportar, deduplicar o restaurar. No consulta proveedores ni envía audio. Sólo obtiene número de pista/disco, artista de álbum y compilación; conserva título, artista, álbum, portada, letras, favoritos y playlists.

Las etiquetas son declaraciones del archivo, no autenticidad ni completitud musical comprobada. Se completan campos desconocidos; los conocidos se conservan con su evidencia. Un desacuerdo conocido o un registro dañado impide sustituirlos. Un archivo mayor queda sin inspeccionar antes de crear el worker; no se lee un prefijo para fingir revisión completa.

El worker es de sólo lectura, ligado al control vigente antes de acceder a IDB. Verifica y materializa los bytes una vez, comprueba generación y mantiene el lector hasta la confirmación final. Los límites de archivo, metadatos y registros aceptados no garantizan un máximo de heap: File, parser, clones nativos y GC también consumen memoria. No se copia audio al DOM ni se escriben/borran archivos.

La confirmación exige comparar el snapshot completo vigente de ficha y asset y guardar Track.localAlbum y recibo en la misma transacción. Parser y hash quedan fuera de IDB. Cancelar antes del commit impide aplicar; si el commit ganó, se conserva el resultado confirmado. Un cambio concurrente rechaza la revisión, sin rebase silencioso ni edición de otras fichas con igual hash.

El seguimiento usa sólo dos UUID y un slot local versionado, sin tags, rutas o contenido privado en diagnóstico. La interfaz retiene la incertidumbre aunque refresque la biblioteca. «Comprobar resultado» consulta el recibo coincidente, sin volver a inspeccionar el audio. Un prepared de la misma encarnación, sin intento activo bajo los locks, se liquida a not-committed antes de permitir otro gesto. Pérdida o incoherencia de encarnación/recibo sigue desconocida; no prueba ausencia de escritura. La salida explícita para almacenamiento nuevo conserva UNKNOWN histórico.

La interfaz bloquea nuevos cambios de organización/importaciones y la cesión mientras haya operación o resultado pendiente. Conserva los controles de reproducción disponibles y no activa busy global durante la lectura. Tras confirmación refresca con updateQueueTitles=false. Un fallo del refresh no revierte el commit ni repite la inspección.

R71: diez grupos Chromium nativo IDB/OPFS y dos grupos unitarios PASS, tipos/lint PASS. Recibo `.local/evidence/metadata-rescan-r71.json`; freeze original de siete fuentes en su carpeta. R72, R73 y R74 se ejecutaron después y detectaron defectos; sus resultados y correcciones se registran abajo. No se reetiquetan las matrices antiguas como ejecutadas sobre cada fuente posterior.

Reproducción del núcleo, previa compilación focal: `node scripts/browser-build.mjs metadata-rescan` y `INSTABOX_HEADLESS=1 npm run test:browser:run -- metadata-rescan`. Runner de producto en preparación: `tests/integration/check-metadata-rescan-main.mjs`. No repetir las matrices existentes sin cambio, fallo o duda concreta que lo justifique. USD 0; no Telegram, servicio externo ni aceptación de iPhone.


## Verificación posterior R72/R74

R72 final: once grupos de producto PASS, con foco de entrada/retorno, terminal visible hasta cerrar y snapshot completo actual. Evidencia `.local/evidence/metadata-rescan-main-r72.json`; no acredita SW ni iPhone. R74 solicita corregir la clasificación de un aborto nativo durante el commit pendiente: informa almacenamiento en vez de cancelación, con Track intacto y journal not-committed. La revisión integrada todavía no está aprobada ni publicada; R76 corrige ese delta y R75 revisa foco/terminal. Los PASS del núcleo y producto se conservan por fuente y etapa.


R75 posterior aprueba limitadamente la corrección del foco y la persistencia del resultado terminal: RED anterior y seis vecinos GREEN, con un caso TESTONLY diferido identificado. La condición de navegador de R73 queda satisfecha por R72 final sobre las mismas fuentes. El P2 del core R74 sigue separado y pendiente de R76; todavía no hay entrega nueva.


## Entrega final web · 2026-11-01

R77 aprobó el delta de aborto propio tras RED→GREEN: mantiene cuota/IO primarios, aborto ajeno y commit ganador. R79 corrigió una carrera real de primer uso: el helper de rescan imponía temporalmente un guard de upgrade al realm entero y podía bloquear la creación legítima de la base. La nueva API openExistingDatabase limita únicamente su propia solicitud. Un lector por sí solo no crea ni migra, y ya no veta el open normal concurrente. R80 comprobó el resto de database y la reparación anterior byte a byte y aprobó el delta.

R79: ocho grupos finales —siete nativos y producto IDB/OPFS sin preseed—, cero errores/externos; R80: cuatro probes propios. Se conserva el FAIL original del candidato 8a4, además de los errores de observación de los harness, separados del defecto de producto. El nuevo build 8cfb pasó assets/rangos de ambos backends, teclado6, licencias3 y actualización normal desde c44. El smoke HTTPS propio confirmó revisión explícita no-change con audio activo y fuente conservada, backup v2, exportación OPFS exacta y handoff a nueva pestaña pausada. Se copiaron y verificaron 35 archivos, conservando los assets anteriores.

La ruta de medios SW/offline se prueba en loopback; el acceso privado usa Blob acotado y no tiene aceptación offline. No hay proveedor externo activo, borrado de copias ni nuevo resultado físico de iPhone. El presupuesto de 8 MiB de archivo no garantiza heap total. Recibos correlacionados y hashes: docs/evidence-metadata-rescan-web.json y .local/evidence/metadata-rescan-delivery-parent-verification.json. ODD y Engram se verifican por separado tras el cierre.
