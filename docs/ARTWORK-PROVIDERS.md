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
