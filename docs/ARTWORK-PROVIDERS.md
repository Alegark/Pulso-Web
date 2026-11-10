# Portadas automáticas: proveedores evaluados

Investigación solicitada por el propietario el 2026-10-31. No activa un proveedor ni envía información de su biblioteca. USD 0; sin cuentas, claves ni servicios nuevos. Originales y organización se conservan.

La opción preferida para probar es **MusicBrainz + Cover Art Archive (CAA)**. LRCLIB sigue siendo el candidato para letras y contraste básico de título, artista, álbum y duración; su respuesta documentada no incluye portada. No hay todavía integración de ninguno de estos servicios en Pulso.

| Fuente | Aporta | Evaluación para Pulso |
|---|---|---|
| Portada incrustada en el audio | Imagen del propio archivo | Ya implementada localmente. No requiere consulta externa; no prueba que la edición musical esté correctamente identificada. |
| MusicBrainz + Cover Art Archive | Identidad de lanzamiento y portada asociada por MBID | Primera opción de proveedor externo para el uso personal previsto. Primero resolver el álbum/edición y después pedir su portada. |
| LRCLIB | Letras, título, artista, álbum, duración y estado instrumental | Reutilizar su respuesta para contraste; no presentarlo como proveedor de imágenes ni como reconocimiento del audio. |
| iTunes Search API | Información musical e imágenes de álbum | Alternativa técnicamente consultable, pero las condiciones vinculan los recursos a promoción del contenido de la tienda. No seleccionada como fuente general del reproductor. |

## Hechos verificados en documentación primaria

[MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API): uso no comercial gratuito, sin API key; requiere identificación apropiada de la aplicación y como máximo una solicitud por segundo por cliente. Que el API sea público no demuestra aún que la identificación y el transporte funcionen desde nuestro navegador sin backend.

