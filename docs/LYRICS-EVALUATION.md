# Letras automáticas: evaluación técnica

Evaluación solicitada por el propietario; no activa proveedores ni implica consentimiento para enviar los metadatos de su biblioteca. SPEC D08 permanece reservado. No se cambió el SPEC ni se abrió conexión Telegram real.

Las letras pueden llegar dentro del audio o consultarse por separado. La ficha Telegram documentAttributeAudio incluye duración, título/intérprete y waveform, pero no un campo de letras: https://core.telegram.org/constructor/documentAttributeAudio . Un MP3 recibido por Telegram puede contener etiquetas de letra; un canal/bot también podría entregar un LRC o texto por separado. No se inspeccionaron mensajes, archivos privados ni el proveedor de la app de referencia, que aún debe identificarse.

La especificación ID3 define USLT para texto sin sincronizar y SYLT para texto con tiempos: https://id3.org/id3v2.3.0#Unsychronised_lyrics.2Ftext_transcription . En el parser instalado music-metadata 12.3.2 se comprobaron sus mapeos a common.lyrics; también existe ©lyr en el mapper MP4. Una prueba real local con MP3 propio, audioMetadataView del producto y parseBlob recuperó texto Unicode USLT y dos marcas SYLT en milisegundos con duración válida: 2/2 PASS. Resultado .local/evidence/embedded-lyrics-evaluation.json. Nivel Node/local, sin red, sin guardado automático del producto y sin evidencia móvil. M4A/WAV incrustados de letra todavía no se probaron. SYLT expresado en frames MPEG requiere conversión demostrada; no asumir milisegundos.

## Proveedor externo candidato

LRCLIB documenta servicio gratuito, lectura anónima sin API key y CORS para navegador; consulta por título/artista, con álbum/duración para afinar la coincidencia, y devuelve texto o LRC. Fuente oficial: https://lrclib.net/docs . Se recuperó directamente su docs.md público porque la herramienta web rechazó su MIME; copia de investigación en .local/lrclib-api-docs-20261031.md. La documentación actual sí aplica límites de frecuencia, con identificación del cliente y Retry-After. Registro opcional ofrece otras cuotas; no se creó cuenta ni clave ni se activa pago.

La recomendación es evaluar LRCLIB como complemento opt-in, con caché local, cancelación y coincidencia estricta de versión/duración. Una respuesta inexistente o ambigua debe decirlo, sin escoger la primera letra parecida. No se garantiza catálogo completo ni continuidad del servicio. Esta evaluación de acceso técnico no atribuye una licencia general de las letras a la licencia del código del servidor. No se consultaron canciones privadas ni se descargaron letras comerciales para fixtures.

Una consulta desde el navegador comunicaría título, artista, álbum/duración si se incluyen, además de IP y encabezados propios de HTTP. No requiere enviar audio, cuenta Telegram, chats, playlists ni historial. Antes de activarlo, preparar el incremento revisable con dominio/CSP limitado, qué datos salen y desactivación real conforme D08; la petición actual de evaluación no activa consultas sobre la biblioteca. Los documentos públicos no sustituyen una prueba de integración real.

## Integración propuesta

1. Conservar la elección manual, incluida Sin letras.
2. Leer primero letras incrustadas del audio propio, con presupuesto antes de decodificar, procedencia y formatos realmente probados.
3. Si faltan y el proveedor está activado, buscar en LRCLIB y validar la coincidencia. No bloquear copia/reproducción si falla.
4. Guardar texto/LRC verificados en almacenamiento local separado del audio, sin modificar el original. Reabrir/offline requiere pruebas propias.
5. No inferir sincronización a partir de texto sin marcas. No reemplazar una edición manual por una respuesta tardía; operación/pista/revisión y consentimiento vigentes antes de publicar.

Estado actual de Pulso: panel/manual texto y LRC ya implementados/probados en web; extracción automática de letra y proveedor externo pendientes. El módulo existente de letras solo guarda elecciones manuales; requiere una ampliación explícita de procedencia/CAS para automatizar sin pisarlas. No basta con activar una URL ni asumir que Telegram sirve un catálogo de letras.

## Proveedores de las referencias, verificados posteriormente

Spotify confirma oficialmente que Musixmatch suministra sus letras licenciadas y sincronizadas: https://support.spotify.com/us/artists/article/managing-your-lyrics-on-spotify/ . No se deduce de ello una API gratuita reutilizable para Pulso; los sitios oficiales de desarrolladores/planes no pudieron abrirse en esta consulta y no se afirma un precio ni se usan tokens de Spotify/Musixmatch.

La referencia Telegram citada en el SPEC es Telisten. Su política del desarrollador para iPhone/iPad/Mac confirma LRCLIB por defecto o servidor HTTPS elegido: https://docs.kitta.co/telisten/ . Se comprobó directamente el código público iOS en commit 09148eb89434867e54cf16159ac0a21e38da8f78, Telisten/Lyrics/LyricsService.swift: defaultAddress apunta a https://lrclib.net, hay proveedor LRCLIB con consultas get/search y lector de letras incrustadas; selección y caché locales. Fuente fijada: https://github.com/iebb/Telisten/blob/09148eb89434867e54cf16159ac0a21e38da8f78/Telisten/Lyrics/LyricsService.swift#L131 . La hoja pública AppPrivacyWorksheet.md coincide: título, artista y duración, sin audio/credenciales/chat, y caché local. Los recibos de los 3 archivos públicos leídos y SHA-256 están en .local/research-telisten/receipts.json. No se descargaron fixtures de música/letras de ese repositorio ni se copió implementación.

Por tanto, para esa referencia la letra consultada no procede del catálogo de Telegram: se busca en LRCLIB y se conserva en el dispositivo; también admite incrustadas/LRC. Es inspección de código y política, no observación de la sesión o versión instalada del propietario. La recomendación de proveedor gratuito sigue LRCLIB, ahora verificada también contra Telisten. D08 sigue pendiente de aceptación de fuente/datos/condiciones y prueba de desactivación.

## Incremento local implementado y comprobado posteriormente

La evaluación anterior se conserva como historia. Pulso ahora extrae automáticamente letras presentes en MP3 USLT/SYLT milisegundos, WAV ID3 y M4A ©lyr, con procedencia visible. Texto literal SYLT se conserva estructurado: los corchetes no crean marcas nuevas. Editar SYLT produce un borrador plain con aviso explícito de retirada de sincronización al guardar. Manual y ausencia manual prevalecen frente a reimportación; las letras opcionales fallidas no invalidan el audio confirmado.

Pruebas reales: 14 unitarias, 33 grupos del modelo en Chromium y 5 casos completos de importación/panel, más 6 regresiones de interfaz manual. El producto no realizó solicitudes externas en los casos automáticos. Evidencia reproducible: docs/evidence-embedded-lyrics-web.json. Misma copia privada autorizada actualizada; probe HTTPS y compatibilidad con SW anterior PASS para sus casos separados. No se atribuye al probe manual la cobertura positiva de extracción del runner local.

128 KiB limitan el payload compartido del extractor de letras; los metadatos generales del audio tienen presupuesto separado de 2 MiB. SYLT en frames MPEG no se convierte ni se anuncia soportado. LRCLIB y cualquier proveedor siguen desactivados, D08 pendiente; no se garantiza letra para un archivo que no la contiene. iPhone y offline del origen privado continúan pendientes.
