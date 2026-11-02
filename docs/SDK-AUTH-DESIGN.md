# T4 · Contrato de sesión y acceso temporal

Estado actual, 2026-11-02: el acceso temporal está integrado como slice separado de los candidatos persistentes históricos. Usa un worker con `MemoryStorage`, claves API recibidas del propietario, envío explícito de teléfono y pasos de código/2FA; no activa sesión por abrir la página. El cierre local y la revocación remota son resultados separados. Las pruebas locales no constituyen autenticación real ni aceptación de T4/P0. Contrato actualizado en `docs/TELEGRAM-SETUP.md`; evidencia en `docs/evidence-telegram-session-web.json`. Los apartados siguientes conservan el desarrollo histórico y sus límites originales.

El producto entregado no contiene cliente ni sesión Telegram. El preflight inicial solo comprobó imports/worker/WASM y un hash local. La investigación posterior está en `.local/evidence/sdk-auth-design.json`; receipts públicos y SHA-256 en `.local/research-sdk-auth/`. Investigación de fuentes no equivale a autenticación, búsqueda o lectura de bytes remotos.

## Procedencia observada y distribución pendiente

Paquetes instalados: web/core0.32.7, wasm0.32.6. El gitHead npm de WASM es c43258260e8ceddb0ad37720b043f6891b837e27; el tag anotado v0.32.6 apunta a otro commit, conservando los mismos dos blobs y32fuenteslib del árbol examinado. Los bytes instalados calculan Gitblob919b26297a7961f158fb3b10ff194b46a8ce2779 (normal) y99e536c95924d67d6d1988b8e519208b044d9368 (SIMD), iguales a la metadata del árbol oficial. No es una reconstrucción C→WASM ni validación de firma del paquete. La attestation pública decodificada se conserva como evidencia declarativa, sin presentar su firma/transparencia como verificadas.

Fuentes AES modificadas y COPYING.lesser están en el mismo árbol oficial: https://github.com/mtcute/mtcute/tree/c43258260e8ceddb0ad37720b043f6891b837e27/packages/wasm/lib/crypto . README identifica tgcrypto LGPL3, libdeflate modificado MIT y fuentes SHA; no basta la licencia MIT superior. Verificar avisos originales completos, fuente/receta correspondiente y modo concreto de entrega antes de añadirSDK/WASM al producto. El Makefile requiere hash/ pero la receta Docker examinada no lo copia; toolchain no fijado completamente. La falta de build bitidéntico es una limitación de evidencia, no un nuevo requisito legal inventado por este documento.

El código JS web0.32.7 tiene gitHead f498312b616b88a6c4f3c6cc3cc1c23dfa91db80, diferente al WASM. No atribuir identidad del paquete por un tag distinto ni por el commit del SPEC. La guarda de licencias actual sigue bloqueando paquetes no revisados; no se amplía por haber leído estas fuentes.

## Incremento offline implementable

Protocolo cerrado v1 en src/telegram, parser runtime acotado y máquina de estados sin imports SDK ni cliente por defecto. Envelope correlaciona requestId/operationId/sessionSlot/namespace/account/generation/owner; un intento nuevo, también A→A, invalida al anterior antes de await. Worker y MessageChannel reales para probar el protocolo; driver sintético identificado exclusivamente en pruebas. No RPC genérico, session export, botToken o datos inesperados. Ready requiere una identidad confirmada por el adaptador interno futuro, nunca un accountId reclamado por UI o un evento connected.

Teléfono y challenge viven solo en la memoria del intento. Código/contraseña no forman parte de estado persistido, reply, error o diagnóstico. Límites de producto explícitos y parser sin coerciones/prototipos/extras; mensajes inválidos no se devuelven completos. No prometer borrado seguro de strings en el heap.

Sesión futura en DB exacta pulso-web:telegram:session:v1:<slotUUID>, con registro no secreto separado pulso-web:telegram:control:v1 y namespace propio por cuenta confirmada. No usar client.session ni enumerar/borrar bases del origen. Cuarentena/tombstone durable antes de eliminación; blocked/error conserva cleanup-pending y reintento explícito. Los ensayos solo usan bases sintéticas propias en un contexto aislado. No se prueba aún IdbStorage SDK como si fuera integración autorizada.

Cancelación lógica y generación no prueban aborto de una RPC ya procesada. Logout local y revocación remota son resultados separados; destroy/disconnect no eliminan por sí solos la DB de sesión. D10 sigue siendo decisión explícita sobre archivos, conservados operativamente sin borrado implícito ni herencia de la cuentaA aB. Nada cambia la DB/namespace local, sus assets/kept/readers, ticketsSW, cola, backup o motor.

## APIs verificadas por lectura y límites reales

sendCode/signIn/checkPassword admiten abortSignal en la distribución instalada; su resultado puede ser challenge o usuario y los errores se mapean a familias seguras. No ejecutar start/getMe/call al abrir offline: pueden conectar; un constructor no prueba login. La guía y firmas efectivas prevalecen sobre comentarios de tipos contradictorios. Los estados de conexión no equivalen a autenticación.

