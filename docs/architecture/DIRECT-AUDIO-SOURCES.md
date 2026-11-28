# Fuentes de audio sin bots ni YouTube

**Estado: descartado por decisión del propietario el 2026-11-10.** Se conserva como referencia histórica; no hay integración pendiente.

Investigación del 2026-11-10. Alcance autorizado: estudiar sustitutos; no conectar cuentas, instalar motores, descargar música ni cambiar proveedores de Pulso.

**Resultado: existe una implementación de acceso directo a Deezer sin YouTube, pero no se ha demostrado un reemplazo operativo completo para Pulso con USD 0, catálogo equivalente y almacenamiento exclusivamente en el teléfono.**

| Candidato | Qué se comprobó | Encaje actual |
|---|---|---|
| Telegramusic / Deezer | El módulo usa sesión de Deezer, autorización de medios, descarga y procesamiento local. Su ruta Deezer no referencia YouTube; el handler propaga el fallo después de sus intentos, sin cambiar a esa fuente. | Referencia técnica concreta; depende de cuenta, acceso no oficial y adaptación. No ejecutado ni admitido como proveedor. |
| music-bot / Soulseek | El proveedor implementado es Soulseek mediante slskd; Deezer proporciona metadatos. | Sin YouTube, pero requiere servicio persistente y archivos intermedios; disponibilidad depende de pares. No encaja directamente en una web estática. |
| SoundCloud oficial | Reproducción mediante API, credenciales de aplicación y restricciones por pista. Sus condiciones excluyen guardado permanente y escucha offline en apps API. | No sustituye la copia local persistente que necesita Pulso. |
| Audius | API de búsqueda, streaming y descarga; acceso según permisos del artista. | Candidato adicional, no sustituto de catálogo demostrado. Dos búsquedas concretas devolvieron cero filas. |
| Jamendo | API distingue reproducción y descarga permitida por el artista. Requiere identidad de aplicación. | Candidato adicional. La identidad de prueba publicada está suspendida; no se validó cobertura ni descarga. |

## Deezer: hallazgo y límites

Se inspeccionó Telegramusic en el commit `eb958bc509c054b6f6abd142f3a1f707679aa6fb`, sin ejecutar sus archivos. La calidad se selecciona según capacidades de la sesión y disponibilidad: MP3 128/320 o FLAC, con degradación posible. No garantiza 320 ni FLAC para todas las pistas. [Módulo inspeccionado](https://github.com/kernoeb/Telegramusic/blob/eb958bc509c054b6f6abd142f3a1f707679aa6fb/dl_utils/deezer_download.py), [handler de canciones](https://github.com/kernoeb/Telegramusic/blob/eb958bc509c054b6f6abd142f3a1f707679aa6fb/handlers/deezer.py).

Esto identifica cómo funciona ese proyecto; **no demuestra que DeezerMusicBot use el mismo motor**. El autor señala que su acceso contradice las condiciones de Deezer; una cuenta Premium no constituye por sí sola una autorización de distribución para Pulso. [README](https://github.com/kernoeb/Telegramusic/blob/eb958bc509c054b6f6abd142f3a1f707679aa6fb/README.md). El modo offline oficial se documenta dentro de las aplicaciones de Deezer para suscriptores, sin descarga desde su web. [Ayuda oficial](https://support.deezer.com/hc/en-gb/articles/115003884605-Listen-To-Deezer-Offline).

Inferencia de arquitectura: portar ese motor Python requiere un servicio o puente local, o desarrollar otro transporte y comprobarlo. No se puede asumir acceso anónimo por CORS desde Safari. Un servidor que procese audio consume transferencia, CPU y espacio temporal aunque después lo borre; esto difiere del relay actual de Pulso, limitado a metadatos y portadas. No se debe publicar una sesión compartida en el JavaScript de la app.

## Otros proyectos y alternativas

El proveedor de music-bot se inspeccionó en `a60b0db3ee7a8e2b4df35bc647e3ae4dace55537`: usa slskd con carpeta de descargas. [Documentación del proveedor](https://github.com/eeegoloauq/music-bot/blob/a60b0db3ee7a8e2b4df35bc647e3ae4dace55537/docs/providers/soulseek.md). [slskd](https://github.com/slskd/slskd) es un cliente-servidor de la red Soulseek, no una API de audio de Deezer.

DezAlty anuncia servicios, pero el árbol público inspeccionado sólo contiene recursos, README y licencia, no el motor de descarga. DeemixBot está archivado: referencia histórica, no alternativa actual probada. No se equiparan anuncios con implementación ni repositorio público con servicio funcional.

SoundCloud exige aplicación registrada y secretos para tokens; también distingue pistas completas, preview y bloqueadas. Su contrato actual impide ofrecer almacenamiento offline persistente y restringe servicios agregadores. [Guía](https://developers.soundcloud.com/docs/api/guide), [condiciones de caché y descarga](https://developers.soundcloud.com/docs/api/terms-of-use#caching-and-downloading). No se solicitaron credenciales.

Audius documenta descargas originales o MP3 con permisos/condiciones por pista. [API](https://api.audius.co/v1), [controles del artista](https://help.audius.co/product/editing-your-release). Consultas públicas únicas `Nsqk SAMSA` y `LATIN MAFIA Flores`, límite 10: HTTP 200, CORS `*`, cero filas en ambas. No prueban ausencia global; tampoco acceso de navegador, identidad oficial del artista o disponibilidad de MOSCA completo. No se pidió audio.

Jamendo expone `audiodownload_allowed` y formatos MP3/OGG/FLAC. [Pistas](https://developer.jamendo.com/v3.0/tracks). Sus documentos facilitan un client ID sólo para pruebas; aquí devuelve HTTP 200 pero error API 11, aplicación suspendida. Las dos búsquedas fallidas no son resultados vacíos válidos. [Autenticación](https://developer.jamendo.com/v3.0/authentication). La integración requiere una aplicación propia; el uso comercial tiene condiciones distintas. [Condiciones](https://devportal.jamendo.com/api_terms_of_use).

## Evaluación previa a la decisión del propietario

Conservar los proveedores actuales mientras no exista un recorrido directo demostrado. La ruta Deezer es la referencia más cercana por catálogo, pero no está aprobada ni probada con cuenta. Audius/Jamendo sólo se consideran complementos con permiso explícito de descarga; no sustitutos de MOSCA.

Una integración futura debe distinguir pista identificada de archivo disponible, excluir YouTube incluso como fallback, validar versión/artista/duración y origen, reutilizar copias, conservar cancelación y límites, y separar credenciales del navegador público. El importador actual admite MP3/MP4-audio/WAV y un máximo de 32 MiB por archivo: añadir FLAC requeriría un incremento específico, no cambiar una etiqueta MIME.

Evidencia privada: `.local/direct-audio-sources/source-manifest.json`, snapshots públicos por commit y probes de sólo metadatos. Ningún motor ejecutado, cuenta utilizada, audio descargado, dependencia instalada, servicio creado o producto/publicación modificado. No hay aceptación de iPhone ni sustitución de bots.


## Decisión vigente · 2026-11-10

El propietario descarta esta vía después de conocer sus requisitos. Se cierra la investigación de reemplazar los bots con las fuentes examinadas; tampoco se habilitan como complementos. Pulso mantiene sus bots actuales. YouTube continúa excluido como fuente de audio. Ningún motor llegó a integrarse, por lo que no hay código de producto que retirar. Esta decisión no elimina el catálogo de metadatos, las portadas ni las letras existentes.
