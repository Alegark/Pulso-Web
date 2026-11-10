# Descarga y reproducción desde el bot

Buscar o pulsar Enter sigue mostrando el catálogo de Pulso. Elegir una canción comprueba la copia local y, si falta, consulta al primer bot configurado compatible para obtenerla y escucharla. [Recorrido actual y gestión de espacio](SELECTED-SONG-PLAYBACK.md).

En la respuesta, Pulso elige automáticamente la mejor coincidencia musical compatible y pulsa exactamente ese botón del bot tras una lectura fresca del mensaje. Los empates conservan el orden original; no se pide otra elección de versión. Si no hay coincidencia suficiente, se informa y no se pulsa otro candidato. La capacidad es privada, de un solo intento y caduca a los dos minutos. Se comprueban bot, revisión del orden, cuenta, consulta, mensaje, menú y metadatos esperados. No se decodifican ni inventan formatos de callback. El recorrido real anterior de FLORES con ivkmbot no acredita otros títulos ni proveedores. Una URL devuelta por el callback no se abre ni se trata como audio. Los indicadores alert y nativeUi sólo orientan la presentación y no confirman un archivo. Pulso no abre una interfaz nativa ni juegos.

Un audio de la ventana vigente del bot puede pasar a descarga si es el candidato compatible mejor clasificado y se revalida; no es obligatorio el campo opcional de respuesta. Peer privado exacto, baseline posterior a consulta/callback, ausencia de otra consulta concurrente, cuenta/revisión/expiración y metadatos siguen cercados. No se deduce causalidad por proximidad temporal ni se relabela un mensaje reciente como reply. Si hay varios compatibles, Pulso toma el primero del ranking, vuelve a comprobar ese documento concreto y descarga sus partes. Metadatos insuficientes o conflictos terminan con un aviso sin una segunda elección manual. Los títulos de mensajes, bots y archivos son datos no confiables y se muestran como texto.

El límite vigente es **32 MiB por archivo** y una descarga activa, en partes secuenciales de 64 KiB. Esta ruta admite MP3, M4A y WAV; no sigue redirecciones CDN ni reintenta automáticamente un archivo caducado. El tamaño se comprueba antes de pedir bytes, y se exige longitud exacta, cabecera compatible y SHA-256 incremental. El presupuesto de payload no es una garantía de heap: Blob, transporte y copias temporales tienen costes adicionales.

El worker de Telegram sólo conserva estado en RAM y entrega un Blob cerrado. La elección de canción en el catálogo autoriza una copia personal de reproducción en el almacenamiento del navegador, conservable tras cerrar sesión. El importador musical separado vuelve a comprobar formato, metadatos disponibles, hash, escritura y lectura posterior antes del commit. Metadatos ausentes no se inventan; coincidencia de metadatos y hash del archivo no equivalen a identidad acústica.

El guardado exige la admisión musical vigente, independiente de poder iniciar sesión: owner/proof, scope, generación DB, ausencia de reservas y recuperaciones pendientes. Cancelar invalida la publicación y solicita detener la operación, manteniendo la observación de los RPC originales. Un ACK de cancelación no liquida una petición en vuelo. Un commit local confirmado que gana a una cancelación se reconcilia; una escritura incierta conserva sus gates y nunca se repite por un reloj.

Sólo se muestra guardada tras el recibo durable y el refresh. Escuchar no la añade a Biblioteca: «Agregar canción» lo hace explícitamente; «Añadir a playlist» organiza sin duplicar el audio. La intención de escucha vigente prepara la cola e inicia Play tras la copia verificada; cancelar o perder autoridad impide ese Play. El Audio único se conserva. Si el navegador exige otro gesto, aparece el aviso y el control Reproducir. No escribe en Archivos del sistema, Cloudflare ni otro servidor. El almacenamiento pertenece a este origen y navegador; su conservación depende de las políticas y del espacio del dispositivo.