searchMessages no recibe AbortSignal en su helper; una búsqueda futura exige llamada raw acotada o reconocer el límite, sin fingir aborto por invalidar callbacks. downloadAsIterable tiene offset/limit y reintentos que requieren verificar semántica real antes de pasar un rango no cero; no asumir que limitBytes significa longitud relativa. QR, flujos unsupported/pago/email y expiración tienen aceptación propia; no declarar W02 completo con solo teléfono/2FA.

Los cinco hosts WSS del transporte instalado son una propuesta futura revisable, no una autorización: pluto/venus/aurora/vesta/flora.web.telegram.org/apiws. CSP actual permanece sin esos endpoints ni excepciones WASM. Si posteriormente se necesita wasm-unsafe-eval, verificar el mínimo en la respuesta del worker, manteniendo evalJS bloqueado; no habilitar wildcard/unsafe-eval/proxy o CDN por inferencia.

## Intervención necesaria después del incremento revisable

D05: identidad API de la app del responsable y condiciones revisadas; una configuración usada por JavaScript es inspeccionable, distinta de las claves/sesión del usuario. No copiar clientes ajenos ni pedir secretos en chat. La autenticación futura se hace por el propietario en UI privada preparada, con consentimiento explícito de conexión/cuenta/persistencia y una única fuente/audio autorizados. Número/código/2FA no pasan por el chat, IA ni Engram. Ninguno se solicita para el incremento offline.

Aceptación T4 remota y T5/iPhone son independientes y siguen pendientes. La siguiente investigación prepara el inventario/paquete de fuentes y avisos; no se considera gate cerrado mientras falten sus verificaciones concretas.

## Avance offline y distribución: revisión del 31 de octubre de 2026

El contrato ya está implementado en `auth-protocol.ts`, `auth-state.ts` y `auth-scope-store.ts`, fuera de las entradas del producto. El informe `.local/evidence/auth-offline.json` registra 26 pruebas unitarias y nueve grupos Chromium con Worker, MessageChannel e IndexedDB reales. El driver de autenticación es explícitamente sintético: esos resultados no demuestran autenticación, revocación remota ni comportamiento de IdbStorage del SDK. La revisión independiente r5 está en curso; no se incorpora todavía a la aplicación entregada.

La investigación de distribución r4 conserva 117 archivos seleccionados en `.local/research-sdk-distribution/`, con manifiesto de URLs/commits/hashes y ZIP releído íntegramente. Es contexto de investigación, no una entrega completa de fuentes del producto combinado. Su informe es `.local/evidence/sdk-distribution-readiness.json`.

La receta upstream usa concretamente Alpine **3.18.4**, instala clang16/lld y omite copiar `hash/`. Además, `make` sin `all` selecciona el primer target: la reconstrucción candidata debe preparar el directorio hermano `src` y solicitar ambos targets mediante `make all`. No se ha ejecutado esa reconstrucción en r4. La fuente primaria independiente EncryptionLibrary sigue sin recuperarse (404); no se inventan versión, autoría ni permiso. El inventario futuro también debe contemplar `long` Apache-2.0 y su WASM aritmético embebido.

Se asigna un experimento separado de reconstrucción local de ambos targets, con toolchain aislada del proyecto, ABI/vectores y comparación de hashes. Todavía no tiene resultado. No utiliza Docker ni modifica herramientas globales. Las acciones DIST-01–07 del informe separan contrato offline, avisos, reconstrucción, recombinación, inventario efectivo y provenance. Una coincidencia de Git blobs o un vector correcto no cierra por sí solo la revisión de distribución ni D03/D05. La guarda de paquetes, CSP y entrega privada permanecen sin cambios.

### Resultado de la revisión independiente r5

`.local/evidence/auth-offline-review-r5.json` reproduce dos P2 y dos P3 en Chromium con IndexedDB real: un fallo al persistir el tombstone omite cerrar el driver; expirar dentro del guard IDB provoca un segundo aborto con excepción no capturada; los errores de almacenamiento pierden su clasificación segura; y un borrado bloqueado puede terminar después sin actualizar el registro durable. R6 corrige estos casos con regresiones focales; todavía no tiene resultado. El contrato permanece fuera del producto.

`deleteDatabase()` no permite cancelar la solicitud una vez enviada. `blocked` significa pendiente y puede terminar al cerrarse la conexión que bloquea, sin reintento explícito. Un tombstone conserva la prohibición de reutilizar el slot, pero no demuestra por sí solo que ya se borró. Se debe observar o reconciliar el resultado final antes de anunciarlo.

La prueba r3 denominada crash solo reabre el store con tombstone persistido; no demuestra caída y recuperación de un worker autenticado. Su prueba de cierre termina expresamente el worker; no demuestra detectar la desaparición del extremo remoto del puerto. La expiración es explícita mediante `expire()`, sin temporizador automático probado. Estas limitaciones se conservan aunque pasen los demás casos offline. El runner original registraba un conteo unitario fijo: el recibo de ejecución sí contenía 26/26, pero las evidencias futuras deben derivar el resultado de su ejecución, sin constantes que aparenten una suite nueva.

### Reconstrucción ejecutada r5 y defecto gzip

