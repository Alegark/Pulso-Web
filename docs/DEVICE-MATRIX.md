# Evidencia por entorno · 2026-10-31

Local Linux / Node 22.23.3: PASS typecheck, lint TypeScript, 5 pruebas unitarias, build Vite. npm audit: 0 vulnerabilidades conocidas en el momento de consulta. Ninguna prueba acredita audibilidad.

Navegador real: NO EJECUTADO. No se ha abierto un puerto ni servido el bundle. Detección de capacidades preparada en la interfaz, valores reales DESCONOCIDOS.

iPhone Safari normal: NO EJECUTADO.
iPhone Chrome normal: NO EJECUTADO.
iPhone modo Inicio: NO EJECUTADO.

T3 / AC04, AC06, AC10: PENDIENTE. Antes del teléfono: añadir MP3/AAC sintéticos, AssetStore mínimo con manifiesto y verificación, SW/rangos, pruebas de cortes y navegador. No pedir todavía una prueba física sobre un incremento sin transporte offline.

Acta futura por caso: fecha, revisión/hash del lockfile, build, origen HTTPS autorizado, modelo/iOS, navegador/versión, modo normal/Inicio, codec/tamaño/duración, red, bytes disponibles al bloquear, acciones, transiciones observadas, duración, resultado y límites. Sin credenciales ni contenido privado. Tres pistas cortas son diagnóstico; aceptación completa exige además 10 pistas y 30 minutos observados.

## Incremento T3 · evidencia posterior

Chromium 154.0.0.0 Linux x86_64, preview T3, contexto seguro loopback: PASS A→B→C WAV y MP3/AAC-LC/MP3, estados/tiempos/solicitudes del navegador. No se afirma haber oído audio. PASS almacenamiento IDB (6 casos reales), 9 checks HTTP y segunda pestaña deshabilitada. Servidor 4173 apagado: reapertura `/`, shell cargado, recuperación de B pausada; reproducción A→B→C sin servidor. La red general del navegador no se deshabilitó; el único origen del producto estaba apagado. No equivale a cierre completo de Chrome ni reinicio forzado de SW.

Local actualizado: PASS 8 unitarias. Archivos `evidence-storage.json` y `evidence-media.json`. iPhone y aceptación completa permanecen NO EJECUTADOS. Las notas iniciales NO EJECUTADO de navegador describen el estado anterior, reemplazado por estos casos específicos.

## Refuerzo T3 posterior

PASS 9 unitarias locales. Chromium 154: PASS 11 casos IDB con cortes/cancelación, cuota simulada y corrupción de manifiesto. PASS corrupción de bytes rechazada antes de entrega, revocación de ticket viejo, ticket nuevo y conservación del original; segunda pestaña recibe 403/0 bytes. Repetición offline de origen apagado y A→B→C PASS. Nuevas evidencias JSON con sufijos storage-cuts/media-integrity/cross-tab. NO EJECUTADO: cuota física real, iPhone y reinicio forzado del SW. Este registro amplía casos concretos, no aceptación completa de AC08/AC09/AC19.

## Fase web autorizada (iPhone aplazado)

Por orden posterior del propietario, el gate físico no bloquea esta fase. iPhone Safari/Chrome/Inicio: APLAZADOS/PENDIENTES, sin PASS. Modelo/OS informado por el propietario: iPhone 13, iOS 27; no verificado mediante inspección y sin prueba ejecutada.

Chromium 154 Linux: 10 casos importación/biblioteca PASS en tests/browser/library.html; 6 checks HTTP sobre asset importado PASS; selector real cargó A MP3, B AAC-LC/M4A y C MP3, permitió reimportación, crear playlist/añadir A y mantuvo selector disponible. Repeat-one observado más allá de un ciclo. Build de producción abierto desde shell con servidor apagado: 3 tracks y playlist conservadas, cola pausada, tras gesto A→B→C por SW. No prueba audio audible ni iOS, cierre completo de Chrome o SW forzado a terminar. Evidencias JSON con sufijo web. Local: typecheck/lint/build y 12 unitarias PASS. Cuota en runner es inyectada, no disco físicamente agotado.

