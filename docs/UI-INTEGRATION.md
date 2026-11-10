# Interfaz de Pulso integrada con el producto

La dirección Bruma de `design/design.md` se aplica a los datos y controladores reales. Los prototipos de `design/app` siguen siendo muestras independientes: su catálogo ficticio, audio y organización en RAM no forman parte del producto.

## Pantallas

- Inicio: accesos a Favoritos, Biblioteca, Buscar y playlists reales; continuar y añadidas recientemente. Las tarjetas recientes anuncian preparación en pausa, conservando el contrato del motor.
- Buscar: una barra, sugerencias y resultados de canciones, álbumes y artistas; presentación en flujo en teléfono. Enter consulta metadatos. Elegir álbum o artista navega; elegir canción conserva el flujo de copia verificada y reproducción existente. Estado y acciones de la canción preceden a los resultados.
- Biblioteca: cuadrícula de playlists, álbumes y artistas; Favoritos es una colección automática basada en la marca real. Detalles y opciones reutilizan filtros, paginación, edición, orden, retirada y confirmaciones existentes.
- Reproductor: mini persistente con título e intérprete; barra de escritorio con transporte, posición y volumen. Abrirlo mantiene el mismo Audio. Letra y Cola tienen vistas propias con retorno al reproductor. La letra guardada muestra texto plano o cues reales y permite seek sin iniciar Play por sí solo. El diálogo conserva foco, Escape y retorno al control de apertura.
- Configuración: Telegram, proveedores, almacenamiento, limpieza de caché, organización, apariencia y diagnóstico. Los controladores permanecen montados. Avisos de recuperación o falta de control continúan disponibles fuera de ajustes.

Escuchar, añadir a Biblioteca, marcar favorito, pertenecer a una playlist y tener una copia local conservan sus significados distintos. La nueva presentación no modifica los esquemas ni el transporte de Telegram, la verificación de bytes, la sesión guardada o el coordinador de retirada. Los marcadores gráficos sin portada no representan arte real del catálogo.

## Validación

La evidencia del incremento se conserva en `.local/interface-parent` y `.local/interface-browser-validation`. Las pruebas usan datos y audios propios. Los resultados de los prototipos, del main integrado, del build y de la actualización se registran por separado. Los recibos anteriores con fallos se conservan y no se cuentan como aprobados.

Safari/iPhone físico, teclado y áreas seguras reales, VoiceOver y escucha con pantalla bloqueada siguen pendientes. Este incremento no cierra P0-W ni demuestra nuevas descargas con una cuenta real.

## Correcciones tras la prueba del propietario · 2026-11-09

Buscar conserva una sola lista de resultados actualizada al escribir; no hay desplegable ni lista rápida duplicada. El minirreproductor permanece montado sin selección, durante preparación y al navegar. El player usa la composición de `design/app/NowPlaying.tsx`, con portada, transporte, reloj, modos, favorito, vista previa de la letra y vistas propias de Letra y Cola. Las letras son las guardadas en el archivo o manualmente; no se inventa texto ni se activa un proveedor remoto por abrirlas. El editor anterior queda como opción secundaria.

La apertura ya no desplaza automáticamente hasta el título: se confirmó que ese scroll ocultaba casi toda la portada. La versión corregida abre arriba y muestra portada, título, cierre y transporte completos a390×664. El rechazo simulado de autoplay conserva aviso y Play visible, y un gesto nuevo inicia audio. El problema informado con la cuenta real no se reprodujo en las pruebas locales ni en el bot simulado; no se declara una causa real resuelta. Evidencia separada en `evidence-ui-corrections-web.json`.


## Entrega visual 2026-11-10

La capa `design-fidelity.css` ya forma parte de la entrega privada `a6298e0bb1031db6`. Conserva la reparación funcional anterior y sus límites. La evidencia local y de producción está en [evidence-design-fidelity-web.json](evidence-design-fidelity-web.json); las diferencias estructurales pendientes continúan en `design/FIDELITY-REVIEW.md`.


## Reproductor: organización, portada y letra

El botón + abre acciones reales de Biblioteca y playlist; Favoritos permanece separado. La incorporación se confirma después del almacenamiento y refresh, bajo la captura de la entrada, generación y ámbito actuales. La organización no vuelve a descargar el audio y no cambia la fuente reproducida.

