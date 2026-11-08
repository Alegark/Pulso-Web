# Álbumes y artistas

## Recorrido y almacenamiento

El álbum abre una página con las pistas ordenadas de una edición concreta. Elegir una pista intenta reproducirla usando primero una copia local verificada. Escuchar no incorpora la ficha a Biblioteca. **Añadir álbum** es una acción explícita: verifica y reutiliza copias existentes, obtiene las faltantes secuencialmente y confirma la pertenencia a Biblioteca. No cambia la pista que ya estaba sonando.

La disponibilidad física y la pertenencia son distintas. Una pista puede aparecer como «Descargada» y estar fuera de Biblioteca, o como «Sin descarga · En Biblioteca». Un recibo de incorporación antiguo no sustituye la comprobación actual del archivo. La verificación del estado no consulta Telegram.

Cancelar revoca la intención de continuar; no inventa el aborto de una operación de almacenamiento que ya pudo confirmar. Las pistas inciertas requieren revisión y no se reenvían automáticamente. Las copias y la organización ya confirmadas se conservan.

## Página de artista

La orden del propietario del 2026-11-08 añade búsqueda por artista y sustituye la exclusión histórica de esa categoría. La barra común obtiene sugerencias de canciones, álbumes y artistas al escribir; Enter o Buscar muestran las tres categorías, sin botones de búsqueda separados. Sólo seleccionar un artista abre su página; escribir o pulsar Enter no abre una ficha ni consulta bots. Elegir un álbum del artista usa su ID de edición, sin resolver de nuevo una combinación ambigua de título y nombre.

El proveedor de metadatos es iTunes Search API, mercado US. Artistas y álbumes comparten el transporte limitado, la cola y el cooldown del documento. Se muestran hasta 20 artistas y hasta 100 publicaciones por artista; no se promete una discografía exhaustiva. Las publicaciones asociadas pueden tener otro intérprete principal: se mantiene su crédito literal y no se rechaza toda la lista por esa diferencia. La identidad del artista de la respuesta debe seguir coincidiendo con la solicitada. No se descargan portadas, previews ni audio de Apple.

## Evidencia y estado al 2026-11-08

Álbumes: 541 pruebas unitarias y una selección final local de 21 grupos pasaron. El build privado `1669f4d62c13bc7b` pasó auditoría y pruebas de producción en Chromium y WebKit de escritorio con metadatos sintéticos y audio propio. La comprobación HTTPS pasó tras reiniciar el servidor existente para aplicar la política de conexión a iTunes; no se creó otro servicio ni permiso de acceso. Los 10 avisos históricos WebKit `style-src-attr` se registran por separado.

La prueba real de MOSCA se detuvo antes de consultar al bot porque la búsqueda de álbumes no ofreció la edición esperada. No acredita descarga completa ni reproducción. Una comprobación pública posterior encontró la edición `6813620396`, sus 17 pistas y el artista Nsqk. La lista del artista incluía 62 colecciones, 27 con un crédito principal distinto; el parser anterior rechazaba esa respuesta completa. El RED se conserva en `.local/artist-page-parent/REPORT-test.md` y su diagnóstico público. La corrección tiene control negativo reproducido y 16 pruebas focales PASS, incluyendo créditos asociados, IDs malformados, duplicados y regresiones de álbumes.

La página de artista pasó una selección final única de **26/26** y está en la entrega privada `80a9423c34c6d88b`, verificada por HTTPS. Los dos cambios finales de interfaz tienen lint y pruebas nativas actuales; las 545 unitarias pasaron antes de esos cambios y no se repitieron después. MOSCA real, iPhone físico, reproducción bloqueada, offline privado y P0-W siguen pendientes. Los recibos sintéticos y los reales se mantienen separados. No se almacenan música ni sesiones en Cloudflare: el audio real permanece en el almacenamiento normal del navegador del usuario.


El recorrido de regreso conserva la edición cargada y libera el indicador de inspección cancelada; los bytes se verifican de nuevo al mostrarla. La posición y el foco del artista se restauran después del commit que muestra su lista, con guarda de ámbito y visibilidad. Se conservan las matrices anteriores 25/26 con los fallos de inspección y desplazamiento. El caso largo pasó tres focales independientes, separadas de la matriz final. La evidencia actual se resume en [evidence-albums-artists-web.json](evidence-albums-artists-web.json).


## Apertura de álbum sin consultas al bot

La aclaración del propietario se comprobó sin cambiar el runtime publicado. Una prueba focal G27 con main íntegro y SDK sintético conectado abrió tarjetas de álbum desde sugerencias y resultados: cero RPC y cero Play; seleccionar después una pista ficticia produjo una consulta, un callback y una copia fuera de Biblioteca. Ese control positivo comprueba que el cero anterior no se debía a un SDK ausente. Es una prueba independiente, no una matriz nueva 27/27 ni una suma a las 26 previas. El arnés se añadió después del build publicado.

En el perfil real, Nsqk → artista → mosca mostró 17 pistas sin seleccionar canciones ni Añadir álbum, con cero comandos bot-search.search/download/cancel observados. El estado inicial de reproducción no se registró suficientemente y no se afirma ausencia de un arranque nuevo real; al finalizar estaba pausado. Las sugerencias rápidas reales no ofrecieron el álbum objetivo, por lo que esa entrada se acredita con la fixture, no como recorrido real. La prueba anterior de reproducción había seleccionado expresamente SAMSA después de abrir MOSCA. Evidencia: [evidence-album-navigation-web.json](evidence-album-navigation-web.json).

La reproducción de SAMSA continúa pendiente: el último intento conocido terminó timeout acknowledged. La primera auditoría privada falló al proyectar la ventana. Una segunda lectura acotada a cinco mensajes sí terminó y cerró su cliente: observó un teclado y ningún audio en esa ventana, pero la relación con el callback y el baseline original siguen siendo desconocidos. No determina la causa del timeout. Ninguna auditoría envió búsquedas ni callbacks nuevos; todos sus archivos temporales se retiraron preservando los 282 archivos preexistentes.