El experimento `.local/evidence/wasm-rebuild-r5.json` ejecutó dos builds limpios, escalar y SIMD, con WASI-sdk 20.0 / LLVM 16.0.0 alojado solo en `.tools/wasm-rebuild/`. Usó `make all` y las 32 fuentes sin modificación. Los builds coinciden entre sí; difieren del binario npm también en código, no solo metadata. Coinciden las firmas de 19 funciones exportadas, cero imports y memoria mínima de 128 KiB. Esto demuestra repetibilidad local y compatibilidad en la superficie medida, sin equivalencia semántica exhaustiva ni reproducción de los bytes publicados.

La toolchain se obtuvo de la release oficial. Su archivo tiene SHA-256 local `7030139d495a19fbeccb9449150c2b1531e15d8fb74419872a719a7580aad0f9`; no había checksum primario publicado en los assets/cuerpo consultados y no se verificó una firma. No presentar ese hash calculado como aval del mantenedor.

Los seis módulos —dos originales y cuatro reconstruidos— pasan los vectores válidos SHA1/SHA256, AES-CTR NIST, AES-IGE contra oráculo independiente y compresión acotada. El runner termina **1**, porque conserva un fallo de rechazo de gzip inválido: C devuelve `LIBDEFLATE_BAD_DATA = +1`, mientras el wrapper solo rechaza valores negativos y devuelve bytes sin lanzar error. Es un defecto observado también en los originales; no una regresión de reconstrucción. `WebCryptoProvider.gunzip()` delega en ese wrapper y el lector de respuestas comprimidas lo usa, por lo que debe resolverse antes de integrar esa ruta. No se ha reproducido una respuesta Telegram real ni se afirma una vulnerabilidad alcanzable del producto actual, que no incluye SDK.

Se asignó un candidato aislado r6 para comprobar retornos, límites previos a la asignación y liberación de buffers, con entradas negativas y pruebas de worker propias. Resultado pendiente; no se modifica `node_modules` ni se sustituye la implementación en producción. La omisión upstream de CRC32 es explícita y no permite tratar esta función como verificación general de integridad. Receta completa, hashes, fallos iniciales y límites están en `.local/wasm-rebuild-r5/REPORT.txt`; recombinación y revisión de distribución siguen separadas.

### Correcciones auth r6 recibidas; revisión r7 en curso

`.local/evidence/auth-offline-r6.json` registra los cuatro repros RED→GREEN, 29 unitarias ejecutadas y 17 grupos Chromium PASS, cero errores de página y solicitudes externas. Las APIs de protocolo se conservan. `disconnect` intenta tombstone y cierre del driver independientemente; solo elimina la sesión cuando ambos confirman. El aborto tolera transacciones ya terminadas y los errores propios de IDB se traducen a `storage-unavailable/storage`. El runner ahora ejecuta las unidades y obtiene sus resultados del stdout, sin conteo constante.

El journal del slot añade el campo opcional `deletion: pending | error | completed`, compatible con sus filas anteriores. Se persiste `pending` antes de enviar el borrado. Los callbacks finales actualizan solamente el slot tombstoned, sin publicar estado tardío del coordinador; `completed` evita volver a borrar una base recreada. Si el proceso se pierde entre `pending` y la confirmación durable, o falla ese registro final, permanece incierto sin emitir otro borrado automáticamente. Esta preservación deliberada no resuelve la recuperación completa: falta una política explícita para ese estado. No se atribuye compatibilidad concurrente con escritores antiguos r3 que desconocen el journal.

Una revisión independiente r7 comprueba estos cambios y sus interleavings antes de integrar. Continúan default disabled, driver sintético y ausencia de cliente SDK en el producto. No se repiten suites generales por recibir el informe y no se elevan los gates remotos/físicos.

### Revisión r7: cuatro arreglos confirmados y cierre de recurso pendiente

R7 confirma R5-01–04 con repros focales propios. Seis limpiezas concurrentes de un slot emiten un solo borrado; el callback success repetido explícitamente no borra de nuevo una base recreada y se conservan los canarios ajenos. Esto no certifica cualquier secuencia artificial de callbacks contradictorios ni añade una política al `pending` indefinido.

La revisión reproduce un P2 de lifecycle existente: desde `ready`, `close()`, detener el binding, un DTO inválido por MessageChannel o un `messageerror` inyectado cierran admisión pero no llaman a `driver.close()`. El snapshot sigue `ready/connected` y un comando disconnect posterior se descarta por estar cerrado. La invalidación lógica no equivale a liberar el recurso. R8 corrige el cierre idempotente y observable, separado de logout, tombstone, eliminación y revocación; todavía no hay resultado. Las cuatro variantes corresponden a un solo hallazgo, no cuatro defectos distintos.

Evidencia `.local/evidence/auth-offline-review-r7.json`, Chromium con IDB/MessageChannel reales y driver sintético, cero errores de página y solicitudes externas. No se ejecutó otra vez la suite amplia ni se atribuye un socket SDK real al repro. El contrato permanece fuera de la aplicación entregada.

### Candidato gzip r6 recibido, todavía aislado

`.local/wasm-gzip-r6/checked-gunzip.mjs` propone una factory síncrona sobre una instancia WASM dedicada y confiable. La evidencia `.local/evidence/wasm-gzip-r6.json` registra 21 grupos por cada uno de seis módulos (126 ejecuciones focales) y cuatro workers Chromium nuevos que cargan originales/reconstruidos same-origin, comprueban hashes y plaintext exacto. Los seis fallos del wrapper original siguen conservados con exit 1. No se modifican fuentes C, `node_modules`, primitivas crypto ni entradas del producto.