[Cover Art Archive](https://musicbrainz.org/doc/Cover_Art_Archive): colaboración entre MusicBrainz e Internet Archive, colección públicamente accesible e indexada por identificador de lanzamiento MusicBrainz. La [API de CAA](https://musicbrainz.org/doc/Cover_Art_Archive/API) ofrece portada frontal de lanzamiento o grupo de lanzamientos y miniaturas de 250, 500 y 1200 píxeles. Documenta redirecciones y ausencia de imagen mediante 404; no ofrece una búsqueda musical por título propia. Las imágenes conservan los derechos de sus titulares: acceso gratuito no equivale a una licencia general de redistribución. Véase la política del proyecto, no una licencia de datos musicales aplicada a las imágenes.

[LRCLIB](https://lrclib.net/docs): los registros devuelven `trackName`, `artistName`, `albumName`, `duration`, `instrumental` y letras. La consulta de coincidencia recibe título/artista y recomienda álbum/duración; no identifica por sí sola un archivo desconocido ni incluye un campo de portada. Una coincidencia por esos datos es evidencia para contrastar, no autenticidad certificada ni un MBID de MusicBrainz.

[iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/): documentación oficial de archivo; imágenes y otros recursos se ofrecen bajo condiciones promocionales, con proximidad a enlaces/insignias de la tienda. No se asume permiso para usarlos como catálogo libre de imágenes de una biblioteca ajena a la tienda. No se creó cuenta ni se incorporó esta fuente.

## Incremento propuesto, todavía sin ejecutar

1. Mostrar la imagen válida incrustada si existe. Conservar por separado la información histórica y su procedencia.
2. Con el proveedor activado por el usuario, contrastar título, artista, álbum, duración y versión. Reutilizar datos de LRCLIB si ya se consultó, evitando una segunda búsqueda innecesaria de letras.
3. Resolver en MusicBrainz un lanzamiento compatible. Una canción en un recopilatorio o con versión en vivo no autoriza elegir el primer álbum parecido. Si hay varias ediciones posibles sin evidencia suficiente, mantener estado ambiguo.
4. Pedir a CAA la portada del lanzamiento identificado, inicialmente miniatura de 500 píxeles. No cambiar silenciosamente una imagen de edición exacta por la de un grupo de lanzamientos; si se permite ese fallback, mostrar su procedencia y menor precisión.
5. Validar esquema, URL/dominios de redirección, bytes, firma, dimensiones y hash con cotas antes de conservar la imagen. Los límites locales de portada actuales siguen aplicando. Fallo, ausencia o cancelación de portada no afectan audio ni cola.

Antes de integrar quedan pruebas reales de CORS, redirecciones HTTPS, identificación del cliente, límites/reintento, cancelación, respuesta tardía, almacenamiento y desactivación. Investigar documentos no es PASS de navegador, offline ni iPhone. No se enviarán audios ni chats: una consulta externa de metadatos o imagen revelaría términos consultados/IP al servicio correspondiente y requiere la autorización aplicable.


## Piloto público de navegador R56 · 2026-10-31

Resultado parcial reproducible en `.local/evidence/artwork-provider-browser-r56.json` y `.local/artwork-provider-browser-r56/REPORT.txt`. Chromium154 sandbox, contexto limpio y loopback aislado; sin producto/4175 ni biblioteca privada. CAA: cuatro solicitudes totales, incluidos dos intentos iniciales bloqueados por la CSP del harness. Añadido sólo el host oficial observado, listado JSON y miniatura de ejemplo fueron legibles por fetch/CORS. Cadena HTTPS307→302→200 por coverartarchive.org, archive.org y dn711103.ca.archive.org; JPEG10703bytes,247×250, hash y decode en memoria. No imagen comercial guardada ni redistribuida como fixture. Estos dos PASS finales no borran los intentos fallidos ni acreditan cualquier host/edición/CSP de producto. El nombre de servidor de Archive puede variar; la allowlist concreta de esta prueba no garantiza cobertura general.

MusicBrainz: cero solicitudes de API. El probe local de cabecera confirma que este Chromium mantiene su User-Agent normal aunque fetch intente sustituirlo. La documentación consultada pide identificación de aplicación y no demuestra alternativa para GET desde navegador. Las búsquedas documentales posteriores del padre tampoco resolvieron esa diferencia; no se usa client= de POST ni se transfiere un header alternativo de LRCLIB a MusicBrainz. Compatibilidad/identificación MusicBrainz continúa pendiente, sin crear proxy/backend ni pedir cuentas. No se afirma que la API haya rechazado al navegador: no fue llamada.

No se probaron CORS en errores404/429/503, cancelación funcional, almacenamiento offline, Safari o iPhone. Ningún proveedor activado en Pulso. El trabajo independiente continúa con adaptador LRCLIB deshabilitado y contraste puro sobre respuestas sintéticas, preservando D08 y el acceso local.


## Fallback del reproductor · 2026-11-10

Cuando falta la carátula local y no está escondida manualmente, el reproductor puede consultar el catálogo iTunes con metadatos de la pista y mostrar una imagen coincidente validada. Se conserva solo temporalmente en RAM. La prueba pública de Sur (Interludio), Nsqk, identificó ROY y decodificó la imagen bajo la política de producto. [Resultado y límites](evidence-player-content-web.json).


## 2026-11-10 · Portadas de catálogo y apertura de álbum

Por nuevo reporte de MOSCA vacío/portadas ausentes se conectan imágenes de resultados, hero de álbum y publicaciones de artista (antes sólo player). Un lote de canciones por consulta, matching estricto/cachéRAM/hosts finitos/blobvalidado, local y ausencia manual prioritaria. Error de catálogo específico y reintento explícito conservando edición; causa exacta de captura no reproducida. Se preserva y combina UI mixta del propietario, sin dropdown, con Borrar/Cancelar/foco.

642unidades/lint,7casos fullmain Chromium final187hashes,UI12focales+22main Chromium/WebKit186hashes,producción yupdate PASS separados. Público previoMOSCA17 yportadacanción/hero decodificadas; sóloCSS difiere del final. UI conserva34avisosCSPWebKit históricos, noCSP0general. Entrega87ed63ead44eff76/38archivos/311inmutablesprevios exactos yHTTPSPASS. Sin Telegram/audio real/iPhone/persistenciaoffline remota/P0completo. Informe detallado en apéndice homónimo P0-W y .local/album-cover-repair/parent/REPORT.md; evidencia pública docs/evidence-album-covers-web.json.


## 2026-11-10 · Consulta combinada y acceso de catálogo del prototipo

El propietario reporta resultados ajenos al combinar artista y álbum y el diagnóstico album-search/network/0a92. Se elimina la reformulación por media consulta: todas las palabras deben corresponder al título, intérprete o álbum del candidato, sin depender del orden ni de acentos. Se aplica también a filas remotas y ediciones/artistas. El lote de canciones iTunes ya existente aporta pistas canónicas y pistas de edición, sin otro GET de canciones; prioridad local, iTunes y LRCLIB para equivalentes, conservando versiones/créditos distintos y claves compatibles con la página de álbum.

El teléfono continúa reportando fallo directo al proveedor; no se establece su causa física. Se incorpora transporte opcional de metadatos y portadas por el mismo origen del prototipo. La capacidad /catalog-config.json se consulta de forma diferida, compartida y acotada a 3 segundos; hosts estáticos sin esa capacidad mantienen acceso directo. En modo relay no se reintenta contra el proveedor si falla. Diagnóstico distingue modo relay/direct. El servicio propio existente se recrea en el mismo puerto con --catalog-relay; sin nuevo servicio, cuenta, pago ni permisos. Sólo GET públicos iTunes US y cinco hosts de imagen Apple admitidos, parámetros cerrados, sin redirecciones, cookies/Authorization salientes, JSONP ni audio. Límites 1 MiB JSON/2 MiB imagen, RAM 32 respuestas+16 imágenes/5 minutos, singleflight, 8 slots y separación global 3.1 s entre consultas de metadata, con cooldown compartido 429/503. La cuota agregada del prototipo puede limitar usuarios concurrentes; no es una arquitectura de producción Cloudflare/Neon activada. Música, sesión Telegram y datos privados permanecen en el dispositivo.

656/656 unidades, lint y 10/10 pruebas Python PASS. Main literal Chromium con proveedor directo bloqueado y relay sintético:9/9 PASS, incluyendo LRCLIB vacío→pistas iTunes canónicas, apertura17/portada, relevancia combinada, límites/errores y descarte tardío. Smoke producción Chromium154/WebKit27.2 y update0a92→bdca PASS con proveedores sintéticos; servidor del smoke no acredita CSP real. Prueba pública separada del relay real por HTTPS devuelve MOSCA6813620396 con17pistas y portadaJPEG; sin guardar respuesta, imagen ni hash musical. Search combinado público devuelve14pistas pertinentes y la edición: no se promete que search sea completo, detalle17 verificado aparte. Primera aserción que exigía17 en search conserva su negativo.

Build aislado bdcadf2404a521c4, auditoría3762miembros/193runtime, licencias y ausencia de privados PASS. Entrega38archivos y324inmutablesanteriores byteexactos. HTTPSlauncher/latest/entrada/main/worker/SW/configprivada y capacidad/metadata/imagen relay PASS. Dist raíz sustituido intencionalmente por el candidato aceptado, runtime actual193 exacto. No cambios en cuentas/sesiones, SDK ni almacenamiento musical por este incremento. Sin commit/push. La evidencia no acredita iPhone físico, nueva descarga Telegram, catálogo entero, offline externo ni P0 global. Artefactos .local/search-catalog-repair; público docs/evidence-search-catalog-relay-web.json. Engram15 sync y lectura independiente al cierre.


## 2026-11-10 · Portada del reproductor por identidad y tamaño de catálogo

El propietario muestra SAMSA/Nsqk/mosca sin portada y denuncia miniaturas borrosas. Prueba pública acotada: search SAMSA Nsqk devuelve200/0filas; lookup de la edición MOSCA sí contiene SAMSA y su portada. No se atribuye el placeholder físico a una única causa no observada en el teléfono. El player ahora recupera la identidad iTunes desde alias ligados a trackId y fingerprint/bytes exactos, sin overrides manuales ni ediciones ambiguas. Consulta lookup de la edición y coteja trackId/título/crédito completo/álbum/duración; el nombre simplificado de presentación no sustituye la identidad. Sin alias seguro conserva búsqueda estricta anterior, sin inventar coincidencias.

Las imágenes del catálogo y player usan la variante CDN600x600bb únicamente para sufijos de tamaño reconocidos en hosts Apple ya admitidos. Conservan límite2MiB, validación/decodificación, cachéRAM y revocación de URLs. No se escala el Blob100px en CSS ni se modifica el archivo musical. Portadas locales listas y cualquier decisión manual prevalecen; embedded omitted/not-inspected/invalid no-manual permiten alternativa remota, unavailable no la permite. Se relee estado local antes de publicar, evitando sobrescribir cambios manuales tardíos. Lectura de identidad bajo Activity; red fuera de admisión de mutación.

659/659unitarias y lint PASS. Chromium main literal final6/6PASS sobre snapshot: alias fullcredit con display distinto y embedded omitted→lookup exacto/imagen600 decodificada; play/pausa/favorito con transacción retenida no pierden URL; hidden manual/local ready; respuesta tardía tras cambiar a alias ambiguo descartada y huella de alias alterada sin portada; resultado y hero de álbum600 decodificados. Primeros intentos fallaron por fixture de SWbloqueado sin remover Navigator.serviceWorker y por selector de cierre del arnés; preservados sin declararlos defectos de producto. No se cambió main ni lifecycle por hipótesis no reproducidas. Imagen pública SAMSA600 con JPEGheader600x600/HTTP200/límitebytes verificados separadamente; ese probe no realizó decode completo ni guardó imagen. No Telegram ni audio real.

Build aislado03f80776e1154d43 y auditoría3763miembros/193runtime PASS. ProducciónChromium154/WebKit27.2 con catálogo/audio propios sintéticos y updatebdca→03f8 PASS; audioantiguo continúa, nueva pausada, SWesperacierre/restorepausado. Entrega38archivos y326inmutablesanteriores byteexactos, HTTPSlauncher/latest/entrada/main/worker/SW/configprivada y relay metadata/imagen PASS al cierre. Rootdist se sustituye intencionalmente por candidato aceptado; sin reiniciar servidor, nuevos servicios/cuentas, commit/push ni cambios de sesión. Evidencia .local/player-artwork-repair y docs/evidence-player-artwork-repair-web.json. iPhone físico y aceptaciónP0 global pendientes; Engram15 sync y readonly independiente al cierre.
