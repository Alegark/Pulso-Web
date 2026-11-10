# Exploraciones de diseño de Pulso

[Guía de diseño y desarrollo de los apartados](design.md).

[Buscar en teléfono: lista mixta y controles de edición en la app funcional](SEARCH-MOBILE.md).

[Playlists: carátula, reproducción y filas compactas en la app funcional](PLAYLISTS.md).

## Muestra navegable · 2026-11-09

[Abrir Inicio, Buscar, Biblioteca, playlists, álbum y artista](prototypes/app-demo.html).
Documento autónomo para teléfono o escritorio. Navegación real dentro de la
muestra, búsqueda por categorías, favoritos, añadir/quitar álbum y reproductor
persistente con un sonido original de 8 segundos. Catálogo y tiempos ficticios;
los cambios viven en RAM y se reinician al recargar. No usa Telegram, catálogo
remoto, biblioteca real, descargas ni almacenamiento del producto.

Al final de cada pantalla, **Probar estados del diseño** permite activar errores
de búsqueda o reproducción, títulos largos y Biblioteca vacía. La burbuja
permanece hasta cerrar o recuperar la operación; incluye reintento manual,
bloqueo mientras se procesa y mensaje accesible. También puede aparecer dentro
del reproductor expandido, conservando sus controles y cierre. Es una burbuja
flotante: se superpone al contenido por encima del minirreproductor sin mover
la pantalla y sigue el viewport visible al cambiar la altura.

**Playlists:** acceso desde Inicio, el lateral de escritorio o
Biblioteca → Playlists. Se puede crear, cambiar nombre/descripción, añadir
canciones, subir/bajar, quitar y eliminar una lista con confirmación. Eliminar
una playlist conserva Biblioteca y Favoritos. La escucha y Siguiente respetan
el orden copiado al comenzar. Toda la organización continúa siendo de muestra,
sólo en RAM; no son playlists reales ni descargas.

**Biblioteca:** abre una cuadrícula de colecciones, con filtros únicamente
Playlists, Álbumes y Artistas. **Favoritos es una playlist automática**, fijada
al principio y con corazón en su carátula. Reúne las canciones añadidas desde
un corazón, álbum o playlist; escuchar no añade. No hay categoría Favoritos ni
pantalla global de todas las canciones. Se puede buscar dentro de Biblioteca,
ordenar por nombre y alternar cuadrícula/lista. Favoritos permanece incluso vacía
y no se puede eliminar ni renombrar.

**Reproductor y letra:** [abrir la revisión del reproductor](prototypes/player-lyrics-preview.html).
Portada grande, indicador **+ / gancho azul** junto a título/intérprete,
posición y controles de anterior, Play/Pausa, siguiente, aleatorio, repetición
del tono y cola. El gancho sólo significa añadida a Favoritos; no descarga.
La tarjeta **Vista previa de la letra → Mostrar letra** abre la vista completa
y regresa al mismo punto sin reiniciar audio. El texto es original de la muestra
y sus tiempos sólo demuestran el diseño: el sonido es instrumental de8s.
Primera pista: texto con tiempos de demostración; segunda: sin sincronizar;
desde la tercera: letra no disponible, con reproducción intacta. Sin proveedores
de letras ni traducciones conectados. Este preview abre pausado; para probar en
Safari directamente usar `app-demo.html` y expandir el minirreproductor.

**Escritorio:** [abrir la vista web de 1366px](prototypes/desktop-preview.html).
Desde1024px hay lateral persistente con playlists, búsqueda superior y barra
inferior de ancho completo: título/intérprete, transporte central, posición,
volumen y accesos directos a Letra/Cola. El player ampliado usa dos columnas.
El preview muestra un viewport real de1366px reducido para caber en el hilo;
`app-demo.html` se adapta al ancho real del navegador. En teléfono conserva el
mini sobre la navegación inferior. No inicia otro audio al cambiar de ancho.

**Móvil, siguiente revisión:** [abrir la muestra de teléfono](prototypes/mobile-preview.html).
Inicio ofrece accesos rápidos a tus colecciones. Buscar tiene una barra compacta
y entradas a álbumes, artistas, playlists y Favoritos. Los tres destinos siguen
en la navegación inferior, con mini flotante y controles de44px. En cada fila,
**⋯** abre opciones de canción: reproducir ahora, añadir/quitar de Favoritos o
añadir a una playlist, con las coincidencias ya presentes desactivadas. El panel
se puede cerrar con su botón o Escape y devuelve el foco a la canción. Para
validar Safari físico usar `app-demo.html` directo; el preview limita el ancho
a390px y no reproduce las barras o teclado del teléfono real.

