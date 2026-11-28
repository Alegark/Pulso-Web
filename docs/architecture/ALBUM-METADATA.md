# Datos automáticos de álbum

Entrega web `/releases/c44e797fff04a757.html`. El SPEC original se conserva; la instrucción posterior del propietario elimina los editores de canciones de la interfaz. T10 y P0-W siguen sin aceptación completa.

Los archivos nuevos MP3/WAV-ID3 y M4A pueden aportar número de pista, disco, artista de álbum y compilación. La vista los identifica como **datos declarados en el archivo**: no demuestra autenticidad, una edición comercial ni álbum completo. Ausencia, contradicción, invalidez y exceso de presupuesto quedan desconocidos sin invalidar por sí solos el audio verificado.

`Track.localAlbum` es opcional, versionado y contiene fuentes automáticas con evidencia. No hay editor nuevo ni migración IDB. Se preservan las fichas, correcciones históricas y fuentes restauradas. Reimportar bytes iguales conserva la ficha existente: este incremento no reinspecciona ni enriquece automáticamente la biblioteca anterior.

Ordinales estrictos de 1 a 65535, con total coherente; M4A conserva sus 16 bits. Se reutilizan los recorridos y límites de metadata existentes. Los 4 KiB del registro normalizado no garantizan heap ni acotan el clon nativo de un registro arbitrario de IndexedDB.

El detalle de un álbum conocido ordena establemente por disco y pista, dejando desconocidos al final, antes de paginar o preparar toda la cola. Conserva ocurrencias repetidas. Artistas, todas las canciones, álbum desconocido y playlist original mantienen su orden. Agrupación NFC y totales declarados siguen siendo provisionales.

El exportador genera backup **v2**, con `localAlbum` explícito y nullable. Conserva el lector estricto, la serialización y el digest v1. Rechaza versiones futuras. La vista previa advierte antes de confirmar si «Usar copia» retiraría datos nuevos; «Conservar local» los mantiene. Organización excluye audio, portadas, letras, cola y sesiones. Un binario que sólo entiende v1 no se considera lector de v2.

Evidencia separada por etapa:

- R66: 32 unitarias —8 nuevas y 24 regresiones—, 10 grupos Chromium IDB/OPFS, tipos y lint PASS.
- R68: 11 grupos de producto PASS. Importación de cinco audios propios, orden, cola de 64 ocurrencias, lote completo, backups v1/v2, restauración y audio único. Las 1000 fichas sintéticas no representan extracción de 1000 audios.
- R69: revisión favorable limitada, cuatro probes Node propios y 16 hashes congelados cotejados. Su condición de navegador queda satisfecha por R68 final.
- Producto: assets y rangos IDB/OPFS, seis grupos de teclado, tres de licencias y actualización normal desde la entrega anterior. HTTPS privado: importación MP3 propio con tags, vista y backup v2, motor único, exportación individual exacta y handoff pausado PASS.

R68 detectó desbordamiento nativo de `progress` a 320 px con fuente al 200%: 10em excedía el contenedor. El máximo inline ahora respeta el contenedor; se conservan RED y GREEN. Fuente ampliada en Chromium no demuestra zoom físico ni VoiceOver.

Recibos: `.local/evidence/album-source-r66.json`, `album-main-r68.json`, `album-source-review-r69.json`, `album-delivery-parent-verification.json`. Runner focal: `INSTABOX_HEADLESS=1 node tests/integration/check-album-main.mjs`; genera un build aislado. No es necesario repetirlo para leer la evidencia existente.

LRCLIB sigue desactivado tras dos preflights públicos fallidos; no valida estas etiquetas. MusicBrainz/CAA no están integrados como identificador de la biblioteca. El acceso privado usa Blob acotado a 8 MiB por archivo/24 MiB por cola; no tiene aceptación offline. iPhone, zoom real, VoiceOver y P0-W siguen pendientes. USD 0.