## Observación aportada por propietario tras enlace real

iPhone 13/iOS 27 declarados; captura de Safari muestra error de gateway por servidor sin listener (reproducido localmente como ausencia de proceso). Se recuperó el servidor como servicio de usuario independiente. Después el propietario informó «Funciona bien aún con bloqueo». Resultado: observación física positiva preliminar, duración y avance a archivo distinto DESCONOCIDOS, AC04/AC07 completos PENDIENTES. No hay prueba física de offline/Inicio/remoto ni 10 pistas/30 minutos.

Chromium sobre HTTPS privado: botón de muestras importó tres archivos; registro SW recibió 401 y bloqueó preparar cola en ese ensayo. Es un fallo de ese caso y origen, no se transforma en PASS por la observación del teléfono. No se ha hecho público el acceso para sortearlo.

Aclaración del propietario: todavía no comprobó que terminase una pista y empezase sola la siguiente mientras estaba bloqueado. Avance entre pistas bloqueado: NO EJECUTADO/PENDIENTE. Continuidad de pista: reporte positivo del usuario sin duración medida.

Compatibilidad privada posterior: PASS Chromium 154 por HTTPS privado, modo Blob acotado, tres fragmentos musicales propios (16.5 s cada uno): Aurora playing y Camino ended al final de cola. Seis checks de bytes/owner/revocación PASS en runner browser. Primer ensayo falló por CSP y se corrigió. No representa evidencia nueva de iPhone, bloqueo, offline o 30 min; avance físico continúa NO EJECUTADO hasta observación del propietario.

Reporte posterior del propietario sobre /samples.html: «Funciona bien». Conformidad funcional de la página de muestras aportada por usuario; sin nueva afirmación explícita de duración, avance bloqueado, offline o modo Inicio. No elevar a AC04 completo.

## OPFS, recuperación y reapertura completa de Chromium

Chromium 154.0.8037.57 Linux headless con sandbox, perfiles y orígenes loopback aislados: OPFS 10 grupos PASS (incluidos cortes/cuota simulada/propiedad/recuperación/cancelación), biblioteca IDB 10 PASS, Blob IDB 6 checks y Blob OPFS 7 checks PASS (incluye rechazo de longitud física sobrante). Cancelación del lote contra commit mantiene 1 archivo confirmado y nunca inicia el segundo, PASS con producto/worker reales. Typecheck/lint/build PASS; unitaria focal de límites Blob PASS. No se repitieron SDK ni suite del piloto.

Producto actual: IDB y OPFS, cada uno con 8 checks HTTP íntegros/rangos/HEAD/416/multipart ignorado, otro Client 403, orden CDP stopAllWorkers aceptada y lectura siguiente válida. Se cerró Chromium completamente y se abrió de nuevo con el perfil temporal propio, red deshabilitada: shell, biblioteca, cola pausada y GET íntegro/rangos de copia persistida PASS para ambos. Se probó entrega de bytes; no escucha audible ni cola de 30 minutos. Perfiles de prueba eliminados.

UI de recuperación: pérdida de acuse de cierre en worker conserva copia, detiene siguiente archivo y bloquea importación; nueva pestaña recupera mediante worker y publica exactamente 1 track/asset. Job legacy sin owner bloquea hasta revisión expresa y conserva su estado writing y sus 3 bytes de prueba. Ambos casos PASS. Captura de cambios/evidencia: evidence-opfs-recovery.json. Copia HTTPS histórica sin actualizar en esta ronda. iPhone, cuotas físicas, almacenamiento bajo presión real y gates Telegram permanecen PENDIENTES; las notas antiguas de no reiniciar Chromium quedan superadas solo para estos casos de escritorio.

## Portadas y candidato web actualizado

