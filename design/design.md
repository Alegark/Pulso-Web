# Pulso · Diseño de la aplicación web

Estado: dirección visual aceptada como punto de partida el 2026-11-08.
La implementación empieza por el shell y el reproductor responsive. Este
documento gobierna su diseño; los contratos de datos, audio y permisos siguen
en `doc/SPEC.md` y las decisiones posteriores de `odd/tasks/`.

## Intención

Una biblioteca musical clara y rápida, con la exploración y organización de
Spotify y la jerarquía visual de Apple Music como referencias. Identidad propia
de Pulso; sin copiar marcas, portadas o pantallas exactas. Telegram es una fuente
musical y una conexión configurable, no la estructura de la navegación diaria.

El propietario aprobó el aspecto general del prototipo. **Bruma** es la base
inicial por ser la propuesta que abre por defecto, sin interpretar esa aprobación
como exclusión de Grafito o Tinta. La app conserva Sistema/Clara/Oscura; las
paletas coral y lavanda continúan disponibles para comparar en los prototipos.

## Sistema visual

| Token | Claro · Bruma | Oscuro de la base |
| --- | --- | --- |
| Fondo | `#f4f6fa` | `#111620` |
| Superficie | `#ffffff` | `#1b2331` |
| Texto | `#172335` | `#f2f5fb` |
| Texto secundario | `#566479` | `#b7c2d3` |
| Acento / botón principal | `#235ad7` | `#a8c5ff` |
| Texto sobre acento | `#ffffff` | `#10244c` |
| Borde | `#d9e0ea` | `#3b495e` |

- Tipografía del sistema, sin fuentes remotas. Jerarquía por tamaño/peso/espacio;
  títulos con tracking ligero negativo; texto normal con interlineado 1,5.
- Escala de espacios: 4/8/12/16/24/32 px expresada en rem cuando corresponde.
  Controles táctiles de al menos 44 CSS px. Inputs de al menos 16 CSS px.
- Portadas cuadradas, sin deformar, con `object-fit: cover` y placeholder estable.
  La disponibilidad del archivo y la pertenencia a Biblioteca son distintas.
- Radios de 12–20 px en superficies y píldoras para acciones. Foco de alto
  contraste; hover sólo con puntero capaz; feedback al presionar.
- Movimiento breve sólo para orientar o confirmar. Cambio de pista inmediato;
  no esperar animaciones para aceptar entrada. Respetar movimiento reducido.

## Responsive y Safari en iPhone

El iPhone 13 es una referencia prioritaria. Su pantalla y el área visible de
Safari son conceptos distintos: barras del navegador, teclado, orientación,
zoom y tamaño de texto pueden cambiar el espacio utilizable.

| Área disponible | Disposición |
| --- | --- |
| Menos de 600 CSS px de ancho | Navegación inferior de tres destinos y mini encima. Player completo en una columna. |
| Desde 600 hasta 1023 px | Shell amplio, menús accesibles y player de anchura limitada. |
| Desde 1024 px | Navegación lateral persistente, búsqueda superior y barra inferior completa. Player ampliado en dos columnas. |
| Menos de 480 px de alto | Priorizar scroll y controles alcanzables; reducir portada, conservar proporción. |

Reglas obligatorias:

1. Usar `viewport-fit=cover`; respetar `env(safe-area-inset-*)`, sin bloquear zoom.
2. Player adaptado al viewport visible (`visualViewport` con fallback CSS),
   nunca a la altura de la pantalla ni a una maqueta fija de 760/842px.
3. Un solo scroll principal por superficie; player expandido con scroll propio
   cuando texto/cola/teclado no caben. No comprimir portada, controles o textos
   para ocultar la falta de espacio.
4. En mini se puede truncar texto con acceso al título completo en player;
   en detalle se permite envolver títulos y colaboradores, también sin espacios.
5. Mantener audio y estado fuera de la composición visual. Abrir/cerrar player,
   rotar o cambiar de pantalla no crea un motor ni inicia una canción.
6. Al abrir: foco en el título, fondo no interactuable y cierre visible.
   Al cerrar: devolver foco/contexto. Escape funciona con teclado externo.
7. Probar apertura/cierre, tamaños cortos, orientación, zoom/texto ampliado,
   entrada de búsqueda y listas largas. No declarar Safari físico por emulación.

## Apartados y comportamiento

