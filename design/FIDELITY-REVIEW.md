# Fidelidad entre la muestra de diseño y la app

Revisión solicitada por el propietario el 10 de noviembre de 2026. La referencia
visual sigue siendo `design/prototypes/app-demo.html`, generado por
`design/app/screens.css` y sus componentes. Esta revisión no cambia la dirección
Bruma, el acento azul ni la estructura musical acordada con las capturas del
propietario.

## Hallazgo

La integración funcional conserva los colores, pero reproduce sólo parte de la
composición. Las capturas de su revisión 2 muestran tarjetas con contenedor
blanco y relleno, una biblioteca de dos columnas, una marca azul pequeña, una
navegación de botones y una cabecera «Volver» en el reproductor. La muestra utiliza
carátulas sin ese contenedor, una biblioteca más densa, marca oscura con punto de
acento, navegación ligera y cierre mediante chevrón. No basta que las acciones
funcionen para considerar validada la fidelidad visual.

| Before | After | Why |
| --- | --- | --- |
| Carátulas dentro de botones blancos con relleno | Carátula cuadrada y texto sobre el fondo de la página | Recuperar el protagonismo de la colección y la composición de la muestra. |
| Dos tarjetas grandes en Biblioteca a 390 px | Tres columnas cuando el ancho y el tamaño del texto lo permiten | Seguir la referencia del propietario; reducir columnas con texto ampliado. |
| Marca azul pequeña | Marca en color de texto y punto azul | Conservar la identidad que ya tenía el boceto. |
| Destino actual dentro de un botón relleno | Icono, peso y acento; foco de teclado independiente | Recuperar la navegación ligera del teléfono. |
| Botón «Volver» a la derecha del player | Chevrón de 44 px a la izquierda y contexto centrado | Seguir el reproductor trabajado aquí sin cambiar cierre, foco ni audio. |
| Player blanco y letra pequeña en la vista previa | Fondo Bruma y tipografía expresiva en la tarjeta de letra | Hacer que reproductor y letra pertenezcan a la misma interfaz. |
| Buscador puede separar input y acción en móvil | Barra en una sola fila y texto de resultados más compacto | Mantener la jerarquía de Buscar de la muestra. |

## Corrección preparada

`src/ui/design-fidelity.css` contiene una capa de presentación para los
componentes funcionales. La primera comprobación se hizo sobre una copia aislada
de la revisión 2. Después, el propietario confirmó que el problema está en la app
funcional: se añadió su importación al `src/main.tsx` actual, después de
`responsive-shell.css`, conservando los cambios funcionales posteriores. Ya forma
parte del código del producto. Su incorporación al enlace publicado se registra
por separado y no se deduce de una prueba local.

Se conservan los controladores, las acciones y las diferencias reales entre
Biblioteca, favorito, playlist y copia local. No se importan el catálogo, el tono
ni las letras ficticias de la muestra. Tampoco se simulan carátulas reales.

## Diferencias que aún necesitan composición

- Inicio funcional usa marcadores de nota musical; la muestra tiene carátulas.
  Conectar carátulas reales debe conservar sus estados de carga y ausencia.
- La biblioteca funcional aún abre por tipos y su detalle expone formularios y
  acciones largos. La muestra tiene cuadrícula mixta, búsqueda de colecciones y
  opciones secundarias. CSS no reemplaza ese recorrido.
- La tarjeta de continuar y la barra lateral de escritorio no tienen aún toda
  la composición del boceto. Deben adaptarse usando los callbacks reales.
- La semántica funcional de Favoritos no se cambia como efecto de una corrección
  visual. Su divergencia respecto de la muestra queda visible para la integración.

La corrección visual no equivale a integrar todos estos recorridos ni a validar
Safari físico. La evidencia local se guarda en `.local/design-fidelity/`. El
registro de este hilo continúa separado de ODD/Engram mientras siga la
coordinación vigente.

## Evidencia de esta revisión

La copia aislada pasa los 22 grupos de integración existentes en Chromium y
WebKit: geometría, texto ampliado, foco, navegación, selección, reproducción,
playlist y letra guardada. Los 181 archivos congelados coinciden antes y después;
no se observaron errores de página ni salidas de red no previstas. El lint del
árbol compartido también pasa. Esto acredita esa copia, no la integración actual
que sigue cambiando en paralelo.

Tras la aclaración del propietario, la nueva comprobación usa las fuentes
funcionales actuales, incluida la reparación posterior de búsqueda y tamaño de
audio. Pasan nuevamente 22/22 grupos Chromium/WebKit, sin errores de página ni
salidas externas observadas, con 182 fuentes idénticas antes/después y limpieza
completa. El lint también pasa. Esta evidencia se conserva en
`.local/design-fidelity/integrated/report.json`. Respecto de la última entrega
funcional, sólo se añade el CSS y su importación en main. Se ha comunicado el
conjunto preparado al responsable de la entrega; este hilo no publica la web.

`design/prototypes/fidelity-review.html` permite comparar capturas de Inicio,
Biblioteca y reproductor antes y después. Los cambios de controles y diseño se
ven sobre los mismos datos sintéticos, sin sustituirlos por un catálogo inventado.