Chromium 154.0.8037.57, loopback/headless/sandbox: 30 casos de modelo/worker de portadas PASS reportados por ronda Sol r3 (21 iniciales ampliados por correcciones); integración UI 5 casos PASS repetidos sobre el módulo final. Sin violaciones CSP ni errores de página: imagen real comprobada por píxeles Canvas, manual/reimport/reload, URL revocada, ocultación manteniendo el engine activo y reparación de registro dañado con token. No se cuenta el JSON privado inicial de 21 como si contuviera los 30 finales. Typecheck/lint/build PASS. OPFS 10 grupos repetidos por cambio real de capability: fallback IDB elegido antes de escribir si falta createWritable, PASS. No se atribuye esa simulación a un fallo observado en iPhone.

Transporte normal, tras añadir consulta de capacidades, repite PASS 8 HTTP checks por backend, Client ajeno 403, orden de parada SW y lectura posterior, y reapertura offline tras reiniciar Chromium con perfil propio. Falta de respuesta de protocolo simulada: 1 consulta, 0 tickets hacia el transporte no confirmado, Blob acotado, 1 engine y 0 activaciones forzadas, PASS. No demuestra por sí solo compatibilidad con todos los builds históricos.

Se actualizó el mismo acceso privado autorizado: 26 archivos de build copiados/verificados preservando assets anteriores y entrada /web.html. Reinicio únicamente del servicio propio para aplicar CSP de imágenes Blob. HTTPS privado real, contexto Chromium nuevo: página 200, imagen manual propia visible, audio sintético importado y play activo, 1 engine, transporte bounded-blob y 0 violaciones CSP, PASS. No se cambió el modo privado ni se publicaron otros puertos/cuentas. Esta actualización supera la nota anterior de copia no actualizada solo desde este registro. iPhone físico/Inicio/avance bloqueado/30 minutos y offline del enlace privado siguen PENDIENTES; sin extrapolar loopback al gateway privado.

## M4A/WAV, agrupaciones y actualización compatible

Chromium 154.0.8037.57 Linux, headless con sandbox: ronda T7 r7, 27 grupos M4A/WAV PASS (r4 tuvo 20 y r6 26; no se suman). AAC propio de 44.000 paquetes / 12.914.649 bytes / 2023,21995 s: copia/hash, duración parser/nativa, inicio y seek cerca del final PASS; no escucha de 33 minutos. Producto real: portadas M4A/WAV comprobadas por píxeles, un engine, reapertura completa de Chromium offline con portadas conservadas y cola pausada PASS. evidence-artwork-containers.json.

Agrupaciones: 10 unitarias y 4 casos de producto PASS; variantes no fusionadas, álbum siempre de completitud desconocida, filtros sin alterar reproducción/cola, playlist intersectada y metadata manual reagrupada. evidence-library-groups.json. Regresión focal biblioteca: fixture legacy y asset importado de igual SHA coexisten sin colisión; 10 casos PASS mediante build aislado .local/browser-tests-legacy. Un build compartido intermedio falló porque el subagente todavía estaba creando la entrada local-batches; no se presenta ese intento como PASS.

Actualización entre dos builds reales: nuevo HTML versionado supera caché del shell anterior, SW nuevo espera, cliente anterior sigue reproduciendo y nuevo queda pausado; al cerrar ambos clientes se activa y restaura pausado, PASS. Control anterior conservado en .local/releases/compat-before-groups. evidence-live-update.json. Copia privada autorizada actualizada a 27 archivos con entrada /releases/bd16eb4b950475f5.html; probe HTTPS PASS (agrupación visible, PNG propio, importación y reproducción, un engine, bounded-blob, cero violaciones CSP). Las limitaciones físicas y offline del gateway privado continúan pendientes.

## Lotes locales y cuota de importación

Chromium 154.0.8037.57 con sandbox, loopback aislado: 16 grupos de lotes PASS (incluyen correcciones de terminal/retry, validación, progreso cancelado y errores IDB tipados). Producto real, 3 casos PASS: verificación de playlist completa pese al filtro, cancelación/reintento sin parar el audio, y bytes ausentes con persistencia de organización/lote tras recarga. Conteos por ocurrencia, bytes deduplicados por asset; no son descarga ni espacio nuevo.