El reproductor consulta letras de LRCLIB y una carátula del catálogo iTunes cuando faltan datos locales. La imagen se valida, decodifica y muestra como blob; no se cargan scripts o imágenes remotas directamente. Se exige coincidencia de título, artista, duración y álbum conocido; ediciones ambiguas se descartan. Las carátulas elegidas o escondidas manualmente y las letras locales o ausencia manual tienen prioridad. Los resultados externos son temporales en RAM; no reescriben la ficha musical ni inventan tiempos de letra. Solo la pista activa con reproductor abierto inicia la consulta; ticks, seek y reapertura con caché no consultan de nuevo.

Las lecturas locales liberan Activity antes de la red para que una consulta de letras o portada no bloquee Añadir. Los resultados tardíos se cercan por pista y ámbito. La política del documento admite cinco hosts concretos is1-ssl a is5-ssl.mzstatic.com; las políticas del worker Telegram y Service Worker conservan sus destinos anteriores.


## 2026-11-10 · Portadas de catálogo y apertura de álbum

Por nuevo reporte de MOSCA vacío/portadas ausentes se conectan imágenes de resultados, hero de álbum y publicaciones de artista (antes sólo player). Un lote de canciones por consulta, matching estricto/cachéRAM/hosts finitos/blobvalidado, local y ausencia manual prioritaria. Error de catálogo específico y reintento explícito conservando edición; causa exacta de captura no reproducida. Se preserva y combina UI mixta del propietario, sin dropdown, con Borrar/Cancelar/foco.

642unidades/lint,7casos fullmain Chromium final187hashes,UI12focales+22main Chromium/WebKit186hashes,producción yupdate PASS separados. Público previoMOSCA17 yportadacanción/hero decodificadas; sóloCSS difiere del final. UI conserva34avisosCSPWebKit históricos, noCSP0general. Entrega87ed63ead44eff76/38archivos/311inmutablesprevios exactos yHTTPSPASS. Sin Telegram/audio real/iPhone/persistenciaoffline remota/P0completo. Informe detallado en apéndice homónimo P0-W y .local/album-cover-repair/parent/REPORT.md; evidencia pública docs/evidence-album-covers-web.json.


## 2026-11-10 · Plus del reproductor: Favoritos directo

El propietario precisa que + debe añadir directamente a Favoritos y pasar a gancho mediante animación al completarse, sin pantalla intermedia ni pregunta. Esta instrucción sustituye la interpretación del incremento anterior que abría Organizar canción. Biblioteca/playlist siguen siendo acciones distintas en sus recorridos existentes; escuchar o pulsar Favoritos no promueve automáticamente el marcador de Biblioteca ni crea una segunda copia.

La confirmación visual se basa en el favorito durable de la pista actual, no en inLibrary ni en el inicio de la escritura. Se cercan gestos/callbacks obsoletos y pulsaciones concurrentes; el estado pendiente y un fallo no simulan éxito. La animación es breve y respeta movimiento reducido; la pista, el elemento de audio y la posición se conservan.

Guardia playerLifetime incluye entrada, generación, época de cola, navegación, propietario/ámbito y las guardas existentes de mutación. Main usa editTrack/CAS/revisión bajo WRITER_LOCK, refresca y confirma; el botón no depende de document.activeElement (toque Safari puede no enfocarlo). El vuelo global deshabilita también el botón de otra pista hasta liquidación. La vista Organizar se retira del player. Transición CSS200ms opacity/transform con curva ease-out custom/escala.9, sin deps nuevas, sin replay al montar favorito y movimiento reducido instantáneo.

642/642unidades/lint/diffcheck PASS. Fixture componente: pendiente conserva plus, error sin éxito, teclado/currentobsoleto/320px/texto200/reducedmotion y transición pointer activa200ms→checkopacidad1/plus0, sin replay alreabrir. Fullmain congelado con WAV/IDB nativos sintéticos: gesto favorito persiste, misma instancia/fuente/tiempo de audio y vista player, readbacktrue tras recargar. El fallo de escritura es controlado en fixture componente, no inyección nativa de fallo IDB; doble pulsación tiene guardia de vuelo pero no una prueba native dedicada declarada. Hubo un acceso nulo al iniciar corregido antes de entrega; el intento de arnés por UIimportación obsoleta se sustituyó por seedfixture existente, sin restaurar importación visible. No cuenta ni mensajes/descargas reales.