El candidato comprueba header y tamaños antes de reservar memoria, exige retorno final C igual a cero y libera buffers incluso tras fallos. Su política experimental es 1 MiB de entrada, 4 MiB de salida, expansión máxima 128 veces más 64 KiB y admisión de memoria de 16 MiB con reserva conservadora. No son límites nuevos del SPEC ni política de producción aceptada. Los traps, punteros inválidos o fallos de cleanup invalidan la factory; no se promete recuperar el allocator tras un OOM real.

La ABI existente oculta longitud real y consumo. Un probe con capacidad `size-1` debe devolver insuficiencia antes de aceptar la salida de tamaño completo; esto añade hasta dos pasadas y evita devolver tail sin escribir en el caso medido. No demuestra consumo exacto de sufijos: un sufijo con ISIZE coincidente aún puede aceptarse. CRC sigue sin validarse y FHCRC se rechaza explícitamente. Es un subconjunto candidato, sin afirmar integridad gzip general ni corrección de GZIP_PACKED dentro del SDK. Revisión independiente r7 en curso antes de decidir su adaptación; DIST-06, distribución y gates de cuenta permanecen abiertos.

### Cierre offline r8 verificado y siguiente prueba del SDK

R8 resuelve el P2 de cierre con evidencia RED→GREEN en los cuatro caminos: 41 unitarias y 27 grupos Chromium PASS, cero errores de página y solicitudes externas. `close()` y el callback `stop()` de `bindAuthPort()` devuelven `Promise<boolean>`: invalidan admisión/generación síncronamente y comparten un único cierre de driver. `true` observa su promesa resuelta, `false` un rechazo; si no termina, permanece pendiente. Ignorar la promesa no deja el error del driver sin observar. `retryClose()` reintenta explícitamente un rechazo terminal, sin reabrir admisión. Cerrar no crea tombstone ni borra sesión, biblioteca o archivos; tampoco confirma revocación.

El padre revisó la API, contrastó los hashes y ejecutó las 12 unitarias focales de cierre, PASS. No repitió las 41 unidades ni los 27 grupos completos. `docs/evidence-auth-offline-web.json` reúne las fases sin sumar versiones como casos distintos. Se conserva la limitación de un driver que incumpla AbortSignal y del journal `pending` incierto. El cambio de dist a 12b00fc83bbf49e8 se atribuye a la entrega independiente de MiniArtwork, sin incorporar módulos auth.

La revisión gzip r7 da aprobación limitada al candidato aislado, sin hallazgo concreto y sin nueva suite runtime: verificó 38 archivos, seis hashes WASM y reproducción del parche. No aprueba un adaptador SDK, CRC, consumo exacto ni política de producción.

Se inicia una prueba aislada de la clase **IdbStorage real** instalada, sin cliente/API de Telegram, sockets ni cuenta. Debe usar exclusivamente slots propios previamente registrados y canarios sintéticos en un worker/contexto local, probar almacenamiento/reapertura/cierre y limpieza exacta conservando otro slot y biblioteca local. No se confunde persistir una sesión sintética con autenticarla. La guarda de producto y el gate de distribución no cambian. Evidencia y resultado de esta prueba r9 aún pendientes.

### Ensayo SDK-storage r9 recibido: persistencia medida y fallos de lifecycle

`.local/evidence/sdk-storage-r9.json` registra 14 grupos Chromium como **caracterización**, no aprobación de todos los cierres: Worker, IDB e IdbStorage reales; tipos/sintaxis PASS y cero intentos externos instrumentados. Dos slots registrados antes de abrirse guardan y reabren canarios sintéticos. La limpieza exacta conserva el segundo slot y el canario local. `new IdbStorage(nombre)` configura repositorios; las APIs de lifecycle son `storage.driver.load()/save()/destroy()`. `destroy()` cierra la conexión cuando su contador lo permite; no guarda, elimina ni revoca. KV se encola hasta save; authKeys usa otra transacción. No hay atomicidad común de toda la sesión.

El ensayo reproduce conexiones sin cerrar si destroy ocurre antes de finalizar load o si dos loads se solapan. También reproduce un save que sigue pendiente tras un aborto nativo sin error de request: la utilidad SDK solo observa complete/error y omite abort. El batch se había extraído de la cola; otro save vacío no confirma que se guardaran esos bytes. Esperar ese save dentro de close impide llegar a destroy. Son bloqueos concretos del futuro adaptador, no fallos observados en el producto actual, que no incorpora SDK.

Se asigna r10 aislado para serializar una carga poseída, separar cierre de recurso y persistencia, y ensayar una corrección mínima reproducible sobre copia del SDK si el aborto no puede observarse desde su API pública. Se preservan paquete instalado, r9 y producto; no se tapa el pendiente con un timeout ni se reenvían escrituras automáticamente. Un resultado debe distinguir recurso liberado de guardado confirmado o incierto. Resultado todavía pendiente.