| Apartado | Contenido y acciones | Responsive y estados que diseñar |
| --- | --- | --- |
| Inicio | Continuar, añadidas recientemente, playlists propias | Una columna móvil; vacío útil y restore pausado; sin recomendaciones ficticias. |
| Buscar | Barra única y resultados canciones/álbumes/artistas | Teclado no tapa resultados/acciones; búsqueda vacía, carga, parcial, sin coincidencias y error recuperable. |
| Artista | Identidad y publicaciones asociadas | Rejilla adaptable; volver conserva foco/scroll; no prometer discografía exhaustiva. |
| Álbum | Edición concreta, portada, pistas y acciones explícitas | Cabecera fluye a filas; títulos completos; progreso por pista y lote parcial/incierto. |
| Biblioteca | Cuadrícula de playlists, álbumes y artistas; Favoritos como playlist automática | Sólo filtros Playlists/Álbumes/Artistas; Favoritos fijada con corazón; sin categoría ni listado global de canciones. |
| Playlist | Crear, renombrar, ordenar, quitar y escuchar | Alternativa con botones a cualquier drag; vacío, sin descarga y conflictos. |
| Minirreproductor | Título, intérprete y Play/Pausa/abrir | Por encima de navegación; sin portada ni datos técnicos; texto largo no desplaza controles. |
| Reproductor | Portada, título, artista, transporte, seek y modos | Una columna móvil; cierre siempre alcanzable; loading/pausa/buffering/error y gesto fresco cuando haga falta. |
| Cola y letras | Actual/siguientes y letras disponibles | Panel/sección propia con scroll; reordenar accesible; letras ausentes no bloquean música. |
| Configuración | Apariencia, Telegram/bots, almacenamiento y respaldo | Grupos legibles, formularios estables con teclado y errores junto a cada acción. |
| Recuperación | Fallos locales, conexión, copias pendientes | Aviso accionable, conservar datos; no presentar un resultado incierto como éxito. |

La acción principal de una pista reproduce. Añadir alimenta Favoritos en la
muestra actual; las playlists propias y las copias físicas se distinguen.
Las acciones secundarias irán a un menú
accesible; la primera fase conserva las guardas existentes mientras se extraen
los componentes de presentación. Sin envíos Telegram por organizar o navegar.

## Implementación por incrementos

1. **Implementado en código, validado de forma aislada:** tokens claro/oscuro, shell responsive, mini sin portada y
   superficie expandida accesible conectada al Player existente. Corregir la
   muestra móvil y sus alturas; no publicar la app por esta tarea.
2. Buscar y resultados: jerarquía y estados, conservando catálogos/adaptadores.
3. Álbum/artista: cabeceras, filas y progreso por pista, con regreso estable.
4. Biblioteca/playlists: filtros, menús, estados físicos/organizativos y orden.
5. Ajustes, cola/letras y refinamiento de accesibilidad/dispositivo real.

El primer incremento no cambia esquemas, sesiones, transporte, límites,
admisión, verificación de copias ni funciones de reproducción. Los componentes
visuales reciben callbacks; no adquieren autoridad musical o de almacenamiento.
No ampliar dependencias para maquetación o iconos simples.

## Validación y evidencia

Separar siempre:

- Chromium con anchos móviles/touch: evidencia de ese motor y esa configuración.
- WebKit Linux con perfil/tamaño de iPhone 13: aproximación útil para CSS y foco,
  sin identificarla como Safari instalado en el teléfono del propietario.
- Safari físico: navegador, iOS, barras abiertas/cerradas, teclado, orientación,
  tamaño de texto y resultado observado. Sigue pendiente hasta esa prueba.

Matriz local mínima: 320/375/390/430px de ancho, 480/568/664/844px de alto,
844×390 en horizontal y 1280×800 de escritorio. Portada ausente, títulos largos,
texto al 200%, tema claro/oscuro, movimiento reducido y cambios de viewport con
player abierto. Probar también en documento directo, no sólo dentro de iframe.

Un PASS de geometría exige tanto ausencia de overflow horizontal como acciones
alcanzables verticalmente mediante scroll; el cierre nunca puede quedar fuera.
Comprobar que volver de player no añade escuchas ni cambia Biblioteca y que la
pista conserva su progreso. Evidencia incremental en
[`odd/tasks/D1-diseno-visual.md`](../odd/tasks/D1-diseno-visual.md).

## Primera entrega de código y revisión responsive · 2026-11-08

| Antes | Después | Motivo |
| --- | --- | --- |
| Muestra con app de 760px dentro de iframe de 842px | Altura derivada del viewport visible, con documento directo para teléfono | En el perfil de iPhone13 hay 664px visibles; pantalla y navegador no son equivalentes. |
| El player expandido dependía de la altura del contenedor | Superficie que se ajusta al viewport y desplaza su contenido | Controles y cierre alcanzables en alturas cortas y horizontal. |
| SVG y flex podían aportar tamaños intrínsecos no deseados | Portada con proporción explícita y sin compresión flex | Conservar el cuadrado en ambos motores. |
| Mini con área para portada y texto mezclado con controles | Título/intérprete y botones separados, sin portada | Respetar el contrato de mini y mantener controles táctiles visibles. |

Código de producto: `src/ui/PlayerSurface.tsx`, `MiniPlayer.tsx`,
`design-tokens.css`, `responsive-shell.css`; integración acotada en `src/main.tsx`
y viewport de `index.html`. No se han cambiado por este incremento el Player,
sus guardas, sesiones, SDK, almacenamiento ni controladores de colecciones.