Build en snapshot187fuentes runtime exactas; auditoría3747miembros de fuentes/avisos/licencias/ausenciaidentidadprivada PASS. Producción Chromium154/WebKit27.2 navegación con metadatos sintéticos PASS,0JS/externos; update87ed→3a856 conserva audio anterior/nueva pausada/SWespera cierre/restorepausado,0externos PASS. Entrega3a856decc1a904d1/38archivos/314inmutablesanteriores exactos; HTTPSlauncher/latest/entrada/main/worker/SW/configprivadano-store exactos PASS. Rootdist/sesiones/almacenamiento musical real conservados; sin commit/push,costos/cuentas/servicios nuevos. iPhone físico/P0general siguen pendientes. Evidencia .local/player-direct-favorite/parent y tests/integration/check-favorite-player-main.mjs; no se activa registro/cloud. Engram15sync/readonly independientes al cierre.


## 2026-11-10 · Combinación final con detalle de playlists

Actualización posterior al cierre funcional2dd: llega ownedREADY del propietario UI con189fuentes exactas del árbol (src/public/index), preservando la guarda root de playCollection. Se combina con transporte/selección temprana del álbum en snapshot190+Handler y se entrega0a92a9641e836c05. La nota de playlist pendiente del cierre anterior queda superada por esta entrega; no se descarta ni reemplaza main desde un snapshot antiguo.

CollectionHeader/CollectionCover/collection-detail.css: portada/mosaico local de hasta4 IDs distintos o corazón de Favoritos, título/conteo/duración reales sin inventar duración desconocida, controles claros, filas compactas de título/artista y menú ⋯. Filtros, renombrar, edición, destino de playlist y metadatos técnicos pasan a opciones secundarias; handlers/CAS/guards de organización y limpieza se conservan. Header Play prepara/verifica cola completa actual con IDs/epoch/scope/navigation/view guard antes de usar el mismo Audio; root añadió captura de selectedSongIntent al inicio para que una interacción posterior invalide el arranque. Shuffle sólo sobre cola coincidente. No schema/SDK/proveedor/descargas nuevos, ni otra instancia Audio ni portada remota buscada por cada playlist.

UI independiente34/34grupos Chromium154/WebKit27.2 (22generales+12playlist),189hashes antes/después exactos a190freeze,0JS/externos observados,cleanuptrue. Focal de cuatro portadas usa PNG/WAV propios; WebKit efímero rechazó Blob en IDB en el fixture (negativo conservado), se contrastó perfil persistente positivo y los12casos usan nuevo perfil SINTÉTICO persistente, sin cuenta. No se acepta SafariPrivado ni iPhone por ese resultado. El recibo conserva106eventosCSPWebKit (92style-src-attr/14style-src-elem), noCSP0general. No sumar34+4 como casos únicos.

Final del álbum4/4 repetido sobre snapshot combinado190(189+Handler), exacto porarchivo y sin drift,0JS/CSP/inesperados en ese fixture.646unitarias previas/lintfinal PASS. Build/auditoría3753miembros/190runtime/avisos/licencias/ausenciaprivados PASS. Smoke producción Chromium/WebKit y update2dd→0a92 PASS; audio anterior sigue/nueva pausada/SWesperacierre/restorepausado,0externos. Entrega38archivos y321inmutablesanteriores byteexactos; HTTPSlauncher/latest/entrada/main/worker/SW/configprivadano-store exactosPASS. Dist raíz ahora se sustituye intencionalmente por la copia aceptada combinada, bytes exactos, y190fuentes runtime del árbol coinciden con el build.

Recibos .local/design-playlist-detail/report.json y revision-2, .local/album-mobile-repair/parent/revision-2 y .local/album-early-check/2026-11-10T07-08-02-203Z/report.json; docs/evidence-playlist-detail-web.json. No cuentas, música real, sesiones modificadas, costes, servicios ajenos, commit/push ni aceptaciónP0/iPhone. La causa del rechazo de red de IMG_6737 sigue no establecida para el dispositivo; nueva etapa/HTTP/versión permite diagnosticar si reaparece. Engram15sync yreadonly se verifican en invocaciones separadas.