El build de prueba r9 emitió dos WASM por el grafo de importación público, aunque el navegador no los pidió ni instanció. Ambos quedan registrados en el inventario del experimento; no autoriza distribuirlos con el producto ni cerrar licencias/D03. La autenticación y la completitud de una sesión MTProto no quedan probadas por el almacenamiento sintético.

### Adaptador storage r10 recibido y revisión r11 en curso

R10 registra diez unidades y doce grupos Chromium/Worker/IDB GREEN, cinco fallos esperados del original RED con exit 1, y cero intentos externos. Mantiene IdbStorage y BaseStorageDriver públicos; un plugin del build aislado sustituye solo copias ESM de `idb/driver.js` y `idb/utils.js`. El parche observa abort además de complete/error, e instala el observador antes de put para abortar y esperar rollback ante excepción síncrona. No modifica el paquete instalado ni el producto.

`OwnSlot` posee una única carga serializada y cierra admisión antes de esperar. Guarda marcadores de queued/intento antes del save y confirma clean solo tras guardar y reconocer el journal de prueba. Si falla, conserva causa cerrada/write-uncertain y no reproduce el batch drenado. El cierre intenta liberar en finally; el informe separa recurso liberado de guardado confirmado o incierto. Reintentar la liberación no confirma una escritura perdida ni reabre el slot. No se expone una sesión autenticada ni un resolvedor universal de incertidumbre.

El control y la factory son internos de un único dueño por slot; este prototipo no arbitra pestañas, no integra el journal auth del producto y solo cubre KV propio. AuthKeys y completitud de sesión siguen fuera de esa garantía. Se preservan los límites de load nativo bloqueado y eventos que no terminen; sin timeout que finja persistencia o liberación. `.local/sdk-storage-r10/REPORT.txt` detalla los fallos de harness y el parche reproducible; `.local/evidence/sdk-storage-r10.json` conserva recibos/hashes. Revisión independiente r11 pendiente antes de adaptar código real, sin aprobación de auth/distribución/D03/T4/P0/iPhone.

### Revisión r11: un cambio acotado en clasificación de errores

R11 verifica el replay del parche y los recibos históricos, sin repetir las suites generales. Reproduce R11-01 P2 en el adaptador aislado: `detail(error)` evalúa `instanceof DOMException` y `error.name` sin protección. Una excepción genuina con getter sintético que lanza hace fallar la clasificación antes de conservar la causa. En load/save/flush de close puede rechazarse el cierre o saltarse la persistencia final; el finally sí intenta destruir cuando hay una carga poseída. No se observó falso clean ni pérdida/borrado de otra DB. No se afirma que el SDK nativo produzca ese getter ni que el producto actual lo permita inyectar.

La hipótesis separada de onerror antes de abort se observa con journal inmediato de test; ese journal no cumple la precondición durable del candidato. Con el control durable de r10 no se observó cierre prematuro ni falso clean. No se eleva a segundo defecto ni se cambia el parche por esa hipótesis.

R12 prepara una corrección total y no lanzable del clasificador, fallback cerrado `unclassified`, causa primaria preservada antes de enriquecerla y journal/reporte finales incluso si inspeccionar el error falla. Se trabaja en una nueva copia aislada conservando r10/r11 y paquete original, con repros focales RED→GREEN. Resultado pendiente; sin nueva integración, auth ni aceptación de distribución/T4/P0/iPhone.

### Corrección storage r12 recibida y siguiente integración crypto aislada

R12 conserva la API y corrige solo el clasificador y orden de conservación de causa. Veintidós casos focales Node y los mismos 22 en Chromium/Worker/SDK/IDB real GREEN; el baseline r10 falla 11 por entorno (variantes de un hallazgo, no once defectos). Tipos, sintaxis y replay del diff PASS. El padre leyó el diff/reporte y comprobó que el parche SDK sigue byte-exacto al de r10; no repite las suites históricas ni afirma aceptación general. `docs/evidence-sdk-storage-offline.json` separa las fases y sus límites.

Se inicia r13 de crypto/worker real offline: WebCryptoProvider público con WASM same-origin seleccionado por manifiesto de hashes y gzip comprobado, sin cliente, sesión, DB ni red Telegram. Debe probar composición/allocator y sustitución original→reconstruido en worker nuevo, conservar las precondiciones del candidato gzip e inventariar los módulos/avisos efectivos. Es experimento aislado y receta de recombinación del worker de prueba, no entrega del producto ni cierre automático de DIST-06/distribución. No se cambia la CSP ni las guardas del build privado b637. Resultado aún pendiente.

### Composición crypto r13 recibida; revisión y entrega técnica pendientes

R13 registra 28 ejecuciones focales sobre cuatro workers nuevos, con WebCryptoProvider real y gzip en una **segunda instancia dedicada** del módulo verificado. Solo se sobreescribe gunzip; los métodos heredados SHA/AES se contrastan y el allocator singleton SDK no se entrega a la factory gzip. La fachada invalida también las capacidades CTR retenidas ante poison. Son casos medidos con inyección de trap, no agotamiento real de memoria ni certificación criptográfica. CRC y sufijos de ISIZE coincidente siguen aceptándose; la política de recursos sigue experimental.

