# Añadir canciones a la cola

Entrega de prueba `34debfbc6be29b1e`, verificada en Chromium local y en el acceso privado existente. No completa P0-W ni acredita iPhone.

«Añadir a continuación» y «Añadir al final» conservan la canción que está sonando, su posición y los modos del reproductor. Cada gesto captura la selección completa, incluidas las páginas que no están visibles. Las ocurrencias repetidas conservan identidades distintas. Las adiciones a continuación aceptadas sucesivamente respetan su orden; si cambia la canción actual durante la preparación, el destino se resuelve al confirmar.

Preparar otra cola sigue siendo una acción distinta. Cancela las adiciones pendientes y espera su cierre antes de sustituir la cola. «Vaciar cola» libera sus fuentes sin borrar canciones, archivos, favoritos ni playlists. Una cola inicialmente vacía recibe entradas pausadas, sin seleccionar ni cargar un medio hasta pulsar Reproducir. La reapertura conserva esa selección vacía y los modos, sin autoplay.

El coordinador admite hasta 32 intenciones pendientes y 1000 ocurrencias en la cola completa, contando las reservadas. Comparte el presupuesto del registro de fuentes con reemplazo y restauración: Blob de hasta 8 MiB por archivo y 24 MiB acumulados entre asignaciones vivas, retenidas y reservadas. No descarga automáticamente el medio anterior para eludir este límite. El transporte con Service Worker conserva los snapshots físicos de las generaciones autorizadas; una ficha actualizada no cambia los bytes de una fuente preparada.

Cancelar o vencer el plazo lógico no demuestra que el lector o el transporte hayan terminado. La siguiente preparación espera el settlement de su propia operación; si falta un acuse observable, no se libera capacidad mediante un temporizador. Una inserción ya confirmada conserva su resultado aunque falle guardar el snapshot. La persistencia lee la cola más reciente al ejecutar su escritura y revalida el ámbito antes de abrir la transacción y escribir.

Las acciones de organización, importación y preparación ajenas quedan bloqueadas mientras se prepara la adición. Las guardas de los callbacks antiguos no reviven al recuperar el permiso. Pausa, reproducción, posición, avance y navegación siguen disponibles. El reproductor y el elemento Audio son los existentes.

La evidencia se registra por fase: Player/planner y coordinador unitarios, composición de fuentes y transporte, revisión independiente e integración de navegador. Los dobles de unidad y las barreras TESTONLY se identifican en cada recibo; no acreditan iPhone, heap físico ni offline privado. Telegram y los proveedores externos continúan desactivados.

La selección final R110 pasó 18/18 grupos sobre las 109 fuentes congeladas. La revisión R109 y la del arreglo de integridad R111 son favorables en sus respectivos alcances; sus condiciones de navegador se cumplen con ese recibo final. Las 63 pruebas unitarias seleccionadas actuales pasan. El build final supera assets IDB/OPFS, teclado, licencias y actualización normal desde `51c9bdf061455432`. El smoke de producción conserva Audio y la cola al insertar y reabre pausado, tanto con SW local como con Blob acotado en el acceso privado.

R110 detectó y conservó un RED real: el pin SW validaba el manifiesto pero la preparación no comprobaba sus bytes. El transporte ahora verifica SHA antes de emitir pins, conserva el lock compartido hasta su respuesta y rechaza íntegramente la selección dañada. Blob mantiene una sola pasada de composición y hash. Una observación menor permanece: llamadas directas con snapshots equivalentes y propiedades en distinto orden pueden repetir SHA; no permiten saltarse la comprobación. Evidencia resumida: [evidence-queue-insertion-web.json](evidence-queue-insertion-web.json).

Pruebas focales de lógica:

```sh
node --import tsx --test tests/unit/queue-insertion.test.ts tests/unit/queue-insertion-controller.test.ts tests/unit/player.test.ts tests/unit/queue-restore.test.ts tests/unit/queue-source-composition.test.ts
```

El propietario pidió terminar este incremento y hacer una pausa. No se iniciará otro incremento al cerrarlo. P0-W permanece incompleto e iPhone está aplazado.
