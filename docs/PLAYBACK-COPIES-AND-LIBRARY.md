# Escuchar, Biblioteca y playlists

Elegir una canción intenta reproducirla con una copia completa verificada del navegador. Si esa copia ya existe e íntegra, se reutiliza sin consultar de nuevo al bot. Escuchar no añade automáticamente la canción a Biblioteca.

Junto a la canción elegida aparecen el estado, el progreso o el error y las acciones disponibles:

- **Agregar canción** incorpora su ficha a Biblioteca sin volver a descargar el audio.
- **Añadir a playlist** permite elegir una lista y confirmar. Reutiliza la copia y no incorpora por sí sola la canción a Biblioteca.
- **Reproducir** permite un nuevo intento explícito con la copia preparada. Si el navegador rechazó el inicio por falta de gesto, se indica esa situación. Otros fallos no se presentan como falta de gesto.

Cambiar de canción cierra el selector de playlist anterior e invalida sus callbacks. Cancelar, perder autoridad o una acción posterior del reproductor impiden el Play pendiente, sin prometer deshacer una escritura que ya haya ganado su commit.

## Persistencia

La pertenencia está separada de Track y del archivo físico mediante un registro cerrado en settings. La ausencia de registro conserva el significado de las fichas antiguas: pertenecen a Biblioteca. Las nuevas copias obtenidas sólo para escuchar publican su marcador `added:false` en la misma transacción que la ficha y su recibo; recovery conserva esa intención. La acción explícita cambia el marcador a `true` de forma idempotente. Una importación explícita de los mismos bytes también puede promover una copia previa; la deduplicación de escucha no oculta una canción ya añadida.

La biblioteca, Inicio y sus recuentos filtran por pertenencia. La cola, las playlists, la reutilización de copias y Almacenamiento mantienen las referencias internas completas. No hay migración de versión de IndexedDB ni retirada retroactiva de canciones antiguas.

## Espacio y copias de seguridad

Una canción fuera de Biblioteca todavía puede ocupar espacio. Configuración → Almacenamiento incluye esas copias y permite la retirada explícita elegible, protegiendo reproducción, cola, lectores y operaciones pendientes. No hay borrado automático de copias por no pertenecer a Biblioteca. No se exporta otro archivo a Archivos ni se almacena audio en Cloudflare; la caché de la app nativa Telegram es independiente.

La exportación de organización omite copias de escucha sin favoritos ni playlists. Si incluye una canción organizada que sigue fuera de Biblioteca, usa el formato de backup v3 con `inLibrary:false`; restaurarlo conserva esa elección y no crea audio. Los backups sin ese caso siguen siendo v2. El lector conserva v1/v2 y su significado previo; versiones anteriores del programa pueden rechazar v3. La previsualización y sus decisiones mantienen CAS y la pertenencia se escribe junto con el recibo.

## Evidencia y límites

La evidencia versionada está en [evidence-playback-library-web.json](evidence-playback-library-web.json). Los escenarios integrados usan SDK sintético en un worker nativo y archivos propios. El caso de rechazo `NotAllowedError` inyecta ese fallo deliberadamente; no acredita la política real de Safari. La reproducción con la cuenta Telegram del propietario y la aceptación física en iPhone siguen pendientes. El estado visible y las pruebas locales no diagnostican por sí solos el fallo informado en su teléfono.