Inventario de ese grafo conservador de prueba: 18 módulos renderizados, cinco paquetes, seis assets WASM y el módulo aritmético embebido de long Apache-2.0. long se retuvo expresamente mediante import y configuración local de side effects; no se presenta como inventario mínimo ni como grafo del cliente completo/producto. La receta reconstruye ambos targets con fuentes intactas y toolchain local, recombina el worker de prueba y verifica sus bytes runtime. Los reconstruidos siguen distintos del npm original; no se confunde recombinación reproducible con publicación bitidéntica.

`.local/evidence/sdk-crypto-r13.json`, `REPRODUCE.txt`, `module-inventory.json` y `delivery-missing-manifest.json` conservan fuentes, comandos y límites. R14 revisa la composición mediante hipótesis concretas antes de una adaptación real. R15 evalúa técnicamente los avisos/fuentes disponibles y los faltantes de un paquete concreto; debe separar la referencia histórica EncryptionLibrary 404 de permisos actuales documentados, sin convertir automáticamente ese límite en prohibición ni inventar atribución o un dictamen jurídico. Ninguna tarea autoriza cliente/red/cuentas, cambia el producto ni cierra D03/D05/DIST-06/P0.

### Revisión crypto r14: retirada terminal pendiente en fallo combinado

R14 reproduce un único P2 con tres controles Node y tres Chromium sobre el adaptador r13 emitido e intacto. Un error C de datos gzip se conserva correctamente como primera causa; si después falla el cleanup, la factory marca poison pero la fachada no lo recibe porque deduce terminalidad del código de la primera causa. SHA y CTR retenido siguen funcionando hasta otra llamada gzip. El allocator SDK es otra instancia: no se demuestra corrupción de su memoria ni un fallo en el producto actual. Es incumplimiento de la retirada prometida por la fachada reusable.

Se asigna r16 aislado para propagar terminalidad independientemente de la causa primaria y retirar todas las capacidades antes de devolver el fallo combinado, sin reemplazarlo por un error distinto. Deben conservarse dos controles: un error de datos aislado permite reutilizar la instancia sana; cleanup fallido sí retira inmediatamente. No se requiere otra matriz crypto ni se cambian CRC, consumo de sufijos o recursos experimentales. Resultado pendiente, r13/r14 conservados.

La auditoría r14 además contrastó fuentes, 24 avisos originales, hashes de manifiestos y bytes de recombinación; no volvió a compilar ni ejecutó los 28 casos históricos. El inventario sigue siendo el grafo conservador de prueba, no el cliente completo. R15 continúa la evaluación técnica de entrega sin elevar ese inventario o esta revisión a aprobación de distribución/auth/D03/P0.

### Fuente primaria SHA-1 y copia portable en preparación