Prueba reproducible:
`INSTABOX_HEADLESS=1 node tests/integration/check-design-responsive.mjs`.
Compila sólo el fixture React de presentación, con componentes reales, Player
real y WAV propios. No compila `main` ni la integración funcional de Telegram.
**62/62 grupos PASS**, repartidos entre Chromium154.0.8037.57 y WebKit27.2;
sin errores de página ni peticiones externas, contextos cerrados. **19 pruebas
focales de Player/selectores PASS**; tipos y lint PASS. No sumar estas cifras
como si fueran aceptación de la aplicación completa.

El baseline WebKit conserva el fallo del marco que no cabe en 390×664.
La matriz actual incluye documento directo, marco incrustado, orientación,
alturas cortas, las tres paletas, portada cuadrada, foco, scroll, texto al200%,
tema oscuro y cambio de altura con el player abierto. Abrir/cerrar no cambia
generación, fuente ni cantidad de inicios de reproducción del Player real en
el fixture. La validación en navegador compartido se hizo sobre un origen
loopback propio, sin tocar la pestaña ni sesión reales del propietario.

**Pendientes:** comprobar la corrección en Safari físico del iPhone13;
teclado/safe areas/gestos reales; build normal
combinado y sus pruebas funcionales tras coordinación con el otro trabajo.
El registro ODD/Engram de este incremento se difiere mientras el coordinador
mantenga su tester de sólo lectura, por orden explícita posterior.

## Corrección de proporción de botones · captura de iPhone13

La captura del propietario identifica `player-mobile.html` y muestra el botón
azul de reproducción ovalado. La geometría se reprodujo en WebKit27.2 como
**40×58 CSS px**. Era una colisión entre reglas de ancho y alto: la regla móvil
genérica de `.transport .icon-button` sobrescribía sólo el ancho del botón
principal. No era una deformación de la portada ni un problema del motor de audio.

| Antes | Después | Motivo |
| --- | --- | --- |
| Regla móvil de40px aplicada también a Play/Pausa de58px de alto | Regla genérica excluye Play/Pausa; cada tamaño mantiene ancho y alto iguales | Mantener el círculo en las tres paletas. |
| Dimensión mínima implícita y apariencia nativa del botón | Mínimo44×44, proporción1:1, padding0 y appearance:none en controles de icono | Evitar compresión y diferencias de chrome nativo. |
| Pruebas de viewport y portada, sin aserción del círculo | Verificación de proporción y área de cada botón circular | La geometría de la pantalla no basta para aceptar el detalle del control. |

La muestra de teléfono, el viewer y el archivo original se regeneran desde la
misma fuente. El RED original se conserva en
`.local/design-responsive/buttons/baseline-RED.json`. La captura identifica
un fallo físico observado; la reparación local no se marca como revalidada en
el iPhone hasta que el propietario abra la versión corregida.

## Pantallas navegables y burbuja de error · 2026-11-09

Por instrucción del propietario se avanza en paralelo al trabajo funcional.
`design/app/` contiene Inicio, Buscar, Biblioteca, detalle de álbum y artista;
`design/prototypes/app-demo.html` los entrega en un documento autónomo responsive.
Usa los componentes reales MiniPlayer/PlayerSurface y un ErrorBubble nuevo,
con datos ficticios y organización en RAM. No importa `main`, SDK, Player del
producto ni bases persistentes. Un HTMLAudioElement estable reproduce un tono
original de 8 segundos tras gesto explícito. Todos los botones musicales usan
ese tono, nunca las canciones ficticias; la interfaz lo indica.

| Antes | Después | Motivo |
| --- | --- | --- |
| Navegación de contexto estática en la exploración anterior | Cinco pantallas conectadas, filtros y regreso con foco/scroll | Revisar el recorrido completo sin depender del transporte musical. |
| Sólo composición de álbum y player | Inicio editorial, resultados por categoría, biblioteca y publicaciones del artista | Definir jerarquía y densidad de cada apartado. |
| Sin burbuja de error común | ErrorBubble controlado, mensaje accesible y acciones de recuperación | Dar una salida visible sin perder consulta, cola u organización. |
| Reintento podría indicar éxito aunque el navegador rechace Play | El aviso permanece si falla play(); se retira sólo al recuperar | No presentar un rechazo de autoplay o formato como reproducción confirmada. |

La burbuja usa título y explicación preparados para la persona, nunca una
excepción cruda. No escribe logs, no inicia reintentos ni temporizadores y no
mueve foco por aparecer. El llamador controla su estado y conserva el contexto.
El mensaje usa una región `role=alert` ya montada; las acciones tienen objetivos
de44px. Cerrar/reintentar devuelve foco a búsqueda o cierre del player cuando
el foco estaba en la burbuja. No desaparece por tiempo. Tras la corrección
solicitada por el propietario se presenta flotante, fuera del flujo, sobre el
mini y la navegación; dentro del player se monta en la superficie activa para
no quedar bajo `inert`. Altura y posición siguen `visualViewport`; un aviso
extenso tiene scroll propio y conserva espacio para el cierre del player.