No hay fallback automático entre bots ni reproducción progresiva remota. El lote de álbum usa un coordinador secuencial separado; su aceptación local con archivos propios no acredita la descarga real de MOSCA ni la disponibilidad de todas sus pistas. Las pruebas sintéticas tampoco aceptan cuenta Telegram, iPhone o Safari físico. La evidencia histórica concreta y sus límites se registran en `docs/evidence-bot-download-web.json` y los informes de cada incremento.

El ranking de metadatos se comparte con el worker y también decide entre varios audios tras el callback. Prioriza audio con título/intérprete compatibles y duración cercana, luego etiquetas completas y finalmente numeración/duración decorativas normalizadas. Mantiene las palabras de versión. [Contrato completo](SELECTED-SONG-PLAYBACK.md#selección-automática-de-la-mejor-coincidencia).

## Menú que se convierte en audio

Después del callback, la lectura incluye el mensaje exacto del menú seleccionado si contiene un documento distinto del observado antes del callback, además de los mensajes posteriores al historial capturado antes del callback. Esto permite encontrar un audio que sustituye al menú sin aumentar el número de consultas ni el límite de veinte mensajes por respuesta. Un audio que ya acompañaba al menú —aunque cambien el texto o los botones— y las grabaciones anteriores vecinas se descartan; se mantienen la comprobación del bot, la correlación, los metadatos musicales y las relecturas exactas antes y después de recibir los bytes.

La regresión de este caso falla con el driver anterior y pasa con el actual. Las pruebas usan datos y transporte sintéticos: no demuestran que éste sea el motivo del timeout real de SAMSA. El diagnóstico de ese recorrido se registra por separado.

## Proveedor elegido y avisos del bot

Por elección explícita del propietario, la pestaña de prueba configura sólo AnsMusicBot como principal. La sugerencia visible pasa a AnsMusicBot sin activarlo automáticamente para usuarios nuevos. Se conservan los adaptadores anteriores por compatibilidad, pero no se agregan al orden elegido ni reciben consultas por ello. El orden de bots sigue siendo de esta conexión; no se ha convertido en una preferencia persistente.

AnsMusicBot usa el mismo contrato acotado de consulta título más intérprete, selección de botón musical revalidado y descarga verificada. Las pruebas con SDK sintético comprueban este contrato, no su disponibilidad ni una promesa de descargas ilimitadas. Comprobar un perfil no envía `/start`. La comprobación operativa autorizada del chat existente no necesitó iniciarlo y cerró su cliente sin escribir el almacén de autorización.

Si Telegram devuelve un mensaje informativo junto al resultado del callback, se muestra como texto limitado a 500 caracteres y ligado a la selección vigente. No se interpreta como HTML, enlace, permiso ni instrucción de pago; no se registra ni persiste. Los indicadores alert y nativeUi de Telegram son pistas de presentación, no autorización para abrir una superficie ni prueba de audio. Pulso muestra sólo texto inerte y sigue esperando el documento musical del chat; una URL o hasUrl continúa rechazándose. Una forma no booleana de esos indicadores se rechaza. Una notificación no confirma que exista audio. El progreso de cero bytes sólo indica un descriptor de archivo validado antes de la primera lectura; la descarga exige bytes positivos, integridad y confirmación del importador.


## Diagnóstico de Ans y prueba de álbum pendiente

Una selección real de SAMSA observó alert=false, hasUrl=false, nativeUi=true y ninguna URL. El rechazo anterior de nativeUi detenía la lectura antes de comprobar si el bot había enviado un documento. La corrección conserva el constructor esperado, la validación de los indicadores, el rechazo de enlaces, la captura original y todas las comprobaciones del documento y del archivo. No ejecuta UI nativa, juegos ni otra acción del bot. El control negativo anterior y la regresión sintética con documento propio están conservados en .local/ans-native-presentation-fix. Esto localiza un bloqueo de Pulso; no sustituye la prueba real de descarga ni acredita un álbum completo.


## Espera de la respuesta compatible

La aparición de un audio ajeno no termina por sí sola la consulta ni la espera del callback. La búsqueda sigue devolviendo de inmediato un menú validado; si sólo llega un audio sin coincidencia con el objetivo, observa la misma consulta dentro de sus límites originales. Tras seleccionar un botón se esperan metadatos compatibles dentro de las60lecturas de historial existentes. Nunca se repite la consulta ni el callback, se amplía el plazo o se piden bytes del audio ajeno. Al agotarse la ventana se informa la última respuesta no compatible o el timeout correspondiente. Título, intérprete, versión, duración, MIME y cap de 8 MiB siguen aplicándose.

Las regresiones con audio propio verifican llegada ajena→compatible, resultado ajeno durante toda la ventana y audio intermedio antes del menú, con un solo envío y callback. La suite completa actual pasa573/573; la ejecución previa canceló18casos con reloj controlado porque se demoraban también menús válidos. El recibo fallido se conserva; la condición se corrigió para preservar esa salida inmediata y se repitió la suite. Esto no convierte el archivo real incompatible que devolvió Ans en una grabación confirmada de MOSCA.


## 2026-11-08 · Formato comprobado, relectura y lote real de MOSCA

El documento de Canonizado declara audio/mpeg, pero su cabecera identifica MP4/M4A. El ensamblador reconoce MP3, M4A y WAV por sus bytes y usa ese MIME comprobado para el Blob; conserva el tamaño máximo de 8 MiB, longitud exacta, SHA incremental y validación independiente del importador. Otros formatos siguen rechazados antes de continuar la lectura.

La relectura de un audio fija mensaje, peer privado, reply anchor y documento inmutable (ID, access hash, DC, tamaño y MIME declarado). Reproyecta además los metadatos musicales actuales antes y después de transferir. Caption, previews y la omisión equivalente de fromId no cambian la identidad de un archivo. Los menús/callbacks conservan su snapshot completo y estricto. El control sintético reproduce el conflicto del snapshot antiguo; no se capturó qué campo incidental concreto difería en el intento real anterior.

Un resultado liquidado sin coincidencia o una validación de bytes fallida antes de crear Blob/importar no se confunden con entrega incierta. El lote puede registrar esa fila fallida y continuar; pending, cuarentena, cambio de objetivo/consulta o incertidumbre real siguen deteniendo la operación. No se repite una fila fallida automáticamente.

Prueba real única del lote MOSCA (17 pistas) con Ans: 2 confirmadas (Canonizado reutilizada y Atrapado y Libre descargada), 15 fallidas, 0 sin intentar y 0 revisión. Fallos:7 audios incompatibles,7 respuestas sin coincidencia suficiente y1 archivo mayor de 8 MiB. Los 17 search y 10 download incluyen la selección individual inicial de Canonizado; no hubo cancelación ni reintentos. Esos comandos no representan todo el tráfico RPC. La prueba no acredita que las 15 canciones sean inexistentes en Telegram.

Canonizado se descargó completo: 7.381.073 bytes; su Blob, manifiesto y copia OPFS coinciden por longitud/SHA comprobados sólo en RAM. La reproducción avanzó; una segunda selección no emitió search/download ni creó otro asset. Se creó Prueba MOSCA Ans y se conservó FLORES (2.738.289 bytes). Atrapado y Libre incorporó 6.037.298 bytes. No se registra contenido, hashes de audio, IDs privados ni avisos del bot. Evidencia .local/audio-identity-real; cierre y recarga se documentan allí por separado. No aceptar álbum completo, iPhone, offline/background ni P0-W.


## 2026-11-09 · KDMusic_Bot como alternativa comprobada en un tema

KD se añade a las sugerencias inactivas y a la allowlist exacta del driver. El perfil sólo se consulta al confirmarlo; no inicia chats por sí mismo. La pestaña de pruebas conserva Ans primero y KD segundo. La implementación actual usa el primer proveedor configurado: la conmutación automática entre proveedores sigue pendiente; se puede cambiar el orden con los controles existentes.

Un inicio y búsqueda de salud recibieron respuesta real. El control musical válido fue la pista original ¿Qué Tan Cerca Es Cerca? de MOSCA/Nsqk, obtenida desde el catálogo de álbumes. Descargó 3.203.914 bytes, se importó y reprodujo automáticamente; dos reselecciones no provocaron otra búsqueda ni descarga. La copia OPFS pasó longitud/SHA frente a su manifiesto. Blob y almacenamiento se verificaron por separado; no se declara comparación independiente directa entre sus hashes.

La primera entrada elegida de Santurce era un Visualizer del catálogo LRCLIB; se rechazó la diferencia de título sin pulsar el botón del bot. No prueba que KD devuelva mal la canción original. Los callbacks de KD exigen título e intérprete completos y conservan las guardas y el límite de8MiB. Enlaces/anuncios no se abren y no se aceptan pagos ni uniones. Esto no demuestra disponibilidad general, cuota ilimitada ni un álbum completo.

Entrega funcional fdb26a48f8502c10, separada del trabajo visual concurrente D1. Fuente/evidencia cerrada en .local/kd-provider-release y .local/kd-bot-live-health. Prueba de navegador de escritorio; iPhone físico, offline/background y P0 siguen pendientes.

## 2026-11-09 · Proveedores ordenados y MOSCA real

La entrega funcional `6513c86cdcc77922` incorpora la [obtención secuencial](ORDERED-BOT-ACQUISITION.md). Sustituye la limitación anterior de usar sólo el primer proveedor. Las colaboraciones conservan ahora el crédito completo tanto para buscar como para validar; el artista principal no autoriza aceptar un crédito distinto. Se conservaron todos los filtros de título, versión y duración, los límites de archivo y las relecturas estrictas del menú.

La cobertura real acumulada de MOSCA llegó a **16 de 17 copias**, mediante un lote y selecciones individuales explícitas; no fue una única ejecución completa de lote 17/17. Las seis colaboraciones pendientes se obtuvieron de KD con el crédito completo. Sus nuevos Blobs, manifiestos y archivos OPFS coincidieron por longitud/SHA comparados sólo en RAM. Se preservaron FLORES y las listas previas.

«No Basta Con Querernos Más» quedó sin copia: KD devolvió audio incompatible tras su selección y el mismo intento avanzó a Ans, que no ofreció coincidencia compatible. Es un fallo confirmado de ese recorrido; no demuestra ausencia de la canción en todo Telegram. No se descargó el audio incompatible ni se añadió como pista correcta.

Una selección de «Lo Tuvimos Pero Ya No Está» se detuvo antes del callback por conflicto de revalidación. La auditoría posterior, limitada a lecturas, encontró igualdad entre las respuestas actuales; no identifica qué cambió en el intento anterior. No se relajó el fingerprint del menú. Una nueva selección individual explícita sí descargó la pista. La cuarentena del lote anterior no se borró para provocar el reintento.

La repetición de Circo reutilizó la copia y conservó los contadores de comandos observados. Una playlist propia con dos entradas persistió tras recargar, al igual que la sesión y las copias. Los contadores search/download no equivalen a todo el tráfico RPC. La prueba real y las matrices sintéticas tienen recibos separados; iPhone, offline/background y P0-W siguen pendientes.


## 2026-11-10 · Tamaño de canción y motivos del rechazo

Una selección real de la canción indicada por el propietario llegó al callback y terminó con `file-too-large`, ACK y sin progreso de transferencia. La respuesta del bot no estaba ausente: Pulso rechazaba el descriptor antes de leer bytes por el límite anterior de 8 MiB. El tamaño exacto no quedó acreditado en esa observación.

`storage/audio-limits.ts` fija 32 MiB por archivo de descarga, alias, inspección, reproducción y retirada; las reservas Blob comparten un máximo de 64 MiB. El importador conserva sus verificaciones y sus límites independientes. No se aumentan por ello los presupuestos de metadatos, exportación o respaldos. Payload y reserva no son garantías de consumo máximo de memoria del navegador.

Al agotar proveedores se distinguen opciones sin coincidencia (D01), audio observado con metadatos incompatibles (D02), tamaño superior al límite (D03) y archivo incompleto o formato inválido (D04). Estos motivos no prueban ausencia de la canción en Telegram. El aviso de progreso del bot se retira al terminar el intento. No se debilitan las comparaciones de título, artista, versión, duración, peer, permisos o integridad.