R15 documenta el header CTrabant, MIT completo y atribución histórica de la adaptación mtcute. El [README primario fijado de CTrabant](https://raw.githubusercontent.com/CTrabant/teeny-sha1/f05a2d0019e12850bb482274c1a21ae7a4fb84bd/README.md) declara MIT para su implementación; su afirmación sobre el original se conserva atribuida, sin fingir verificación independiente del ancestro hoy inaccesible. El padre contrastó también ese README público. El 404 ancestral queda como limitación histórica y deja de ser requisito obligatorio independiente para preparar los avisos. Se conserva literalmente la línea de copyright incompleta del LICENSE, sin completarla con autores inventados. No es aprobación jurídica global ni cambio de D03/D05.

R16 corrige R14-01 con `terminal` booleano readonly en la función gzip congelada y lectura en finally de la subclase, independiente de primera causa. El padre revisa ambos diffs y recibos: tres controles de composición y cuatro de señal por entorno Node/Chromium, RED r13 preservado y GREEN candidato; no nueva matriz crypto. Se mantiene la separación de instancias y los límites conocidos, sin incorporar SDK al producto.

R17 prepara una copia portable del **worker de prueba r16** con el delta explícito sobre r13, fuentes/avisos exactos y cierre de resolución/build de r15. Debe verificar en un directorio relocado que el build no cae al node_modules/workspace original y que la receta recompone ambos WASM/worker con prerrequisitos declarados (Node/Make/WASI), sin instalar ni publicar. Términos de archivos propios solo en borrador para el responsable, sin licencia global inventada. Resultado pendiente; auth/storage del producto, control de incertidumbre, integración/SW/cache/avisos y aceptación D03/D05/P0 siguen separados.


## 2026-10-31 · Fuente portable del worker de prueba r17 recibida

R17 entrega WORKER-DE-PRUEBA-r16-portable-r17.tar.gz: 37.119.710bytes, 1300 archivos, SHA256 02eee25ea98faf35f727146e8e5937f37f4ebd36f27d85721f8ad89560aaed28. Rebuild relocalizado escalar/SIMD/worker, seis workers Chromium y dos procesos Node smoke+terminal r16 PASS; tres escapes ESM/CJS/bundler rechazados. Avisos originales/diffs/inputs y relectura íntegra registrados; padre relee TAR/hash y confirma 1300 archivos sin traversal/symlinks/hardlinks. `.local/evidence/sdk-source-portable-r17.json` conserva fallos de harness y cambios concurrentes ajenos, sin ocultarlos.

No instalación/publicación ni SDK en producto. Requiere Node22.23.3/Make4.4.1/WASI20 LLVM16 explícitos; probado Linux x64, checksum toolchain local sin firma/checksum primario. Dos WASM npm emitidos y long embebido permanecen inventariados, no se disimula su distribución. CRC/sufijos gzip y políticas experimentales mantienen límites. TERMS-DRAFT no concede licencia propia ni decide por el propietario; modalidad/términos siguen reservados para entrega que corresponda. No se pide permiso ahora para investigación técnica reversible.

Review independiente r18 Sol6.1 medium/default real en curso para fuente/avisos/resolver/recibos y afirmaciones, sin repetir reconstrucción general. No aprobación jurídica ni DIST06 total/D03/D05/auth/storage/frontend/SW/cache/SDKproducto ni P0/iPhone. docs/evidence-sdk-portable-web.json separa evidencia histórica/parent/revisión pendiente. USD0 y objetivo íntegro NO COMPLETADO. ODD+Engram propios se sincronizan y verifican en invocación independiente tras registro.


## 2026-10-31 · Revisión independiente del source companion r18

R18 aprueba limitadamente r17 como fuente acompañante del WORKER DE PRUEBA, sin P1/P2 reproducibles. Audita TAR/1300 archivos/1299 entradas INPUTS, 1259 asociaciones origen-destino, diez recibos, patches r16 byte-exactos, 17 avisos literales, 14 assets/seis WASM+long embebido y grafo734IDs/196resoluciones; tres probes nuevos PASS (verificador relocalizado, escapes ESM/CJS rechazados). No recompila ni repite seis workers/dos Node históricos de r17. `.local/evidence/sdk-portable-review-r18.json` y REPORT separan las pruebas.

Precisiones al informe congelado r17: INPUTS.json mismo contenido, modo0644 en TAR frente0664 staging (los otros1299modos coinciden); resolution-node.jsonl está en raíz del portátil, no output/ como agrupa REPRODUCE. verify.py prebuild valida INPUTS, pero snapshot release-TEST se verifica por separado (r18 sí lo comprobó). Estas notas no cambian bytes/TAR histórico ni constituyen P1/P2. Se incorporarán a instrucciones al preparar una nueva entrega si corresponde.

Términos propios y modalidad siguen reservados; no permiso de publicación, dictamen jurídico ni SDK de producto aceptado. D03/D05/DIST06 total/auth/storage/frontend/SW/cache/release y aceptación física permanecen pendientes. Padre verifica Engram14/14 independiente al retomar; USD0, privada b637 sin SDK ni cambios y objetivo íntegro NO COMPLETADO.


2026-10-31 · R33 inicia el ensayo de composición AuthCoordinatorr8 + driver OwnSlotr12/IdbStorage real en worker aislado sintético, sin cliente/red/auth. Primer frontera a verificar: load/save/close/cancel y journal persistencia incierta frente recurso liberado, A/B/callbacks scopes. No nueva matrizcrypto ni paquete de distribución; resultado pendiente. ODDT4 registra límites/autorizaciones futuras, producto41 no contieneSDK.


## 2026-10-31 · Composición aislada R33 revisada en R36

R33 final: 20/20 casos Chromium154 Worker/MessageChannel/IdbStorage/IDB reales PASS, con autenticación exclusivamente sintética y sin API identity, TelegramClient, conexión ni crypto integrado. Guardado y journal separan confirmación persistente de liberación física. Abort o acuse perdido conservan write-uncertain aunque el recurso se haya cerrado; hang permanece pendiente. Cuarentena durable impide reutilizar/reproducir slots inciertos. Cierre, cancelación, A/B y canario local conservados; Worker terminado explícitamente y reabierto en fixture, sin afirmar crash de SO ni sesión Telegram recuperada. Sin enumeración global de bases, cero intentos externos/pageerrors/CSP. R8/R12 y paquetes originales intactos; namespaces/diffs/avisos fijados.

R36 aprueba limitadamente el ensayo: 56 hashes, replay de namespaces y avisos verificados; dos probes nuevos PASS sobre acuse perdido durante logout y abort con destroy rechazado/retry explícito. No repite ni suma los20 históricos. Primera causa conservada, nada se borra automáticamente con persistencia incierta. Evidencia .local/evidence/sdk-auth-storage-composition-r33.json y sdk-auth-storage-review-r36.json. KV no demuestra atomicidad/confirmación de authKeys y sesión completa. No son PASS de autenticación, revocación remota, D03/D05 ni SDK de producto.

Siguiente unidad R39 Sol6.1 medium/default real: diseño concreto del adaptador SDK deshabilitado y pruebas offline sobre repositorios completos, antes de cualquier solicitud de conexión al propietario. Escrituras limitadas a informe/APIs/evidencia propios, sin src/cliente/red/credenciales. Fuente portable R17/R18 sigue antecedente de worker de prueba, no distribución final de un SDK integrado. Sin nuevas investigaciones genéricas de licencia ni repetir matrices crypto. T4/P0/iPhone siguen pendientes, USD0.


## 2026-10-31 · Diseño R39 recibido y candidato offline R42 en implementación

R39 entrega diseño revisable, sin cliente ni runtime tests nuevos: .local/sdk-next-client-design-r39/REPORT.txt, APIs.json y .local/evidence/sdk-next-client-design-r39.json. Inspección de firmas instaladas distingue IdbStorage.save (KV/peers diferidos) de mutaciones directas authKeys/temp/refMessages y de promesas iniciadas por callbacks SDK. La superficie crypto R16 no implementa por sí sola ICryptoProvider completo. Esos hechos justifican un único incremento previo a pedir conexión real: proveedor cercado completo y checkpoint secuenciado de cinco stores, factory real tipada pero bloqueada sin identidad API/permiso privado, fachada crypto completa y fuente acompañante del nuevo grafo. No se exige atomicidad entre control/SDK/Telegram ni se interpreta checkpoint de almacenamiento como login.

R42 Sol6.1 medium/default real implementa ese candidato en .local/sdk-next-client-candidate-r42/ y recibo propio. Sin src/main/SDK de producto, sin instanciar cliente ni apiId/hash inventados, sin ready positivo sintético. Tests propuestos F01–16 todavía NO ejecutados/aceptados al iniciar: abort nativo después de requestsuccess, commits/repos completos, dirty/journal/checkpoint/ACK perdido, cuarentena/reopen/corte explícito Worker, cierres inciertos y crypto forwarding/terminal; no repetir matrices/buildC/TAR histórico. Fuente ESM editable y avisos fijados con recombinación JS relocalizada; términos/modo entrega siguen propios del responsable ante una entrega concreta. No nueva investigación legal genérica.

D03/D05/D10/auth real y producto final siguen abiertos. No se piden credenciales ni autorización de conexión antes de preparar el candidato. USD0, datos y bases exclusivamente fixtures propias; Engram14 real leído. R40/R41 copias continúan aparte sin cambiar la entrega privada41cc. Objetivo P0-W íntegro NO COMPLETADO, iPhone APLAZADO/PENDIENTE.


## 2026-10-31 · R42 implementado y R47 solicita corregir journal al cerrar

R42 entrega candidato aislado y companion nuevos: proveedor completo/checkpoint cinco stores, crypto completa y factory real tipada pero deshabilitada. Quince grupos únicos Chromium con SDK storage/Worker/IDB reales PASS; F16 relocalización/recombinación verifica los mismos quince y no son treinta casos distintos. Tipos y14 checks de sintaxis PASS. Inputs/patches/avisos/grafo físicos están fijados; no cliente construido, API inventada, autenticación falsa ni ready positivo. Fuente .local/evidence/sdk-next-client-candidate-r42.json. No se integra al producto ni se pide conexión antes de revisar.

R47 nueva revisión independiente ejecuta cinco probes focales y audita companion; solicita cambios por R47-01 P2: un writer tardío durante close confirma write-uncertain durable, pero después de await save se escribe clean temporalmente antes de volver a incierto. El final correcto no elimina esa ventana. RED y trace reales conservados; no se observó login falso, pérdida de datos ni red Telegram. Se requiere corrección acotada que respete epoch/cuarentena al decidir y publicar clean, incluida la cola del journal. R42 permanece intacto; la corrección se preparará como nueva copia y después revisión focal, sin repetir matrices generales.

R47-02 P3 caracteriza que clean no prueba liberación del owner anterior si destroy está pending/rejected: el caller confiable debe observar release/terminación antes de crear otro owner. No se demostró doble owner físico, no se añade arbitraje nuevo como gate de este ensayo. Otra observación devuelve capacidad de checkpoint no viva al cerrar durante ACK; validCheckpoint la rechaza, sin bypass de bind/ready. No son segundos P2. Companion favorable limitado en auditoría de inputs/diffs/avisos, sin aprobación del candidato completo. R47-04/05 controles dirty-before-raw/inputs y crypto retirement PASS, incluidos errores hostiles; no certificación universal ni prueba auth real.

Evidencia .local/sdk-next-client-review-r47/REPORT.txt y .local/evidence/sdk-next-client-review-r47.json; quince históricos no reejecutados. Pendiente fix P2 y revisión; D03/D05/D10/auth/producto/términos de entrega/P0/iPhone abiertos, USD0. No credenciales ni solicitud de cuenta en este turno. T16 se desarrolla por separado sin modificar estos árboles aislados.


## 2026-10-31 · Corrección R49 del P2 aislado autorizada y en curso

Nueva delegación R49 Sol6.1 medium/default real corrige R47-01 en .local/sdk-close-fix-r49/ exclusivamente, conservando R42/R47 inmutables. Scope: decisión/publicación clean respeta epoch y cuarentena también después de await save y al ejecutar la cola de journal; reproducir trace RED y verificar ausencia de regresión durable incierto→clean con IDB/SDK reales. APIs compatibles, primera causa y no replay/liberación falsa; pruebas focales nuevas, sin repetir matrices crypto/F16 completas ni investigación legal. Companion/diff nuevo debe describir baselineR42 más overlay fijo y readback/replay en copia temporal, sin afirmar aprobación del candidato original.

R47-P3 sigue frontera de caller confiable: clean no certifica release; no otro owner hasta liberación/terminación observadas. No se inventa arbitraje nuevo como gate ni se trata checkpoint inactive como bypass de ready. R49 aún sin resultado/revisión: D03/D05/D10/T4/P0/iPhone continúan abiertos, cero cliente/cuenta/credencial/conexión. Padre mantiene ODD/Engram, USD0.
