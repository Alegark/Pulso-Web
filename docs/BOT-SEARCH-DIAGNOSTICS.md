# Diagnóstico D1 de respuestas del bot

El propietario identificó el rechazo como `L15` sobre la entrada D1 `e22c29994e87deca`: se había aplicado el presupuesto de una respuesta al total acumulado del recorrido. No se ha leído ni conservado el contenido de esa respuesta real. La corrección separa el presupuesto por respuesta del de la operación; la comprobación final con el bot real y el teléfono sigue pendiente.

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
| L15 | Presupuesto total o número máximo de respuestas de metadatos de la operación |
| L16 | Forma o cantidad de atributos del documento |

La entrega D1 original `e22c29994e87deca` conservaba los umbrales, las validaciones de identidad y correlación, la incertidumbre, el asentamiento y la primera causa. No permite otro envío por haber identificado un límite. Se conserva el error `limit` del proyector y se transporta sólo una variante enumerada; los campos adicionales de texto libre y códigos no reconocidos se rechazan.

Una consulta fallida deja de presentar «Buscando el archivo…» como estado activo. Para identificar la causa en el dispositivo basta comunicar el código y la entrada pública. No se necesitan chats, códigos de acceso ni consola sin filtrar.

La evidencia local de D1 está en `docs/evidence-bot-limit-diagnostics-web.json`. El ensayo nuevo usa un campo binario sintético rechazado por una guarda real y verifica worker, cliente e interfaz; no acredita que ésa sea la causa del fallo del propietario.


## Corrección del presupuesto L15

`rawBytes = 65536` se mantiene para cada respuesta de metadatos. La operación completa dispone del número máximo de respuestas que ya permitía su recorrido: búsqueda, identidad + historial inicial + ACK + hasta 16 lecturas = 19; descarga desde un botón, identidad + tres lecturas exactas de mensaje + historial inicial + ACK del callback + hasta 60 lecturas = 66. También se controla el contador y el coste acumulado, con techos respectivos de 19 × 64 KiB (1.1875 MiB) y 66 × 64 KiB (4.125 MiB). No se aumenta el número de consultas, el tiempo ni la cantidad de mensajes leídos por consulta.

Es un límite aproximado del trabajo decodificado, no de bytes de red, WASM o memoria máxima. Las respuestas son secuenciales y no se conserva un historial bruto. Los bytes del archivo siguen su límite independiente de 8 MiB, partes de 64 KiB y plazo de 120 segundos. Las guardas por respuesta de profundidad, nodos, propiedades, referencias, binarios y forma del teclado siguen intactas. Una respuesta individual sobredimensionada continúa devolviendo L03 aunque las anteriores fueran pequeñas.

Una reproducción sintética del recorrido completo da L15 en el código D1 anterior, y el nuevo código completa seis lecturas de progreso/menú/audio, un envío, un callback y una copia verificada reproducible. La repetición posterior usa la copia local sin otro RPC. Esto comprueba el arreglo del presupuesto; no sustituye la prueba física del propietario. Evidencia: `docs/evidence-bot-l15-budget-web.json`.
