# Búsqueda musical: catálogo antes del bot

La búsqueda admite nombres de canciones y álbumes. El artista aparece como dato para distinguir canciones y preparar la consulta precisa; no es una categoría ni un nombre por el que se busque en este recorrido.

Escribir muestra una lista superpuesta de hasta seis coincidencias. Se puede cerrar con Escape, con Cerrar sugerencias o pulsando fuera. Enter, Buscar y Ver todos los resultados muestran las coincidencias disponibles dentro de Pulso: nunca envían un mensaje a Telegram. La lista de resultados permite filtrar canciones y álbumes. Elegir un álbum sólo refina esa búsqueda de metadatos.

Sólo elegir una canción sugerida puede consultar al bot. Hace falta la sesión vigente y un bot principal compatible: es el primero del orden configurado en «Bots de música». La elección envía una sola consulta con título y artista; álbum/duración se conservan como expectativa, sin inventar sintaxis. Si falta sesión o un bot compatible, se muestra lo que falta y hay que volver a elegir la canción; conectar o recibir sugerencias no provoca el envío.

Los registros con el mismo título e intérprete se agrupan aunque procedan de otros álbumes o tengan distinta duración. Se normalizan mayúsculas, espacios y algunas diferencias tipográficas. No se eliminan calificadores del título como live/remix ni se agrupan intérpretes distintos o desconocidos. Es una agrupación de metadatos, no una identificación acústica ni una garantía de que dos grabaciones sean iguales.

Las sugerencias locales no necesitan red. Al escribir entre 3 y 160 caracteres, LRCLIB se consulta directamente de forma automática tras una breve espera; recibe la consulta, IP e identificador de Pulso. Su API v2 beta devuelve hasta veinte registros por consulta: la lista más amplia conserva el orden de relevancia de los candidatos devueltos, sin inventar páginas ni prometer todo el catálogo o un álbum completo. No se envía audio, letras, fotos ni datos de cuenta. Se respetan cancelación, plazos y límites sin reintentos automáticos.

El pool empieza vacío. El primer bot configurado es el principal; el adaptador inicial admite ivkmbot si ocupa esa posición. Otros no reciben sustituciones ni consultas de respaldo automáticas. Las opciones/textos/referencias de audio de su respuesta se presentan aparte del catálogo. Correlación y compatibilidad de metadatos no garantizan identidad musical. Elegir una opción devuelta aún es local: este incremento no pulsa su botón en Telegram, descarga ni reproduce su audio.

La sesión sigue en RAM por pestaña. Resultados y acciones antiguas no reviven tras cambiar consulta, orden de bots, cuenta o autoridad. Cancelar retira publicación pero conserva la observación del RPC hasta asentamiento; la incertidumbre cierra esa sesión si no se puede confirmar. Una cesión rechazada por actividad conserva la sesión del propietario actual.

La evidencia de la versión comprobada se registra en `docs/evidence-music-search-web.json`. Las comprobaciones sintéticas no acreditan el protocolo de un bot real ni el funcionamiento físico de iPhone. Los recibos y RED de la versión anterior se conservan; no se reinterpretan como pruebas del flujo nuevo.
