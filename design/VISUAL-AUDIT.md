# Revisión visual de la app funcional · 2026-11-13

La referencia sigue siendo `design/prototypes/app-demo.html`, las capturas del propietario y la dirección Bruma: superficies claras, azul de la app, carátulas protagonistas y controles discretos. Esta revisión cambia la aplicación React real. No sustituye la app por el prototipo ni introduce un tema nuevo.

## Antes / después / motivo

| Apartado | Before | After | Why |
| --- | --- | --- | --- |
| Inicio | Símbolos musicales aunque había portadas locales; accesos repetidos; tarjetas sin jerarquía constante. | Carátulas locales en recientes y selección actual, mosaicos de playlists y cuatro accesos principales. | Reconocer la música a simple vista y acercar la pantalla a la referencia aprobada. |
| Biblioteca | Una categoría obligatoria; crear playlist aparecía como formulario abierto. | Vista inicial mixta de Favoritos, playlists, álbumes y artistas; filtros que se pueden activar y quitar; creación plegada. | Explorar colecciones con menos pasos y sin mostrar herramientas antes del contenido. |
| Artistas locales | Tarjeta igual que un álbum. | Carátula circular en la cuadrícula. | Diferenciar el tipo por forma y por texto, sin inventar fotos de artista. |
| Escritorio | Navegación lateral alta y casi vacía, sin accesos a las playlists. | Navegación compacta, biblioteca lateral con carátulas y acceso superior a Buscar. | Aprovechar el ancho como reproductor web y mantener las colecciones accesibles. |
| Álbumes | Paneles encajados, avisos técnicos antes de canciones y etiquetas que comprimían el título al ampliar texto. | Cabecera limpia, portada centrada en móvil, canciones primero, estado de copia debajo de cada canción y procedencia al final. | Dar prioridad a la música sin ocultar información de disponibilidad. |
| Catálogo de artistas | Explicación de origen antes de los álbumes; cuadrícula con ancho mínimo rígido. | Álbumes antes de los detalles secundarios; cuadrícula que cabe también con texto ampliado. | Explorar música antes de leer información técnica. |
| Configuración | Documento largo de secciones anidadas y formularios abiertos. | Apartados plegables de cuenta, almacenamiento, reproducción, verificación, archivos, respaldo y apariencia. | Facilitar el acceso a una tarea sin exigir recorrer todos los controles. |
| Barra de reproducción | Caracteres tipográficos distintos para anterior/siguiente en escritorio. | Iconos SVG coherentes y controles existentes. | Evitar proporciones distintas según navegador o fuente. |
| Cola | Acciones y título competían por una sola fila; título prácticamente sin ancho al 200 %. | Nombre en su propia línea y acciones debajo. | Mantener el contenido y los controles utilizables con texto grande. |
| Espaciado | Reserva inferior duplicada y huecos excesivos. | Reserva del dock existente y margen de contenido menor. | Dejar llegar al final sin añadir una segunda pantalla vacía. |

## Recorrido cubierto

Inicio poblado, Biblioteca mixta y filtros, Favoritos, playlist con canciones y vacía, opciones de edición, Buscar mixto, álbum, artista, minirreproductor, reproductor expandido, vista de letra, cola y Configuración. Dentro de Configuración se recorren almacenamiento, organización y archivos locales. Los avisos flotantes y los flujos de cancelar cambios conservan sus componentes existentes.

Las carátulas del producto salen de los datos disponibles. Inicio y Biblioteca sólo leen portadas locales; no buscan imágenes por abrir una colección. Los mosaicos se activan cuando se acercan al viewport. Favoritos conserva corazón y la misma semántica independiente de Biblioteca. No se añaden perfiles, insignias de verificación, contadores sociales ni metadatos ficticios al producto.

## Validación y alcance

Fuentes congeladas: `.local/visual-audit/final/freeze.json` y su `frozen-root`, 192 archivos runtime. Build de revisión aislado; `dist` y la publicación privada no se escriben desde esta revisión. Datos de prueba: cuatro carátulas PNG, audio WAV y letra originales del fixture local; catálogo simulado.

La matriz visual usa Chromium y WebKit de Linux, 390×844, 1366×900, 320×568 y texto al 200 % a 320 y 1366 px; incluye capturas oscuras a 390 px. Se comprueban desbordamiento horizontal y tamaño de botones/resúmenes visibles. Las capturas se revisan además visualmente: estas medidas no prueban por sí solas una buena composición.

