# T27 · Inicio rápido del audio ya descargado

- **Estado:** validación en curso.
- **Código base:** `f803135`. Referencia de rendimiento publicada: v62, código `f97ebb5`.
- **Método:** ODD, §I.assets, §I.media, §I.player, §I.queue y §V.2 del SPEC. Invariantes V2, V8, V10–V19, V24, V28, V30–V31.

## Objetivo y requisitos

Quitar del camino al primer sonido las lecturas y el SHA-256 de toda la cola. En v62, la investigación encontró entre 1.188 y 1.884 ms para una pista de 8 MiB desde una playlist. Una selección de 30 por IDB tomó 14.488 ms. La misma selección por OPFS venció el plazo de 30 s sin llegar a sonar.

| Requisito | Aceptación |
| --- | --- |
| P01 | Desde el toque hasta el evento nativo `playing`, reducir la mediana ≥50 % frente a v62 con el mismo arnés, en Chromium y WebKit, con IDB y OPFS. |
| P02 | En una playlist de 30 pistas descargadas, reproducir primero la ocurrencia tocada dentro del plazo de 30 s y con una latencia comparable a una pista sola. Verificar las demás antes de su propia reproducción, sin precargar su audio. |
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
| P02 | B · `cold-start`, escenario de 30 pistas, clic en la #15, plazo de 30 s y una sola carga inicial | Pendiente | Pendiente |
| P03 | B · `skip-corrupt`, byte cambiado, truncamiento y hash distinto en la pista 1 y en la pista 2 tras arrancar la 1 | Pendiente | Pendiente |
| P03 | U · `player.test.ts`, descarta avisos de selección anterior, limita una pasada y conserva pausa al restaurar | Pendiente | Pendiente |
| P04 | B · `selected-offline-next`, MediaSession en una cola ya descargada y salto offline desde la pista 2 | Pendiente | Pendiente |
| P04 | B · matriz funcional, reanudación, avisos, splash y rangos. U · baterías de cola y bots. | Pendiente | Pendiente |
| P05 | B · `cold-start` y `selected-offline-next`, lecturas de chunks/Blob en página hasta `playing` y número de fuentes cargadas | Pendiente | Pendiente |

El arnés usa perfiles nuevos, cuenta y audio sintéticos, el bundle con su SW local, viewport 390 × 844 y una serie por revisión/motor/backend. Comprueba `uptime` y carga de un minuto < 1,5 antes de cada serie. Cada caso registra muestras, mediana, mínimo, máximo y vencimientos. La aceptación en iPhone físico se mantiene **NO EJECUTADA**.