La muestra permite probar errores, carga y recuperación, cero resultados,
biblioteca vacía, títulos largos, tema oscuro y texto al200%. Biblioteca,
Favoritos y copia física se presentan por separado. Sin descargas simuladas,
recomendaciones ficticias, red ni persistencia. `ErrorBubble` es un componente
reutilizable preparado en `src/ui/`; aún no se conecta a errores del producto
real mientras se coordina el trabajo funcional.

ODD/Engram continúan en HOLD por la orden de mantenerlos intactos durante el
tester funcional. El registro listo para incorporar se conserva privadamente
en `.local/design-responsive/PENDING-ODD.md`. No build normal ni publicación.

Validación inicial de esta entrada aislada (antes de playlists/flotante): **28/28 grupos PASS**, Chromium154.0.8037.57
y WebKit27.2 Linux, sin errores de página ni solicitudes externas. Siete tamaños
por motor (320×568,375×667,390×480/664,430×700,844×390,1280×800), cinco pantallas,
botones circulares, texto largo, apertura/cierre y audio estable. Otros grupos
verifican reintento y cancelación tardía, rechazo real de la promesa play(),
favoritos/pertenencia separados, regreso con foco, aviso persistente más de8s,
tema oscuro y texto al200%. Tipos de muestra y lint de producto PASS.
El primer recibo25/26 se conserva: una aserción Chromium leía el aviso antes
del commit React tras reanudar audio; ahora espera la retirada observada, sin
ocultar fallos. No se suman esos recibos. Informe final privado
`.local/design-playlists/previous-report.json`. No aceptación de Safari físico, teclado
del iPhone, VoiceOver o del producto integrado.

## Corrección de avisos flotantes y playlists · 2026-11-09

El propietario precisa que los avisos deben flotar y señala la ausencia de
playlists. Se corrigen ambas cosas en la misma muestra, con la misma base Bruma.

| Antes | Después | Motivo |
| --- | --- | --- |
| Aviso colocado en el flujo que desplazaba el contenido | Capa fija, con ancho limitado y separación calculada sobre el dock | Que se perciba como burbuja y conserve la posición de la pantalla. |
| Posición sin considerar el viewport visible | Coordenadas de visualViewport, safe areas y alto medido del dock | Adaptarse a ventanas cortas y cambios de altura sin tapar el mini. |
| Playlists sólo descritas en la guía | Colección y detalle navegables, accesibles desde Inicio y Biblioteca | Poder revisar su recorrido y acciones en la muestra. |
| Organización de listas ausente | Crear, editar, seleccionar pistas, ordenar con botones, quitar y eliminar con confirmación | Completar el diseño sin depender de drag ni afectar canciones guardadas. |

La burbuja no ocupa espacio en el documento. El llamador reserva el alto real
del dock fijo con ResizeObserver; en horizontal corto el dock pasa al flujo y
esa reserva se hace cero. Dentro del player, el aviso conserva sus acciones
en la superficie modal. No hay temporizador ni reintento automático.

Las playlists de muestra tienen identidad y orden propios en RAM; no implican
pertenencia a Biblioteca, Favoritos ni copia offline. Quitar una canción sólo
cambia esa lista. Al eliminar se explica qué se conserva y se puede cancelar.
Al escuchar se copia su orden para Siguiente; editar la lista no reescribe la
cola ya iniciada. El audio continúa siendo un único tono de8s, no catálogo real.
La edición tiene nombre obligatorio (máximo80 caracteres), descripción opcional,
selección múltiple sin duplicados, vacío útil y retorno de foco tras acciones.

Verificación final de esta revisión: **40/40 grupos PASS**, Chromium154.0.8037.57
y WebKit27.2 Linux, con contextos cerrados, cero errores y cero peticiones
externas. Incluye las seis pantallas en siete tamaños por motor, burbuja fija
sin desplazamiento del contenido, separación del dock, resize, texto al200% y
tema oscuro, aviso dentro del player corto, ciclo CRUD de playlist, orden,
selección sin duplicados, cancelaciones, estado vacío, Biblioteca/Favoritos
conservados y cola iniciada independiente de ediciones posteriores. El wrapper
inline abre Playlists y responde a sus acciones en ambos motores. Tipos de
muestra y lint de producto PASS. Baseline conservado: aviso estático desplazaba
el contenido215,56px en390×664; `.local/design-playlists/baseline-RED.json`.
Informe final `.local/design-playlists/report.json`; el34/34 inicial de esta
revisión queda aparte y no se suma. Safari físico e integración real pendientes;
ODD/Engram permanecen en HOLD y no se genera ni publica un build normal.

