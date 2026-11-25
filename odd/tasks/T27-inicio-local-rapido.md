# T27 · Inicio rápido del audio ya descargado

- **Validación en curso.**
- Código base `f803135`. Referencia de rendimiento v62 (`f97ebb5`).
- ODD, §I.assets, §I.media, §I.player, §I.queue y §V.2 del SPEC. Invariantes V2, V8, V10–V19, V24, V28, V30–V31.

## Objetivo y requisitos

Quitar del camino al primer sonido las lecturas y el SHA-256 de toda la cola. En v62, la investigación encontró entre 1.188 y 1.884 ms para una pista de 8 MiB desde una playlist. Una selección de 30 por IDB tomó 14.488 ms. La misma selección por OPFS venció el plazo de 30 s sin llegar a sonar.

| Requisito | Aceptación |
| --- | --- |
| P01 | Desde el toque hasta el evento nativo `playing`, reducir la mediana ≥50 % frente a v62 con el mismo arnés, en Chromium y WebKit, con IDB y OPFS. |
| P02 | En una playlist de 30 pistas descargadas, reproducir primero la ocurrencia tocada dentro del plazo de 30 s. El arnés concreta «comparable» como una mediana de hasta dos veces la de una pista sola. Verificar las demás antes de su propia reproducción, sin precargar su audio. |
| P03 | Verificar longitud y SHA-256 antes de entregar bytes de cada pista. Ante corrupción confirmada, saltar automáticamente esa ocurrencia, conservar organización y evitar ciclos infinitos. |
| P04 | Preservar T24, T25, la reanudación, el audio offline y el avance, MediaSession, los rangos HTTP 206 y el comportamiento de los avisos del reproductor de v61/v62. |
| P05 | Mantener memoria de audio acotada e independiente de cuántas pistas contiene la playlist. |

## Implementación

- La cola fija los manifiestos en una lectura IDB por lote. Cada ticket sigue ligado al cliente, al owner y al manifiesto exacto. La comparación con la huella de la ficha, cuando existe, omite referencias que no coinciden. Se carga directamente la ocurrencia tocada. Buscar comprueba presencia antes de preparar la cola y el transporte verifica el audio.
- El Service Worker entrega bytes después de verificar longitud, SHA-256 y manifiesto de la pista seleccionada bajo el bloqueo compartido de su generación. Las siguientes peticiones de rango de esa selección comprueban sus chunks con las huellas de esa pasada. La siguiente selección tiene una URL distinta aunque use el mismo ticket. Track, playlist, descargas y posición se conservan. La caché de huellas se vacía al invalidar la base y se reconstruye después de reiniciar el Worker.
- Los fallos confirmados se comunican desde el controlador vigente y se correlacionan con la URL exacta en uso. Las ocurrencias fallidas se omiten en el orden de la cola y una pasada agotada se detiene. Una selección restaurada permanece pausada. Cuando el controlador admite verificar al leer, la restauración comprueba presencia y difiere el SHA-256.
- El escaneo entrega chunks de 64 KiB y usa lecturas de hasta 1 MiB por lote de OPFS o IDB. La caché conserva hasta 16 listas de huellas de 32 bytes por chunk. El fallback Blob y la admisión de inserciones conservan sus verificaciones y límites.

## Matriz

| Requisito | Nivel y prueba | `f803135` | Candidato |
| --- | --- | --- | --- |
| P01 | B · `check-local-playback.mjs`, serie `cold-start`, escenario de una pista de 8 MiB | Pendiente | Pendiente |
| P02 | B · `large-playlist-start`, 30 pistas de 8 MiB, clic en la #15, plazo de 30 s y una sola carga | 0/4. Chromium agota el plazo en ambos backends. WebKit hace dos cargas en ambos. | 4/4. En los cuatro perfiles empieza por la #15 dentro del plazo con una carga. La comparación de medianas continúa pendiente. |
| P03 | B · `skip-corrupt`, byte cambiado, truncamiento y hash distinto en la pista 1 y en la pista 2 tras arrancar la 1 | 0/24 en la matriz de salto. | 6/6 en ambos backends de Chromium y en IDB de WebKit. OPFS de WebKit confirmó cinco casos limpiamente. En el byte cambiado intermedio registró la pista 10 y la 12 dos veces, sin que sonara la 11. El arnés agrupa eventos `playing` consecutivos del mismo recurso y ese reintento específico queda pendiente. |
| P03 | U · `player.test.ts`, descarta avisos de selección anterior, limita una pasada y conserva pausa al restaurar | 0/2 | 2/2 |
| P03, P04 | B · `check-sw-media-ranges.mjs`, solicitud inicial fuera del bloque alterado con otra selección del mismo manifiesto | 206 indebido en IDB y OPFS. Pasan los controles de rango y alcance. | 409 en IDB y OPFS. Pasan los controles de rango y alcance. |
| P04 | B · `selected-offline-next`, MediaSession en una cola ya descargada y salto offline desde la pista 2 | 0/4 en el caso combinado de carga única y avance. | 4/4 en el control focal. La acción `nexttrack` avanzó al siguiente audio sin red. |
| P04 | B · matriz funcional, reanudación, avisos, splash y rangos. U · baterías de cola y bots. | Splash 7/7 por motor. Los rangos válidos pasan. Intentos restantes afectados por fallos y plazos de navegador. | Splash 7/7 por motor en la repetición. Los rangos válidos y las unitarias pasan. Las demás matrices aún carecen de una comparación limpia. |
| P05 | B · `large-playlist-start` y `selected-offline-next`, lecturas de chunks/Blob en página hasta `playing` y número de fuentes cargadas | 0/4 en la prueba con 30 entradas. | 4/4 con 30 entradas, cero lecturas de audio en el hilo principal y una sola fuente cargada. |

El arnés usa perfiles nuevos, cuenta y audio sintéticos, el bundle con su SW local, viewport 390 × 844 y una serie por revisión/motor/backend. Comprueba `uptime` y carga de un minuto < 1,5 antes de cada serie de rendimiento. Cada serie registra muestras, mediana, mínimo, máximo y vencimientos. El control funcional de 30 pistas registra si se cumple el plazo, la pista elegida, las cargas y las lecturas. La aceptación en iPhone físico se mantiene **NO EJECUTADA**.

Pasaron 1.043 pruebas unitarias, ambos typechecks, lint, el build, 73 pruebas de servidor y 10 de Python. Resultados locales en `.local/test-evidence/t27/`. La copia aislada de Engram se contrastó con los 20 documentos de v62. El recibo de T8 corresponde a v62 y difiere por el commit de splash `f803135`. El almacén compartido conserva sus datos y recibos.
