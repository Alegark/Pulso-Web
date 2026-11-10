# Detalle de playlist en la app funcional

Referencia del propietario: IMG_6736, enviada el 10 de noviembre de 2026.
Se conserva la identidad Bruma y su tema oscuro, con acento azul.

| Before | After | Why |
| --- | --- | --- |
| Formularios, filtros y acciones antes de las canciones | Carátula, nombre, cantidad y duración; opciones secundarias plegadas | Recuperar la jerarquía musical de la captura. |
| Cada fila muestra metadatos y botones de gestión | Carátula de 48 px, título, intérprete y «⋯» de 44 px | Permitir recorrer la playlist sin ruido visual. |
| Carátula de nota fija en cada playlist | Carátula local o mosaico de las primeras cuatro pistas distintas | Usar la música real de esa lista. |
| Favoritos como otro marcador genérico | Corazón blanco sobre la carátula azul | Mantener la referencia ya solicitada para Favoritos. |
| Acción principal de preparación entre botones largos | Reproducción y pausa en un control circular de 64 px | Dar prioridad al recorrido de escucha. |

## Composición y datos

`CollectionHeader` y `CollectionCover` son componentes de presentación. El
producto proporciona título, duración, cantidad, pistas y acciones. La carátula
usa `CatalogArtwork` para leer portadas locales: abrir la playlist no lanza una
búsqueda externa por cada canción. Si no hay imagen, queda un marcador propio.
Favoritos conserva siempre el corazón. No hay fotos ni nombres inventados.

La duración se calcula con los tiempos disponibles de la selección. Si falta un
tiempo válido, no se anuncia una duración completa. Se distinguen segundos,
minutos y horas. No se inventan descripción, autor, perfil, publicidad, guardados
ni estado de descarga para copiar elementos que aparecen en la captura.

Las opciones de playlist conservan filtros, preparación, añadir selección a la
cola, renombrar y eliminar. El menú de cada canción conserva metadatos, favorito,
destino de playlist, retirada y orden. Se expanden en flujo, manteniendo los
controladores y sus confirmaciones existentes. La paginación aparece cuando hay
más de una página. Una playlist vacía ofrece Buscar canciones.

## Reproducción y conservación

El botón principal usa el motor existente. Cuando su cola coincide con la
selección, reproduce o pausa sin sustituirla. Para otra selección, prepara la
cola con las verificaciones existentes y sólo solicita Play si siguen vigentes
la vista, el control y la selección, y la cola publicada coincide exactamente.
Una interacción nueva o navegación durante la preparación retira esa intención.
Un rechazo del navegador conserva los controles existentes para un gesto nuevo.
El control de aleatorio se habilita cuando esta selección corresponde a la cola
activa; no modifica otra lista que se esté escuchando.

Reordenar o quitar canciones modifica la playlist; no reescribe la cola ya
copiada ni borra sus archivos. El favorito, pertenecer a Biblioteca y pertenecer
a una playlist mantienen sus contratos actuales.

## Verificación

Las comprobaciones del producto se ejecutan contra una copia congelada, con
IndexedDB, portadas PNG y WAV propios, controles y audio del producto. No se usa
una cuenta ni música real. Los casos de playlist son opcionales mediante
`PLAYLIST_DETAIL=1` en `tests/integration/check-interface-main.mjs` y están en
`playlist-detail-cases.mjs`. El fixture original sigue disponible sin esa opción.

En este entorno, WebKit rechaza la escritura de Blob de portada en un contexto
efímero de pruebas. Se conserva ese fallo. La matriz de playlist usa allí un
perfil persistente nuevo y exclusivamente sintético; un probe independiente
confirmó que la misma portada se guarda en ese modo. Esto no utiliza la sesión
real ni acredita Safari privado. Las pruebas generales continúan en su contexto
aislado habitual. Los dos modos quedan identificados en el recibo.

La evidencia está en `.local/design-playlist-detail/`. La validación de Safari
físico, teclado, áreas seguras y VoiceOver se registra por separado; las pruebas
en WebKit de Linux no acreditan esos entornos. La entrega publicada se coordina
con el responsable funcional.

Resultado final local: 34/34 grupos PASS (22 generales y 12 de playlist) en
Chromium 154 y WebKit 27.2, con los modos de contexto indicados. Las 189 fuentes
congeladas coinciden antes/después y con el árbol al cerrar; no se observaron
errores de página ni salidas externas. Limpieza completa y lint PASS. Se comprobó
Play/Pausa/reanudar en el mismo Audio, retirada de una intención de Play mediante
interrupción sintética, portada decodificada, reordenar/quitar sin reescribir la
cola copiada, añadir a otra playlist, renombrar y recargar, Favoritos, vacío y
geometría 320/390/844/1366 con fuente al 200 %. No equivale a 34 casos únicos de
aceptación ni a pruebas físicas.