Cuota inyectada detectó un fallo real de control del lote de importación: continuaba con archivo siguiente tras fallo. Corregido en worker/UI; OPFS e IDB PASS con original previo/hash preservado y siguiente no iniciado. Cancelación postcommit regresión PASS. Evidencia docs/evidence-local-batches-web.json separa antes/después, suites y límites. No demuestra presión física real.

Copia privada actualizada, 28 archivos, entrada /releases/521caf0e9610874b.html: probe Chromium HTTPS con contexto limpio PASS, imagen/audio propios, lote complete, 1 motor sigue reproduciendo, bounded-blob, 0 violaciones CSP. No nuevos puertos/publicación ni cambio de autenticación. Offline de ese origen e iPhone permanecen pendientes.

## Letras locales: texto/LRC/ausencia y reparación

Chromium 154.0.8037.57, loopback headless con sandbox: 6 unitarias (implementación y revisión), 12 grupos finales de modelo/IDB PASS, cero errores. Incluyen cuota/abort simulados, corrupción/CAS, reapertura y límites. No se presenta el evento de prueba inicialmente no abortivo como una cuota real ni como fallo del producto.

Producto, 6 casos PASS con cero errores de página/CSP: texto Unicode y markup inerte sin parar el engine; borrador/guardado LRC y seek de marcas simultáneas; errores de LRC/tamaño/UTF8 conservan audio y letras previas; cambio de pista rechaza File tardío; reimportación/ausencia/reload con cola pausada; reparación observada de registro corrupto sin parar audio y persistida. evidence-lyrics-web.json. No demuestra audio audible, iPhone ni consumo de memoria universalmente acotado.

Candidato privado de 28 archivos, /releases/85cd7b210761ec40.html: PNG/audio/lote/letras guardadas PASS en contexto propio Chromium HTTPS, engine único activo, bounded-blob y cero violaciones CSP. Offline del origen privado y físico siguen pendientes. La ampliación T16 en fuente no se atribuye a este build hasta comprobarla aparte.

## Organización portable y recuperación con pérdida de IDB

Chromium 154.0.8037.57 Linux headless/sandbox: formato 14 unitarias; reconciliación final 32 grupos (12 restored + 10 library + 10 OPFS); backup final 39 grupos. No sumar versiones anteriores como pruebas adicionales. Dos revisiones independientes detectaron 3 y 2 P2, corregidos con casos focales reales. Modelo/preview/apply conservan bytes y organización elegida, CAS/recibo y ausencia de falso complete. evidence-organization-web.json.

Producto de producción: 7 casos generales PASS, descarga real JSON y restore en contexto limpio sin bytes, reimportación exacta enlaza IDs/metadata/favoritos/listas; conflictos keep/use, preview obsoleto, cancelación contra commit, hostil como texto y reopen pausado. Otros 5 casos UI PASS con pérdida real de IDB tras commit incierto, misma encarnación sin bypass y confirmación para empezar en almacenamiento nuevo conservando desconocido histórico. JSON no lleva audios, letras, portadas, sesiones ni cola. Cero errores de página; suite general cero CSP.

Actualización desde el control viejo por launcher estable PASS sin interrupción del owner ni activación forzada. Privado HTTPS actualizado a 31 archivos, /open.html → /releases/5602b9f2c2f215cf.html; contexto limpio PASS (PNG/audio, lote, letras, roundtrip JSON), 1 motor activo/bounded-blob/0 CSP. No convierte gate físico, offline privado o cuota real en PASS. iPhone permanece APLAZADO/PENDIENTE.

## Recuperación parcial de cola e integridad

Candidato /releases/416c4e0dbc97cfca.html, Chromium154 Linux sandbox:15 unitarias finales,18 casos IDB/Blob de producto tras corrección del P2 reproducido de corrupción. Tres regresiones por cada combinación IDB/OPFS × Blob/SW PASS, sin modificar bytes dañados ni organización: omitir B corrupta, actualB ausente y todas corruptas. Contratos SW14 casos por backend se ejecutaron antes del ajuste SHA; se conservan etiquetados como esa fase, no como una repetición completa final.

