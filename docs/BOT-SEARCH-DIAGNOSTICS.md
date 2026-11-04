# Diagnóstico D1 de respuestas del bot

El aviso genérico de límite volvió a aparecer en el teléfono del propietario después de la entrega `bdfa17d42a6aad8b`. Las pruebas sintéticas anteriores no identifican la forma real de esa respuesta. La causa y la reproducción física siguen pendientes; D1 añade identificación del rechazo, no una reparación demostrada de ese caso.

Cuando una guarda rechaza la consulta o respuesta, la interfaz muestra un código cerrado, la entrada pública de 16 caracteres del documento y `diagnóstico D1`. No muestra ni registra consulta, cuenta, peer, mensajes, botones, bytes, URL privada ni credenciales. No añade telemetría, peticiones ni reintentos. La entrada se obtiene sólo del pathname `/releases/<hash>.html`; fuera de esa ruta indica `local`.

| Código | Guarda |
| --- | --- |
| L00 | Límite genérico compatible con versiones anteriores |
| L01 | Identificadores de petición emitidos por el driver |
| L02 | Consulta o expectativa musical no admisible |
| L03 | Presupuesto aproximado de bytes decodificados de una respuesta |
| L04 | Nodos del objeto decodificado |
| L05 | Profundidad del objeto decodificado |
| L06 | Referencia de objeto repetida durante el recorrido |
| L07 | Campo binario incidental demasiado grande |
| L08 | Propiedades o posiciones del objeto decodificado |
| L09 | Forma o cantidad del historial inicial |
| L10 | Forma o cantidad del historial posterior |
| L11 | Reservado; el reconocimiento del ACK conserva su conducta anterior |
| L12 | Filas del teclado del bot |
| L13 | Botones por fila |
| L14 | Candidatos proyectados |
| L15 | Presupuesto decodificado acumulado de toda la operación |
| L16 | Forma o cantidad de atributos del documento |

D1 conserva los umbrales, las validaciones de identidad y correlación, la incertidumbre, el asentamiento y la primera causa. No permite otro envío por haber identificado un límite. Se conserva el error `limit` del proyector y se transporta sólo una variante enumerada; los campos adicionales de texto libre y códigos no reconocidos se rechazan.

Una consulta fallida deja de presentar «Buscando el archivo…» como estado activo. Para identificar la causa en el dispositivo basta comunicar el código y la entrada pública. No se necesitan chats, códigos de acceso ni consola sin filtrar.

La evidencia local de D1 está en `docs/evidence-bot-limit-diagnostics-web.json`. El ensayo nuevo usa un campo binario sintético rechazado por una guarda real y verifica worker, cliente e interfaz; no acredita que ésa sea la causa del fallo del propietario.
