# Elegir una canción y escucharla

Enter y Buscar abren el catálogo de Pulso y no envían mensajes. Elegir una canción comprueba primero su copia local. Si está íntegra, Pulso la reproduce sin consultar Telegram, aunque no haya sesión. La elección de una canción que falta autoriza la consulta al primer bot compatible configurado, la obtención de su audio, una copia local verificada y la reproducción bajo esa intención todavía vigente.

Una operación por canción comparte el trabajo de selecciones repetidas mientras está pendiente. No se duplica la consulta ni la descarga. Una respuesta musical reciente, vigente y del mismo ámbito puede reutilizarse. No se reenvía automáticamente una consulta fallida o incierta ni se cambia de bot por silencio.

## Opciones y asociación musical

Los campos opcionales de remitente ausente sólo se infieren para mensajes entrantes en el peer privado exacto; un remitente explícito ajeno o un mensaje saliente nunca usan ese fallback. El adaptador espera un menú o audio; un mensaje de progreso no termina la consulta y el siguiente historial puede contener una edición del mismo mensaje. Se elige automáticamente sólo un candidato único de la ventana vigente del bot con título/intérprete exactos tras normalizar presentación. No hace falta que Telegram lo marque como respuesta explícita: esa marca es opcional y no se inventa cuando falta. Live/remix y las demás palabras de versión se conservan. El lector inspecciona hasta 64 filas de teclado y 128 candidatos, manteniendo los presupuestos previos de bytes/nodos. Proyecta como máximo 20 filas, prioriza coincidencias musicales antes del recorte y no trata navegación de sólo símbolos como canción. El exceso de opciones ordinarias no descarta toda la respuesta. Un audio también contrasta la duración conocida con una tolerancia de tres segundos. Etiquetas con símbolos de navegación y datos insuficientes no se resuelven automáticamente.

Si hay ambigüedad o metadatos insuficientes, se presentan las versiones para una elección. La proximidad temporal sola no autoriza nada: se exigen peer privado del bot comprobado, mensajes posteriores a la consulta/callback actual, sin otra consulta saliente concurrente, una única coincidencia musical, relectura fresca y las guardas de cuenta/revisión/expiración. Un reply explícito hacia otro chat o mensaje se rechaza. Una opción exacta se relee antes de pulsar sus datos privados de callback. El audio se relee antes y después de transferirlo. No se interpretan gramáticas de callback, ni se abren URL, pagos, uniones o acciones no musicales. Compatibilidad de metadatos no demuestra identidad acústica. La captura aportada por el propietario muestra la experiencia deseada, no los campos del protocolo real del bot.

## Una copia y referencias durables

La descarga tiene un máximo de 8 MiB, partes secuenciales de 64 KiB y plazo efectivo de 120 segundos. No hay incremento de buffers ni streaming progresivo en este cambio. Se verifican longitud, cabecera y SHA-256; el importador separado verifica también tags presentes, bytes y publicación. El hash identifica esos bytes, no una canción por su nombre.

Después del recibo y refresh se asocia el id público LRCLIB y sus metadatos de versión a la ficha y su huella. La asociación vive en settings, sin credenciales, cuentas, chats, IDs de documentos o callbacks Telegram. Se verifica en cada uso: un manifiesto ausente permite conseguir la copia de nuevo; corrupción, IO desconocido y referencias inconsistentes detienen la operación. La asociación no depende de la sesión de Telegram. Una sugerencia local apunta directamente a su Track. No se fusionan grabaciones por título solo ni se inventa identidad para artistas desconocidos.

La retirada conserva la ficha y su huella. Reimportar los mismos bytes permite al núcleo existente volver a enlazar esa ficha, conservando favoritos y playlists. Otra codificación con distinta huella no se fusiona automáticamente con una ficha antigua por compartir un nombre.

## Autoridad y reproducción

Root conserva owner/proof, scope, generación de base, reservas, revisión y admisión musical. La sesión Telegram en RAM tiene un lifetime separado de los permisos transitorios para iniciar comandos: preparar la propia cola no cierra la sesión. Una captura de comando anterior a una reserva o mutación sigue inválida cuando termina. Logout, pérdida de control/base, cambio de contexto o Cancelar impiden un Play tardío. Las órdenes posteriores de Pausar, Reproducir, cambiar de pista, seek o elegir otra ocurrencia, incluidos los controles del sistema, sustituyen la intención pendiente y solicitan cancelar su operación.

No se publica éxito hasta el recibo durable y el refresh. Cancelar no liquida un RPC pendiente y no borra un commit ganador. Sólo el Play todavía autorizado prepara su cola y selecciona la copia verificada con el único Audio existente. Reabrir, recibir sugerencias o restaurar la cola nunca genera esa intención. Si el navegador rechaza play por falta de gesto, se muestra el aviso y queda el control Reproducir; no se promete evitar las políticas de Safari.

## Configuración → Almacenamiento

La lista cuenta una vez cada archivo físico completo, aunque lo referencien varias fichas o playlists. Los tamaños son declarados; la estimación del navegador cubre todo el origen y se presenta aparte. Comprobar archivos actualiza el inventario; no se garantiza cuota ni retención perpetua.

Quitar descarga usa la reserva, revisión, declaración y confirmación del núcleo existente. Conserva fichas, favoritos y playlists y protege reproducción, cola, preparaciones, lectores y operaciones inciertas. No se habilita una retirada si el transporte no permite acreditar protección; no se fabrica autoridad por ausencia de un Service Worker. No hay limpieza destructiva automática.

La copia de Pulso pertenece a Safari u otro navegador. No requiere exportar a Archivos y no se envía a Cloudflare ni a un servidor propio. Telegram nativo mantiene su caché independiente: la web no puede compartirla ni borrarla. Pueden coexistir buffers y staging temporales; la garantía es una copia gestionada por asset, no una sola copia en todo el teléfono.

Las pruebas con SDK sintético se registran por separado de Telegram real, Safari/iPhone físico, autoplay y reproducción bloqueada. Ninguna de estas aceptaciones físicas se deduce del build o de Chromium.

El presupuesto decodificado de metadatos se aplica por respuesta; el total del recorrido queda acotado además por sus lecturas ya permitidas. No se comparte una única cuota de 64 KiB entre todos los sondeos. [Presupuestos y diagnóstico L15](BOT-SEARCH-DIAGNOSTICS.md#corrección-del-presupuesto-l15).