Reapertura con context.setOffline: un caso focal final por backend/SW PASS, pausado sin autoplay y reproducción tras pulsar, rango0–1 206/2bytes, HEAD200/0bytes y416. No se cerró Chromium ni se apagó el servidor en estos nuevos casos; no se atribuye ese grado de corte. Una ejecución concurrente inicial IDB/SW tuvo timeout de arranque del tercer contexto, causa no confirmada; reintento aislado con diagnóstico3/3 PASS y log original conservado.

Regresión producto backup7 casos, actualización SW old→new y probe HTTPS propio PASS; privado mantiene bounded-blob y no acredita arranque offline. Solo se actualizó la copia privada existente. docs/evidence-queue-restore-web.json conserva cobertura por fase/hashes/comandos. iPhone APLAZADO/PENDIENTE, handoff y P0-W sin completar.

## Cesión explícita de control y lifecycle local

Candidato privado7b973abc7dcf3ded,31 archivos, mismo /open.html y acceso autorizado.22 unitarias finales PASS;20 grupos iniciales handoff r4, revisión r5P2 vacío corregido y10 pruebas focales posteriores PASS. Metadata opcional real se retrasa dentro de extractores, writer ya libre; recovery/retry de lote y preview/inspect/recovery backup con barreras antes/después de efectos reales. Caso vacío sin inyección permite ceder; storage/worker simulados conservan bloqueo hasta resolución. No sumar fases como aceptación completa.

Dos navegaciones reales Chromium154 sandbox PASS: salir reproduciendo vuelve pausado con documento nuevo; salir tras cesión en reposo vuelve con mismo documento/pageshow.persisted=true, sin control, y readquiere pausado. Esa es la evidencia BFCache concreta; no se extiende al caso reproduciendo. Regresiones finales18cola/5letrasautomáticas/7backup PASS. Actualización con bundle/SW anterior conserva propietario activo y activa tras cierre, PASS.

Probe HTTPS privado propio con dos pestañas PASS: solicitud no pausa, cesión descarga medio viejo, nueva propietaria restaura pausada y reproduce tras gesto; una sola pestaña reproduciendo, bounded-blob y0CSP. Misma biblioteca sintética incluye imagen/lote/letra/roundtrip backup. No se cambió puerto/acceso/cuentas. Pagehide activo/incierto conserva locks hasta cerrar esa entrada; streams autorizados pueden terminar. docs/evidence-handoff-web.json. iPhone/Telegram y offline privado siguen pendientes, T13/P0-W no completos.

## Calidad local: biblioteca paginada, foco y avisos originales

Candidato c97de0eb243dce01,33archivos, mismo acceso privado.15unitarias finales/typecheck/lint/buildPASS. R2 paginación50 conserva selección completa/índices absolutos y pasa7grupos con1000/20; revisión r3 detectó foco entrepáginas y r5 lo corrige con21casos (incluye reproducción esperada del baseline, ambos sentidos/Enter/repetidos/dangling/concurrencia/error/no-op/refresh). Métricas r2, no reejecutadas tras cambio defoco: medianas evento→mutación156.4→4.4ms búsqueda,526.5→3.1 navegación,140.8→9.3 playlist enVM/eventosinyectados. No umbral móvil ni heap/ejecuciónsostenida. Cola1000 siguevisible y su coste residual no se oculta.

Final compilado6casos layout y6 tecladoPASS, sin stylesheet inyectado; texto100/200% por font-size aproximado, no zoomreal. Actualización desdecontrolviejoPASS sinforzarSW/owner. Licencias17 paquetes:bytesoriginales/offsetSHA verificados; UTF8BOM evita codificaciónerrónea de textoestático;3unitarias y3casos entrega/offlinePASS con origenloopbackapagado y respuestaSW. NormalizarCRLF/BOM solo para texto visible, no parahashoriginal. docs/evidence-quality-web.json y evidence-license-web.json conservan fases/huellas/límites.

