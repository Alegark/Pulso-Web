# Búsqueda musical: sugerencias y consulta al bot

Implementación web comprobada localmente. La entrega privada se registra en `docs/evidence-music-search-web.json`; no acredita la gramática real de un bot, una cuenta real ni iPhone físico.

En Buscar se escribe una canción, artista o álbum. Las sugerencias locales funcionan sin proveedor externo. LRCLIB se consulta directamente sólo si se autoriza el envío de la consulta, IP e identificador de Pulso. Su API v2 beta devuelve registros musicales; agrupaciones de artistas/álbumes derivadas no representan un catálogo completo ni disponibilidad en Telegram. No se usa audio, fotos ni la sesión para obtener estas sugerencias.

Para consultar Telegram se conecta la cuenta, se añade y elige un bot y se autoriza el mensaje en su chat personal. Elegir una sugerencia de canción envía una única consulta estructurada: el adaptador de ivkmbot usa título y artista, conservando álbum/duración como expectativa sin inventar sintaxis. Se preservan títulos con remix, live u otra versión. Las sugerencias de artista/álbum refinan el texto; el texto libre requiere Buscar en Telegram. Escribir, marcar el permiso, conectar o reordenar no manda mensajes al bot.

El bot tiene que estar seleccionado por el usuario; no existe bot predeterminado. El adaptador inicial es ivkmbot, sin respaldo automático. Su respuesta se muestra como texto, opciones o referencia de audio según los datos disponibles. Proximidad temporal no prueba causalidad ni identidad musical. Coincidencias, conflictos y metadatos ausentes se muestran con sus límites.

Elegir una opción del resultado sólo la selecciona en Pulso. Este incremento no ejecuta los botones del bot, obtiene audio, descarga ni reproduce resultados. No inicia bots, reenvía a Saved, se une a fuentes ni repite automáticamente consultas fallidas. Un envío incierto puede haber quedado en el chat y se debe revisar antes de repetirlo.

La sesión de Telegram sigue siendo temporal por pestaña; cambiar a otra no traslada su acceso. Los resultados tienen vigencia acotada y se invalidan al cambiar consulta, proveedores, cuenta o autoridad. Navegar/cancelar revoca publicación antigua, preservando el asentamiento del transporte.

La cancelación retira la publicación del intento, pero conserva la observación de su RPC original hasta asentamiento; si no se puede confirmar, se cierra esa sesión. Los mensajes correlacionados como respuesta deben pertenecer al chat consultado. Una solicitud de control rechazada por una operación activa conserva la autoridad y la sesión del propietario actual.

Para probarlo:

1. Abre Buscar y escribe al menos tres caracteres. Activa las sugerencias externas si quieres consultar LRCLIB; las locales no necesitan red.
2. Conecta Telegram y añade el bot en Bots de música. Elígelo también en el buscador y autoriza el mensaje de consulta.
3. Elige una sugerencia de canción para consultar título y artista, o pulsa Buscar en Telegram para enviar el texto escrito. Elegir artista o álbum sólo cambia el borrador.
4. Revisa las opciones que devuelve el bot. Seleccionarlas aquí aún no pulsa su botón en Telegram ni obtiene el archivo.

Validación local:449 unitarias;22 grupos de worker VM con transporte SDK inyectado;17 grupos de aplicación completa Chromium154 con dos controles main sin sustitución SDK y15 grupos con fábrica SDK sintética en worker nativo. Las fuentes de main no se transformaron. Otros10 controles del SDK instalado prueban cancelación/resultado tardío, plazo real y peer de respuesta;15 grupos nativos de ownership conservan el contrato de cesión. Los límites y procedencia de cada nivel se conservan por separado. Los RED R144/R145/R146 previos permanecen; no se renombran como aprobación de revisiones posteriores.