Regenerar: `node design/scripts/build-app-demo.mjs`.
Validar: `INSTABOX_HEADLESS=1 node tests/integration/check-design-screens.mjs`.
Tipos de la muestra: `npx tsc -p design/app/tsconfig.json` (usa la dependencia
ya instalada). El builder sólo compila la entrada de diseño y genera los HTML;
no ejecuta el build normal ni escribe `dist`. `app-preview.html` es el contenedor
de presentación de 840px de alto, abierto inicialmente en Biblioteca; para probar
Safari usar `app-demo.html` directo.

## Exploración anterior del reproductor

Para abrir la muestra directamente en un teléfono, usar
[player-phone.html](prototypes/player-phone.html). Esta versión usa el espacio
visible del navegador, sin un marco de altura fija. La muestra anterior y la
vista incrustada también están corregidas. Regeneración reproducible:
`node design/scripts/build-mobile.mjs`.

[Abrir el prototipo del reproductor](prototypes/player-directions.html).

[Abrir la vista móvil interactiva](prototypes/player-mobile.html): muestra en
un viewport real de hasta 390px, incluso al verla en escritorio. Su altura se
ajusta al espacio visible en vez de fijarse a una pantalla de escritorio. Los botones
Álbum/Reproductor cambian la vista y el selector interior conserva las tres
paletas. La lista de pistas se desplaza dentro del área de contenido, con
minirreproductor y navegación inferior visibles. Es una presentación aislada
del diseño, no una integración de este comportamiento en la aplicación.

Este HTML autónomo muestra tres direcciones para el minirreproductor y su
expansión, con contexto de álbum adaptable a móvil y escritorio:

| Propuesta | Colores | Composición |
| --- | --- | --- |
| Bruma | Blanco frío y azul cobalto | Clara y editorial; reproductor dividido |
| Grafito | Carbón y coral | Compacta; reproductor lateral |
| Tinta | Azul noche y lavanda | Centrada e inmersiva |

Usar el selector superior o las teclas **1–3** / **← →** para cambiar de
propuesta. Abrir el reproductor tocando el título del minirreproductor.
**Esc** cierra el reproductor y devuelve el foco. Dentro hay Play/Pausa,
anterior/siguiente, posición, volumen, modos y cola. La muestra tiene audio
instrumental original generado en el navegador tras una acción de reproducir;
no usa Telegram ni archivos musicales del propietario.

El control **Contenido** permite ver títulos largos con colaboradores y sin
portada, una colección vacía o una sola canción. Buscar filtra las pistas de
muestra. Favoritos y pertenencia sólo se conservan en RAM de esta exploración.
La navegación Inicio/Buscar/Biblioteca de los márgenes es contexto visual
estático, no un recorrido completo del producto.

El aspecto general fue aceptado como punto de partida. Paleta y composición
todavía se pueden combinar. La primera base responsive está implementada en
el código de la app y validada mediante sus componentes aislados; el build
normal combinado y la publicación quedan pendientes de coordinación funcional.

La exploración usa las skills de [Emil Kowalski](https://github.com/emilkowalski/skills).
El selector neutral procede de `prototype/PICKER.md`, con su licencia MIT en
este directorio de prototipos. La portada vectorial y el audio son originales
de la muestra. No hay imágenes ni fuentes externas, servidor o dependencias.

Pruebas y límites: [tarea D1](../odd/tasks/D1-diseno-visual.md). La comprobación
de escritorio y anchos móviles no acredita Safari/iPhone físico ni reproducción
del producto con pantalla bloqueada.

## Interfaz del producto integrada · 2026-11-09

La presentación de Inicio, Buscar, Biblioteca, colecciones, ajustes y reproductor ya se conecta a los datos reales de la aplicación. Las muestras anteriores siguen siendo independientes y conservan sus datos ficticios. Véase [contrato y validación del producto](../docs/UI-INTEGRATION.md). La integración no cambia la semántica de Biblioteca, Favoritos o copias de escucha. iPhone físico sigue pendiente.
