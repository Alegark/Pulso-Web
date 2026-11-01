# LRCLIB: incremento preparado y activación pendiente

Estado 2026-10-31: adaptador/panel e integración local revisados y probados con respuestas sintéticas; transporte público sin demostrar por dos preflights 502. El producto conserva `externalLyricsAvailable=false` y la CSP del origen no permite conexiones a LRCLIB. La copia privada sigue en `9cbcab4e444d7d6d`. No hay consultas de biblioteca activadas.

## Comportamiento de este incremento

Las letras locales tienen prioridad. El panel externo se ofrece únicamente al abrir Letras cuando el registro local está ausente y no representa una elección manual «Sin letras». Un registro local dañado no se sustituye con información externa. No se cambia la información de la canción ni sus bytes, favoritos, playlists o cola.

El usuario acepta la consulta opcional y pulsa Buscar para la canción actual. Una respuesta de LRCLIB sirve tanto para la letra como para el contraste de título, artista, álbum y duración. No se hace otra búsqueda para obtener esos campos. El resultado se muestra como candidato y sólo vive en memoria: todavía no se guarda para uso offline ni se aplica a Track. Los conflictos no se convierten en letras confirmadas; LRCLIB no identifica una edición ni entrega portadas.

Cancelar, desactivar, cambiar de pista, perder control o invalidar el acceso a la base impiden publicar una respuesta antigua. La captura del padre incluye la generación de admisión de la base, además de scope/proof/Activity, para que un reintento no reviva una consulta anterior. No hay solicitudes por render, avance de tiempo ni exploración masiva de biblioteca.

El panel limita una operación activa, conserva la espera de Retry-After y una separación entre consultas; la implementación final y sus pruebas están en el recibo R59. La identificación pública de cliente y el transporte real siguen siendo parte de la activación, no un supuesto demostrado con respuestas sintéticas.

## Datos y decisión D08

Destino propuesto: `https://lrclib.net/api/get` exclusivamente, lectura mediante GET. Se enviarían título, artista, álbum y duración disponibles. El servicio también recibe la IP, cabeceras HTTP y un identificador no secreto de Pulso. No se envían audio, huellas acústicas, chats, sesión Telegram, credenciales, playlists ni historial.

La documentación oficial permite lectura sin API key y registro opcional; solicita identificar la aplicación por User-Agent o, en navegador, X-User-Agent/Lrclib-Client. No se inventarán una cuenta, contacto o página del proyecto. La selección de identidad verdadera y el permiso concreto de envío deben quedar claros antes de activar. [Contrato oficial](https://lrclib.net/docs.txt).

Para activar será necesario resolver la decisión del propietario D08 sobre fuente/datos/condiciones, completar las comprobaciones reales pertinentes y permitir sólo LRCLIB en las políticas CSP aplicables. Preparar el código no cambia esa decisión ni autoriza otros proveedores. Después sigue siendo necesaria la aceptación local del usuario en la interfaz; quitarla aborta la operación y descarta el resultado transitorio.

## Evidencia separada

- R57: diez grupos unitarios y seis de Chromium con respuestas sintéticas, sin API real.
- R58/R60/R61: fallo de retirada de cuerpo reproducido, corregido y revisado con Response/ReadableStream nativos de Node y transporte inyectado; no se demostró fuga de fetch nativo Chromium.
- R59: nueve grupos de componente Chromium sobre adaptador corregido; respuesta lenta y espera posterior comprobadas. No equivale a integración en el reproductor.
- R62: once grupos del producto integrado PASS, un control deshabilitado sin transformar y casos habilitados TESTONLY con red interceptada. Prioridad local/manual, audio/cola, descarte tardío, cancelación y cambio de generación DB comprobados; sin API real. Recibo final y cinco hashes cotejados por el padre.
- R63/R65: pilotos públicos fallidos. OPTIONS nativo recibió 502 Cloudflare sin ACAO y Retry-After60; GET de red cero en ambos. El segundo intento ocurrió tras221,688s. No más reintentos automáticos. Se transmitió la consulta sintética completa en la URL del OPTIONS, aunque el GET no salió. El valor de Lrclib-Client no se envió, sólo su nombre en el preflight. D08 debe bloquear antes de fetch. No datos de biblioteca privada ni aceptación CORS de producción.
- R64: revisión de código favorable limitada, sin nuevos P1/P2 y un grupo Node propio de21 aserciones. Su condición de navegador queda satisfecha por R62final con hashes idénticos, sin repetir suites. No concede activación D08.

No hay aceptación física iPhone, offline de letras externas ni P0-W completo por estos incrementos. Se mantienen USD 0 y ODD + Engram local verificable.


Cotejo final del padre: `.local/evidence/lrclib-prepared-parent-verification.json` fija los recibos R57/R58/R60/R61/R59/R62/R64/R63/R65 y el snapshot preparado. La condición de navegador de R64 queda satisfecha por R62final11/11 y las cinco fuentes idénticas. No se actualizó la copia privada con este incremento deshabilitado. El objetivo completo continúa por T10 sin esperar al proveedor ni reintentar automáticamente.
