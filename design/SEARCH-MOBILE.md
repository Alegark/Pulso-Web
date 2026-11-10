# Buscar en teléfono

Referencia del propietario: IMG_6734, búsqueda de un artista en Spotify móvil.
La corrección se aplica a `src/ui/MusicSearchPanel.tsx` y `music-search.css` de la
app funcional. No cambia el catálogo, las reglas de coincidencia ni el motor.

La [ayuda oficial de Spotify](https://support.spotify.com/my-en/article/search/)
confirma la búsqueda de canciones, álbumes y artistas. Su
[descripción de filtros móviles](https://newsroom.spotify.com/2021-05-27/how-to-get-the-most-out-of-search-on-spotify/)
explica cómo limitar el tipo de resultado. La composición concreta de esta
corrección toma como referencia la captura actual aportada por el propietario;
el artículo de filtros es histórico y no demuestra la UI actual de iOS.

| Before | After | Why |
| --- | --- | --- |
| Bloques separados con títulos y estados vacíos por cada tipo | Una lista continua con «Artista», «Álbum · intérprete» y «Canción · intérprete» | Reconocer el contenido sin recorrer varias secciones. |
| Opciones de proveedores y actualizar interrumpen el recorrido | Resultados primero; detalles y actualización manual después | Dar prioridad a encontrar música. |
| Búsqueda con encabezados repetidos | Campo compacto durante la edición, Borrar y Cancelar | Aprovechar la pantalla del teléfono con el teclado abierto. |
| Input y botón pueden disputar el espacio con texto ampliado | El campo conserva espacio; Cancelar pasa a otra fila cuando hace falta | Mantener el texto al 200 % y los controles accesibles. |
| Indicador nativo de borrar más otro control | Un solo botón Borrar con nombre y área de 44 px | Evitar controles duplicados en Safari. |

## Interacción

- Los resultados son contenido de la página. No se usa combobox, listbox,
  menú emergente, portal ni posicionamiento absoluto/fijo para la lista.
- Escribir conserva el foco y llama sólo al cambio de consulta. Las respuestas
  del controlador actualizan las filas en el mismo lugar.
- Todo mezcla tipos. El título que coincide exactamente aparece primero; luego
  artista, álbum y canción, conservando el orden relativo dentro de cada grupo.
  Esto ordena la presentación; no crea nuevas coincidencias ni identidades.
- Los filtros permiten ver un tipo. No hay secciones vacías por cada categoría.
- Borrar vacía el campo y mantiene la edición. Cancelar vacía, sale de la edición
  y devuelve el foco al encabezado Buscar. Las cancelaciones reales conservan el
  recorrido existente de `onQueryChange` del controlador.
- Enter conserva la confirmación de catálogo. La elección explícita de una fila
  sigue siendo la acción que abre artista/álbum o selecciona la canción.
- La cabecera duplicada se contrae sólo en Buscar móvil activo. La navegación
  inferior se conserva. Cancelar vuelve a mostrar Configuración; navegar a otra
  página también restaura la cabecera aunque la consulta esté conservada.
- Las portadas usan el componente `CatalogArtwork` integrado en paralelo, con
  su fallback. No se inventan imágenes, insignias verificadas, EPs ni playlists
  externas que el catálogo de Pulso no proporciona. Tampoco se dibuja un «+» sin
  una acción real de organización conectada.

## Alcance de las pruebas

`tests/integration/check-search-mobile-ui.mjs` ejercita el componente real con
props y callbacks sintéticos en Chromium y WebKit: lista mixta, tipos, orden,
foco durante actualizaciones, Enter/elección, filtros, Borrar/Cancelar, callback
retirado, estado pendiente, error/reintento, ausencia de datos, títulos extremos,
texto al 200 %, viewport corto y tema oscuro. Bloquea audio, almacenamiento y red.
El fixture no acredita búsqueda real ni resultados de Spotify/Telegram.

`tests/integration/check-interface-main.mjs` verifica por separado la combinación
con los controladores, IDB y audio sintéticos del producto. El encabezado de
resultados permanece para accesibilidad; la prueba espera su presencia y las
filas visibles. Para abrir Configuración desde la edición móvil, sigue el
recorrido Cancelar → Configuración.

Los recibos y negativos originales se conservan en `.local/design-search-mobile/`.
Un viewport reducido modela espacio disponible; no equivale al teclado de un
iPhone real. Safari físico, VoiceOver y composición con chrome real del navegador
siguen pendientes. La publicación se coordina por separado de estas pruebas.

Resultado local final: 12/12 comprobaciones del componente y 22/22 grupos del
producto integrado en Chromium 154 y WebKit 27.2. Lint PASS. La copia integrada
congela 186 fuentes que coinciden antes/después y con el árbol al cerrar;
no se observaron errores de página ni salidas externas y los contextos/servidores
se cerraron. No sumar ambos conjuntos como casos únicos ni como aceptación física.

Los primeros negativos preservan dos hallazgos reales: falta de espacio del input
con fuente al 200 % y desbordamiento de las tarjetas de exploración vacías en ese
tamaño. Se corrigieron el reparto flexible del campo y el mínimo de la cuadrícula.
El ajuste de Configuración en el arnés sigue Cancelar → Configuración, sin hacer
clic en elementos ocultos. La integración de portadas concurrente se conserva y
su red/proveedor tienen evidencia independiente.