## Biblioteca por colecciones y Favoritos automática · referencia del propietario

La nueva captura del propietario establece la jerarquía: encabezado compacto,
filtros Playlists/Álbumes/Artistas, orden y selector de vista, cuadrícula con
carátulas cuadradas y descripción breve. Se conserva la identidad de Pulso y
sus portadas originales; no se copian imágenes ni datos privados de la captura.

| Antes | Después | Motivo |
| --- | --- | --- |
| Biblioteca abría una lista de canciones y cinco filtros | Cuadrícula mixta de colecciones y tres filtros que se pueden desactivar | Navegar por playlists, álbumes y artistas como en la referencia. |
| Favoritos era una categoría con estado separado | Playlist automática fijada al principio, con corazón blanco en la carátula | Reunir las canciones añadidas en un lugar visible y reconocible. |
| Cabecera con introducción larga y contador de canciones | Título, buscar/crear, filtros, orden y vista lista/cuadrícula | Dar prioridad a las colecciones en la pantalla del teléfono. |
| Corazón y alta general producían conjuntos distintos | Un conjunto de canciones añadidas alimenta Favoritos | El alta desde canción, álbum o playlist se refleja en la playlist automática. |

Favoritos está siempre disponible, incluso vacía. No se puede eliminar ni
renombrar. Contiene las canciones añadidas explícitamente: escuchar por sí solo
no añade. Altas desde un álbum, el corazón o la selección de una playlist propia
actualizan esa colección sin duplicados. Quitar una canción de una playlist
propia no la retira de Favoritos. Quitarla de Favoritos la retira de la biblioteca
general de muestra, conservando las demás playlists y sin borrar copias.

La pantalla predeterminada mezcla colecciones. Pulsar un filtro limita el tipo;
pulsarlo otra vez recupera la mezcla, sin añadir un botón «Todas». Los filtros
de Biblioteca no incluyen Canciones ni Favoritos. Buscar mantiene sus categorías
musicales porque las canciones siguen siendo resultados de búsqueda. La ordenación
por nombre conserva Favoritos fijada, la búsqueda local filtra colecciones y la
vista alternativa en lista ofrece las mismas acciones. Cuadrícula de tres
columnas en móvil desde360px, dos en ventanas más estrechas; texto adaptable.

Esta decisión de diseño se aplica a datos ficticios en RAM. No migra ni modifica
las estructuras de Biblioteca/Favoritos del producto funcional concurrente.
La integración y Safari físico siguen pendientes; ODD/Engram continúan en HOLD.

Validación final de esta revisión: **44/44 grupos PASS** en Chromium154.0.8037.57
y WebKit27.2 Linux; sin errores de página ni solicitudes externas y contextos
cerrados. Conserva la matriz de siete tamaños, reproducción, errores flotantes,
playlists propias y teclado; añade filtros exactos de Biblioteca, Favoritos
fijada/con corazón/protegida, sincronización desde álbum/corazón/selector,
inexistencia de duplicados, coherencia de los datos iniciales, conservación de
otras playlists y vacío automático. También búsqueda de colecciones, nombre,
vista en lista, oscuro y texto al200%. Tipos de muestra y lint de producto PASS.
Informe `.local/design-favorites/report.json`; no sumar el42/42 intermedio ni
el40/40 anterior. El primero no comprobaba coherencia de todos los datos de
muestra: ahora las playlists iniciales contienen sólo canciones ya añadidas.
No se han cambiado main, el player, la burbuja ni ODD durante esta revisión.

## Reproductor, estado de alta y letra · segunda referencia del propietario

El propietario propone una composición familiar: portada grande, contexto,
título e intérprete, indicador de canción añadida, posición, transporte y una
tarjeta de letra que se expande. Se interpreta el gancho verde como **añadida a
Favoritos**, no como disponibilidad de archivo ni descarga terminada.

| Antes | Después | Motivo |
| --- | --- | --- |
| Corazón dentro del transporte | Botón + / gancho verde junto a título/intérprete | Expresar el alta como estado, con aria-pressed y etiqueta explícita. |
| Player de tres controles y portada pequeña | Portada mayor, jerarquía musical y controles completos | Acercarse a la composición pedida sin copiar activos o marca. |
| Letra ausente en la muestra navegable | Tarjeta con dos líneas, vista completa y estados sin tiempos/ausente | Revisar el apartado y su retorno sin depender de proveedor externo. |
| Texto y navegación sin probar sobre audio activo | Misma instancia de audio durante player/letra/cola | Evitar reinicios al inspeccionar contenido secundario. |