ProbeHTTPS privado propioPASS:2pestañashandoff/restorepausado/única reproduciendo, imagen/lote/letras/backup y hashnotices17 exacto; bounded-blob/0CSP. Copiaestática verificada porSHA. No iPhone/VoiceOver/privadooffline ni seguridadglobal. T18/P0-W incompletos; futuroSDKWASM requiere composición/fuentes/avisos antes de distribuir. Siguiente diseñoT8 es trabajo independiente, no parte de este candidato.

## Inicio, vistas locales y minirreproductor

Candidato d49e87f072e4c51b,33archivos, mismo acceso privado. Inicial r3:19unitarias/20grupos Chromium; r4 reprodujo2P2 (barras en568x320/200% y focoRAF posteriorTab), r5 corrige con30focales/10combinaciones de viewport-texto y31unitarias de sus comandos. Padre finaltypecheck/lint/build/22unitarias focales y6teclado/3licenciasoffline/old→newSW PASS. Fases y comandos separados, no sumar versiones como aceptación adicional.

R5 mide cajascompletas/hit-test de buscador/player/nav/mini/footer con títuloslargos, incluye568/600x320. Minienflujo≤480pxalto evita cubrir controles; cap/reservas en otras alturas. RAF Abrir/Volver/Crearplaylist/navscroll no pisa intención deTab/focoABA/puntero/rueda/blur/ruta/control/desmontaje. Contextos, fullqueue101/fullplaylistbatch101 y motorúnico se conservan en regresión focal. No hardwarekeyboard/realzoom/VoiceOver/safearea física.

Probe HTTPS propio PASS:Inicio recientes visible, Abrir/Volver foco, filtros conservados al navegar, mini play/pause sobre mismoAudio/fuente y audio sigue al navegar. También PNG/lote/letras/backup/notices17SHA y handoff2pestañas restaura pausado/solo una reproduce; bounded-blob/0CSP. Caso OPFS/SWoffline/rangos adicional previo al ajuste de layout/focoPASS (reopenpausado/gresto/206/HEAD/416), no se extrapola al origenprivado/iPhone. docs/evidence-functional-shell-web.json. Miniportada real y T8/P0-W total siguen pendientes.


2026-10-31 · Entrega web 5f5ba1bfe2fd5ae2: Chromium154 Linux sandbox, perfiles propios/loopback: IDB+OPFS GET/hash/rangos/HEAD/403 y reapertura offline tras cierre Chromium PASS; red del contexto desactivada, servidor assets no apagado. Actualización real desde b637 preserva audio anterior y restaura nueva pausada. HTTPS privado: importación y recorrido local+diagnóstico+handoff PASS con bounded-blob, cero CSP; privado offline no demostrado. Evidencia `docs/evidence-import-v2-web.json`. iPhone13/iOS27 autoinformados: ningún nuevo resultado físico; APLAZADO/PENDIENTE, sin convertir Chromium en aceptación iOS.


2026-10-31 · Entrega web6314ebda94d3dfd5 (B1): Chromium154 sandbox IDB/OPFS GET/hash/rangos/HEAD/403, SWdetenido+fetch y cierre/reinicio Chromium offline PASS (contexto sin red; servidor assets no apagado). Update desde5f5 conserva audio anterior y restaura nueva pausada. HTTPS privado recorrido local/diagnóstico/handoff PASS, unAudio/bounded-blob/ceroCSP; offline privado e iPhone físicos pendientes. `docs/evidence-reader-b1-web.json`; B2/B3 no incluidos ni aceptación global.


2026-10-31 · Entrega41e21b4f8c921156 B2+B3: Chromium154 sandbox producto IDB/OPFS GET/hash/rangos/HEAD/403/SWrestart+fetch/reinicioChromiumoffline PASS; assets servidor no apagado (contexto offline). Update desde6314 conserva audio/restaura pausado. HTTPSprivado local+backup/lote/diagnóstico/handoff PASS unAudio/bounded-blob/0CSP; privadooffline/iPhone pendientes. R26fuenteactual49 final +R29fixreview conservados, no se infiere aceptación física/global. FuenteDBr31 posterior no incluida.


## 2026-10-31 · IndexedDB: correcciones R34, revisión R35 y entrega web