WebKit usa un perfil persistente sintético nuevo para el fixture PNG/IndexedDB. El contexto efímero de WebKit rechaza esos PNG antes de renderizar la UI; el contexto habitual permanece en la regresión general. Ninguno equivale a Safari en iPhone ni a Safari privado.

Resultados de las fuentes finales:

- `npm run lint`: PASS.
- Regresión funcional: **34/34 grupos PASS**, Chromium 154.0.8037.57 y WebKit 27.2. Informe `.local/interface-browser-validation/2026-11-13T00-42-49-697Z/report.json`; hashes de las 192 fuentes verificados antes y después, sin errores JS ni conexiones externas observadas; cleanup true.
- Auditoría visual: **12/12 grupos PASS**, 32 vistas entre ambos motores con la matriz de tamaños y texto. `.local/visual-audit/artwork-settled/report.json` (y recorrido `verified` previo); sin desbordamiento horizontal ni botones/resúmenes visibles menores de 43 px, sin errores JS ni conexiones externas observadas; cleanup true. Es una comprobación separada, no 46 aceptaciones únicas.
- Las pruebas existentes mantienen navegación, foco del reproductor, continuidad del único audio, letra/cola, favoritos, crear/renombrar/añadir/cancelar, reproducción de playlist e interrupción antes del commit. No sustituyen las pruebas del proveedor musical.
- Engram oficial: lectura final con `FullContentVerified: true`; sin escrituras/sincronización de este hilo mientras continúa el HOLD.

[Comparación interactiva antes/después](prototypes/visual-audit.html). Capturas de Chromium con el mismo fixture local; no son fotografías de un teléfono.

## Límites y pendientes

- Safari físico del iPhone 13, teclado real, barras dinámicas, áreas seguras y VoiceOver siguen pendientes. Las dimensiones y WebKit local no los acreditan.
- Formularios de código/contraseña y estados de cuenta autenticada no se prueban con una cuenta real; se preservan los controles y controladores existentes.
- Los estados sin portada siguen mostrando el fallback. La revisión no puede fabricar imágenes ni convertir la ausencia de metadatos en un resultado completo.
- La vista de letra conserva sus estados de carga, sin letra y contenido disponible; el fixture visual usa letra original, sin descargar letras ajenas.
- La disponibilidad de reproducción y las altas de canciones siguen sujetas al motor y permisos actuales. Los cambios visuales no solucionan incidencias de proveedores.
- Integración/publicación coordinada y comprobación posterior del enlace funcional se registran por separado. No declarar paridad completa ni P0 terminado por esta revisión.

## Incidencias de la comprobación

Se conservan los informes negativos. El primer recorrido encontró un desbordamiento real de álbum a 320 px/200 %; la primera corrección dejó la fila con ancho cero y se corrigió colocando sus etiquetas debajo. El siguiente recorrido encontró el mismo problema en la cola y se corrigió la distribución.

El bootstrap inicial de prueba intentaba insertar un script en `<head>`, pero el HTML compilado no contenía esa etiqueta literal. Por eso no se aplicaban la simulación de letra ni la desactivación de Service Worker: la preparación de audio agotaba el tiempo. Se corrigió el arnés, sin cambiar el motor de producción, y los recorridos nativos finales bloquean cualquier conexión externa. En la inspección compartida inicial sí hubo consultas públicas de metadatos para la consulta ficticia «Luna Norte» antes de corregir el aislamiento; sin cuenta Telegram ni datos privados. No describir toda la sesión como carente de red pública.

La toma inicial de algunas capturas al terminar el cambio de viewport ocurría antes de que se decodificaran los mosaicos. No se interpretan esas imágenes transitorias como ausencia de las portadas guardadas. La regresión de playlist espera explícitamente las cuatro imágenes decodificadas en ambos motores. Se conserva además el intento `settled` que esperaba imágenes de elementos geométricamente presentes pero recortados por un contenedor: esa espera no sirve para evaluar el lazy loading de elementos fuera del área visible. Las capturas definitivas esperan las portadas visibles dentro del contenido; `artwork-settled` pasa 12/12 grupos y 32 vistas en ambos motores, sin errores ni externos y cleanup true.

`html_preview` devolvió timeout de 20 s; no se registra como PASS. `html_render` sí adjuntó la comparación de capturas reales.