NowPlaying.tsx compone la presentación dentro del PlayerSurface existente,
sin cambiar ese componente compartido ni main. SaveTrackButton.tsx se reutiliza
en el player y las filas: símbolo + al no estar añadida, círculo verde con
gancho al estarlo. El estado deriva del mismo conjunto que alimenta Favoritos.
Los controles mantienen objetivos de44px y proporción circular. Aleatorio
afecta al siguiente salto; repetición controla el loop del tono de prueba,
sin prometer modos nuevos del motor real. Cola tiene una vista accesible.

La letra de `lyrics.ts` es escritura original de esta muestra y **no corresponde
a la grabación ni a los artistas de las capturas**. Se señalan sus tiempos como
demostración: el audio sigue siendo el tono instrumental propio de8s. Primera
pista con marcas0/2/4/6s; segunda texto plano; las demás sin letra. No inventar
tiempos para texto plano. Pulsar una línea con tiempo mueve posición sin iniciar
Play por sí solo. El resaltado no roba foco ni se anuncia en vivo por cada tick.
La ausencia de letra no bloquea música ni controles. No se conectan proveedores,
traducciones ni red por abrir el apartado.

Mostrar letra y Cola preservan audio y contexto, mantienen el cierre global
siempre alcanzable y devuelven foco al control que abrió la vista, con su scroll.
Al cerrar y abrir el player vuelve la vista musical. La altura sigue el viewport
visible; en horizontal corto la portada se reduce conservando su cuadrado y la
superficie desplaza su contenido. `player-lyrics-preview.html` presenta el nuevo
player ya abierto y pausado; `app-demo.html` conserva Inicio como entrada.

La portada reserva espacio para metadatos y transporte. Cuando el viewport no
supera700px de alto se omite la línea de letra duplicada bajo la portada; la
tarjeta y la vista de letra siguen disponibles. Así las barras de Safari no
obligan a comprimir los botones. El cierre conserva su posición también en
la vista ampliada de letra y en ventanas cortas.

Validación final de este incremento: **52/52 grupos PASS** en Chromium154.0.8037.57
y WebKit27.2 Linux; sin errores de página ni solicitudes externas, contextos
cerrados. Amplía la matriz anterior con letra en siete tamaños por motor,
cierre global/foco al volver, gancho/+ y pertenencia real a Favoritos de muestra,
seek desde línea sin autoplay, letra plana sin tiempos inventados, ausencia sin
bloqueo musical, anterior/aleatorio/loop/cola sobre un mismo audio y preview
abierto pausado. Tipos de muestra y lint del producto PASS. Medición focal
Chromium390×664: portada232×232, transporte entre550,78 y622,78px y cierre44×44.
Informe `.local/design-player-lyrics/report.json`; los runs intermedios50/50 y
52/52 antes del ajuste compacto se conservan aparte y no se suman.

Los archivos compartidos main/index/MiniPlayer/PlayerSurface/ErrorBubble y ODD
P0/D1 conservan su SHA de inicio. No build normal, publicación ni nueva conexión
real. ODD/Engram siguen en HOLD. Safari físico/teclado/safe areas/VoiceOver y
producto integrado siguen pendientes; los motores Linux no los sustituyen.

## Afinado del indicador de canción añadida · captura del propietario

La captura posterior muestra que el círculo verde de44px domina las filas.
Se conserva el significado del gancho y se ajusta su peso visual a Pulso.

| Antes | Después | Motivo |
| --- | --- | --- |
| Toda el área táctil44×44 pintada de verde | Círculo visible24×24 dentro de un botón transparente44×44 | Reducir protagonismo sin hacer difícil pulsarlo. |
| Símbolo24px con trazo2,5 | Símbolo16px con trazo2,2 | Guardar proporción con el texto de las filas. |
| Verde ajeno a la paleta | Azul del token de acento sobre su superficie suave | Integrar el estado con Bruma y su versión oscura. |

El símbolo + sin añadir usa contorno neutro. El gancho conserva etiqueta y
aria-pressed; el color no es la única señal. La misma presentación se aplica
en filas y player. Carátula de Favoritos y su comportamiento automático siguen
vigentes. Se regeneran los HTML desde las fuentes, sin tocar main ni datos reales.

Verificación focal en Chromium154.0.8037.57 y WebKit27.2:10 combinaciones de
tema claro/oscuro,390px,320px con texto al200% y player; medidas24/16/44,
colores derivados del acento, alternancia añadido/no añadido y retorno de foco
PASS. Sin errores de página ni solicitudes externas; contextos cerrados. Tipos
de muestra y lint PASS. Informe `.local/design-saved-style/report.json`.
La suite52 anterior no se repite por este ajuste de presentación y no se
atribuye al nuevo SHA. Safari físico sigue pendiente; ODD/Engram en HOLD.

## Revisión de escritorio · referencia Spotify web