R34 reprodujo y conservó los RED originales: una apertura paralela de arranque podía migrar v1 después de que otra recibiera blocked; el efecto opcional de apariencia no capturaba VersionError; una adquisición diferida podía remontar el panel y abrir otra solicitud o reinstalar Media Session después del gate. El padre corrigió las cohortes de apertura y añadió registerDatabaseOpenGuard con comprobaciones antes de abrir, migrar y entregar. El permiso de reintento exige scope, proof y generación de Activity vigentes; invalidar y reabrir Activity bajo el mismo proof no conserva ese permiso. acquired comprueba databaseState antes de modificar Player o Media Session. No se cambió versión2 ni se borró una base futura.

R34 final: 32/32 casos Chromium154 con IndexedDB nativo PASS y 2/2 controles de production main sin transformar fuentes PASS, cero pageerrors/solicitudes externas. Incluye ausencia de migración al soltar v1 sin reintentar, retry explícito bloqueado, carreras de adquisición y retry obsoleto, futura v3 conservada, canarios, pausa/URLs/handlers tardíos y regresiones reales de lote/backup/recovery. Cinco checks sintaxis/tipos/lint PASS. RED anteriores y correcciones del harness permanecen separados. Revisión R35 favorable acotada: seis probes propios PASS, ningún P1/P2 reproducible; fuentes y recibo final cotejados por padre. Main e50026aa8f73 y database80d6292dacf8 son las fuentes congeladas de esta entrega.

Build y comprobaciones del producto PASS: IDB/OPFS GET íntegro/hash/rangos/HEAD/403, fetch tras detener SW y reapertura después de reiniciar Chromium offline; el servidor de assets no se apagó, la red del contexto sí. Seis casos de teclado y tres de licencias PASS; estos últimos sí apagan el origen loopback y verifican shell/avisos completos desde SW. Actualización desde41e21 conserva audio anterior, mantiene nueva entrada pausada y activa SW después del cierre normal de clientes. Misma copia privada autorizada actualizada a33 archivos, /open.html → /releases/41ccf4e56306c684.html, assets anteriores conservados. Probe HTTPS propio PASS: biblioteca/importación/portada/letras/lote/backup/diagnóstico/handoff, unAudio, bounded-blob y cero CSP. Sin nuevo puerto, cuenta ni autenticación.

Evidencia: docs/evidence-idb-migrations-web.json, .local/evidence/idb-lifecycle-ui-r34.json, idb-migrations-review-r35.json y idb-migrations-delivery-parent-verification.json. Baseline src/dist previo al incremento de copias en idb-migrations-release-source-baseline.json: R37 y cualquier cambio posterior NO forman parte de41cc. Lifecycle sigue local por realm; fanout worker/SW y AC21 integral no están aceptados por estos resultados. Offline privado e iPhone siguen APLAZADOS/PENDIENTES; T16/T18/P0-W incompletos, USD0.


2026-10-31 · Entrega9a5944784009419c (copias): R40 Chromium15449 casos UI PASS sobre main/controlador final y R43 seis casos posteriores del lectorreadonly PASS, históricos separados. Producto IDB/OPFS GET/hash/rangos/HEAD/403/SWstop+fetch/reinicioChromiumoffline PASS (red del contexto desactivada, servidor assets encendido). Seis teclado/tres noticesofflineorigenapagado y update desde41cc PASS. HTTPS privado propio inventario/verificación OPFS/descarga real bytesSHA y liberaciónURL/cambio deowner PASS, audioúnico/bounded-blob/0CSP. Offline privado y iPhone permanecen pendientes; no aceptación física, realzoom/VoiceOver o P0-W por esas pruebas. docs/evidence-local-copies-web.json.