El propietario solicita revisar también la vista web y permite tomar Spotify
como referencia. Se inspecciona [Spotify web](https://open.spotify.com/) el
2026-11-09 en pestaña propia de incógnito, sin login ni reproducción: cabecera
con búsqueda, biblioteca lateral, contenido central en tarjetas y región inferior
de reproducción. Esa inspección pública no acredita estados de cuenta autenticada.
Se adapta su distribución a Pulso, con paleta/activos propios y sin catálogo,
recomendaciones, Premium ni otras funciones de Spotify.

| Antes | Después | Motivo |
| --- | --- | --- |
| Lateral que desaparecía al desplazar la página | Lateral sticky con alto reservado sobre la barra y scroll propio | Mantener navegación y playlists disponibles en escritorio. |
| Mini móvil prolongado bajo el centro | Barra de ancho completo con información izquierda, controles al centro y utilidades a la derecha | Usar el ancho de una pantalla de ordenador. |
| Búsqueda sólo en su apartado | Entrada superior persistente que abre resultados al confirmar | Buscar desde cualquier pantalla sin reproducir por escribir. |
| Hero y tarjetas demasiado amplios | Cabecera compacta y rejillas auto-fill con mínimo150px | Mejor densidad y más contenido visible en1024–1920px. |
| Player ampliado de una columna | Portada/contexto a la izquierda y metadatos/transporte/letra a la derecha | Dar a cada área espacio útil sin estirar una maqueta de teléfono. |

DesktopPlayer.tsx es presentación controlada sobre el mismo HTMLAudioElement
de muestra; no crea audio, workers, sesiones ni almacenamiento. Seek, volumen,
mute/restauración, anterior/siguiente, aleatorio y repetición actúan sobre ese
tono. Letra y Cola abren directamente sus vistas y devuelven foco a su botón al
cerrar. El estado de Favoritos sigue siendo único y su indicador mantiene24/16/44.
El mini de móvil y la barra de escritorio se alternan por CSS, sin desmontar audio.

ResizeObserver mide la barra para reservar espacio en el lateral y en los avisos
flotantes. En ventanas de480px de alto o menos vuelve al flujo para no tapar
contenido. Al cerrar un player abierto antes de cambiar de ancho, se elige un
opener visible y se evita enfocar el mini oculto. Desde1024px se activa escritorio;
debajo conserva el comportamiento móvil/tablet. Los dos grupos del player ampliado
fluyen verticalmente en móvil y en paralelo en escritorio, sin huecos repartidos
artificialmente entre los controles.

`desktop-preview.html` contiene el documento real en un iframe de1366×860,
reducido con una transformación para caber en el hilo. Su CSS interior usa
1366px, no una vista móvil ensanchada; `app-demo.html` usa el viewport real.
El loopback usado para la revisión compartida sólo sirvió esta muestra. Las
pestañas propias de Spotify y Pulso se cierran, sin tocar la pestaña de cuenta real.

Resultado final: **32/32 grupos de escritorio PASS** en Chromium154.0.8037.57 y
WebKit27.2 (contexto de escritorio, sin descriptor móvil). Cinco tamaños:
1024×768,1280×800,1366×768,1440×900,1920×1080, cada uno en claro/oscuro y con
recorrido por Inicio/Biblioteca/Favoritos/álbum/artista/player. Incluye búsqueda,
transporte, volumen y recuperación del volumen previo, seek, letra/cola directas,
audio único, texto200%, ventana corta, tablet/móvil tras resize, foco al cambiar
de breakpoint y preview con viewport real1366. Cero errores/externos, cleanuptrue.
Informe `.local/design-desktop/report.json`. **52/52 regresiones compartidas
PASS** contra el mismo SHA, en `.local/design-desktop/shared-report.json`.
No sumar ambos recibos como casos únicos ni como aceptación del producto real.
Tipos de muestra/lint PASS. Revisión compartida sobre loopback propio confirmada.

Los recibos20/32 y22/32 iniciales se conservan. Se corrigieron aserciones del
arnés: el ancho se compara con el rectángulo de layout de la raíz, porque
scrollbar-gutter puede reservar15px incluso antes de existir overflow; volumen
con tolerancia numérica; gesto real en el preview transformado calculado desde
rectángulo local/escala, ya que el locator Chromium devolvía coordenadas sin la
transformación del iframe padre. No se sustituyeron acciones por clicksDOM.
La primera regresión general terminó conSIGTERM143 sin recibo válido y no cuenta
comoPASS; las posteriores completaron52. Ajustes visuales reales: búsqueda con
botón sin partir, espacio conservado al retirar el salto del hero y agrupación
de columnas del player sin distribución vertical artificial de huecos.

Sin build normal, publicación, nuevas dependencias ni escrituras de datos reales.
ODD/Engram siguen en HOLD para este hilo; sólo evidencia y apéndice privados.
La aceptación Safari físico/VoiceOver/producto integrado continúa pendiente.

## Desarrollo del recorrido móvil · referencias del propietario

Se continúa con prioridad al teléfono, usando las capturas de Spotify facilitadas
por el propietario como referencia de jerarquía musical y navegación. Se mantiene
la identidad propia de Pulso y los contratos aceptados: tres destinos, Favoritos
como playlist automática, mini sin portada, indicador azul discreto y errores
flotantes. No se añaden Premium, recomendaciones ni funciones ajenas a Pulso.

| Antes | Después | Motivo |
| --- | --- | --- |
| Inicio centrado en una cabecera de álbum grande | Cuatro accesos rápidos y bloque de escucha más compacto | Llegar antes a Favoritos, playlists y música guardada en teléfono. |
| Buscar empezaba mostrando dos rejillas largas | Barra de una fila y entradas a álbumes/artistas/playlists/Favoritos | Dar puntos de entrada claros sin una consulta previa. |
| Mini y navegación como bandas rectangulares unidas | Mini con margen/radio propio sobre navegación más ligera | Diferenciar la pista actual de los destinos principales. |
| Sólo alta/baja directa por el símbolo | Botón de opciones y panel inferior con acciones de canción | Añadir a una playlist sin abandonar la búsqueda o Inicio. |

Los accesos rápidos abren las colecciones existentes sin reproducir. Portadas
de56px cuadradas, botones de al menos64px de alto y nombres que envuelven. Volver
restaura el foco al acceso que abrió el detalle. La exploración sin consulta
presenta sólo datos ficticios del catálogo local; no algoritmos ni servicios.
La búsqueda de texto mantiene confirmación explícita y no inicia audio.

TrackActionsSheet.tsx usa dialog nativo y estado controlado en la muestra.
Abrir opciones no añade ni reproduce. Reproducir ahora requiere ese botón;
añadir a una playlist usa el mismo update de organización y alimenta Favoritos
sin duplicados. Una canción ya presente se indica y su acción está desactivada.
Si no hay playlists propias se explica dónde crear una. Cerrar/Escape conserva
consulta y scroll y restaura foco; el fondo queda modal y con scroll bloqueado.
La altura sigue visualViewport, con cierre sticky y área segura inferior.
Un encabezado extraordinariamente largo se limita visualmente a tres líneas;
su nombre accesible conserva el texto y el detalle de la canción lo muestra completo.

El panel se sirve en la misma prueba React; no importa main/SDK/almacenamiento
real ni crea otro audio. Los nuevos controles también sirven con teclado. En
escritorio se conserva la distribución anterior; la muestra responsive y las
plantillas de presentación se regeneran desde una sola entrada. mobile-preview
limita el iframe a390px para visualizar el diseño, no para acreditar iPhone real.

Verificación final de este incremento: **64/64 grupos compartidos PASS** en
Chromium154.0.8037.57/WebKit27.2 con perfil de dimensiones/touch iPhone13 y
matriz320–1280px. Añade accesos/foco y portada cuadrada, exploración por categorías
sin autoplay, panel nativo/duplicados/altas/Escape/foco/scroll, título largo200%
en320×480, gesto explícito de reproducción y preview390. **32/32 regresiones de
escritorio PASS** contra el mismo SHA. Cero errores/externos y cleanuptrue en ambos;
tipos de muestra y lint PASS. Informes `.local/design-mobile-polish/shared-report.json`
y `desktop-report.json`, sin sumar ambos como aceptación física ni producto completo.
El primer50/52 queda conservado: el caso anterior intentaba abrir un álbum del
catálogo ahora oculto en móvil; se actualiza al recorrido visible Explora→Álbumes,
sin forzar clicks en contenido oculto. Capturas de viewport WebKit inspeccionadas;
lectura focal confirma navegación a Buscar con scrollY0 y sin salto tras dos frames.
Sin tocar fuentes funcionales, datos, build normal o publicación; ODD/Engram HOLD.
Safari físico, teclado/safe areas/gestos/VoiceOver reales y producto integrado pendientes.


## Buscar móvil en la app funcional · 2026-11-10

La referencia IMG_6734 se aplica al componente real de búsqueda: lista mixta en flujo, tipo e intérprete por fila, edición compacta con Borrar/Cancelar y fuentes secundarias debajo. Contrato, tabla Before/After/Why y validación actual en [SEARCH-MOBILE.md](SEARCH-MOBILE.md). No cambia paleta, motor ni catálogo. Portadas concurrentes preservadas; publicación y Safari físico se registran por separado.


## Detalle de playlist en producto · 2026-11-10

IMG_6736 se aplica al detalle real: carátula local o mosaico, corazón en Favoritos, nombre/cantidad/duración, Play/Pausa circular y filas compactas con menú. Formularios y metadatos secundarios pasan a Opciones, sin alterar contratos de organización. Componentes, decisiones y evidencia final en [PLAYLISTS.md](PLAYLISTS.md). 34/34grupos web locales, con modo WebKit persistente de prueba separado para PNG en IDB; no aceptación física ni publicación desde UI.