2026-10-31 · Release /releases/9cbcab4e444d7d6d.html: Chromium154 Linux sandbox, checks locales de assetsIDB/OPFS, teclado6, avisos3 y actualización normal PASS; probe HTTPS propio con fuenteBlob limitada y cesión dos pestañas PASS. PortadaAPIC propia16px automática y editores ausentes; import/batch/backup/letras locales/copia exportada exacta conservan audio único. Recibo .local/evidence/readonly-delivery-parent-verification.json. Audio offline local = contexto offline y reinicio Chromium con servidor de origen disponible; avisos offline = origen detenido. No se atribuye offline al acceso privado, ni prueba nueva Safari/Chrome/iPhone/Inicio/VoiceOver/zoomreal/avancebloqueado. Físico APLAZADO/PENDIENTE.


## R66–R69 · Álbumes automáticos, entrega web c44e797fff04a757

Local: typecheck/lint/build PASS. R66:32 unitarias,10 grupos Chromium154 IDB/OPFS; R69:4 probes Node propios/revisión favorable limitada. R68 producto11 grupos PASS en snapshot completo sin transformar, 0 errores página/CSP/externos. Importa cinco audios propios, conserva orden/ocurrencias/Audio, prueba backupv2+lectorv1 y aviso, reapertura pausada. 1000 fichas son seed sintético; texto200% es aproximación, no zoom real. RED de progress nativo10em a320px conservado; CSS máximo inline y final GREEN verificados.

Producto final: assets IDB/OPFS+ranges/HEAD/reinicioSW/reapertura Chromium offline; servidor assets no detenido. Licencias/shell offline con origen detenido se prueba aparte. Teclado6 y actualización normal9cb→c44 PASS. Misma copia HTTPS actualizada34 archivos; smoke real desktop PASS con MP3 propio tags+APIC, vista, backupv2, motor único, exportaciónOPFSexacta y cesión/nueva entrada pausada. Transporte privado bounded-blob8MiB/24MiB, offline privado NO demostrado.

Recibo correlacionado .local/evidence/album-delivery-parent-verification.json. No nuevo resultado físico de iPhone, Safari/iOS, VoiceOver, zoom ni escucha bloqueada sostenida: APLAZADOS/PENDIENTES. P0-W/T10 no completos. USD0.


## Reinspección y primer uso · 8cfb8eb02744ca5c

Chromium154/Linux/sandbox: R72 producto11 PASS, R75 foco/terminal seis vecinos PASS (uno TESTONLY diferido), R76 cancelación seis grupos/R77 cinco probes, R79 primer uso ocho grupos/R80 cuatro probes nativos. Matrices por fuente separadas, sin inferir un total único. R79 abre contextos persistentes vacíos sin preseed e importa audio propio IDB/OPFS; revisión no-change conserva Audio, source, cola, metadatos y bytes. SW ausente TESTONLY en ese runner, no prueba de SW.

Build final: tipos/lint/build, assets IDB/OPFS+ranges/HEAD/403/SWrestart/reapertura Chromium offline (servidor assets no apagado), teclado6, licencias3 con origen detenido y update c44→8cfb tras cierre normal PASS. Acceso HTTPS existente actualizado35 archivos y smoke propio PASS, revisión local explícita mientras suena/backupv2/exportación exacta/handoff nuevo pausado. Transporte privado Blob8MiB/archivo24MiB/cola, offline privado no demostrado. Recibo .local/evidence/metadata-rescan-delivery-parent-verification.json.

iPhone/Safari/Chrome/Inicio, VoiceOver, zoom real, 10 pistas/30min bloqueados y remoto: APLAZADOS/PENDIENTES, sin nuevos PASS físicos. Fuente200% de escritorio no demuestra zoom iOS. P0-W no completo. USD0.


### 2026-11-01 · Fuentes físicas y cola protegida, entrega web b88

`b88da5c9b1ea9b8c` entregado al mismo acceso privado autorizado tras R81/R82 y R83/R85 favorables limitados, R84 doce grupos y checks de producto de transporte, teclado, licencias y actualización normal8cfb→b88. Smoke HTTPS propio PASS, sin iPhone físico. Fuentes registradas por generación y pending/retained explícitos; no retirada implementada. Transporte privado Blob8/24MiB y offline privado pendiente. Evidencia y etapas separadas en `docs/evidence-source-protection-web.json`; siguiente reserva R86 aún en desarrollo, no aceptación P0/T12.
