# Fuente de canciones y álbumes

Decisión del propietario, 2026-11-01: el producto es Pulso Web, abierto en Safari u otro navegador. Las canciones y los álbumes se buscarán y obtendrán desde las fuentes autorizadas de Telegram. La interfaz principal no ofrecerá importar audios desde el teléfono ni cargar muestras musicales como alternativa.

Esta instrucción sustituye el requisito anterior de importación local de canciones en la interfaz. README y SPEC conservan el handoff original; esta decisión posterior queda registrada aquí y en ODD.

La versión actual ofrece el inicio de sesión temporal con Telegram, pendiente de validación real por el propietario. La búsqueda y descarga todavía no están integradas; no se muestran resultados ni descargas simuladas. Retirar el selector de archivos no equivale a completar Telegram.

Se conservan las pistas, favoritos, playlists, audios y registros de operaciones de versiones anteriores. La reproducción y la recuperación de copias existentes siguen disponibles. Quitar una copia advierte que la versión actual todavía no puede volver a descargarla desde Telegram.

Los módulos de lectura de audio, hashing, almacenamiento, metadatos y recuperación permanecen para reutilizarse cuando el transporte entregue bytes desde Telegram. Las fixtures de desarrollo y las pruebas internas no son una fuente del producto. Los backups de organización y las letras tienen contratos separados; esta decisión elimina la entrada de archivos de audio.

El objetivo de descarga es conservar una copia verificada en el dispositivo donde se utiliza Pulso. La validación completa de almacenamiento y reapertura sin conexión en iPhone sigue pendiente. No se ha creado una app nativa de iOS. La identidad API está configurada en privado y el acceso temporal requiere una acción explícita. No hay una cuenta autenticada confirmada ni fuentes remotas integradas.

Entrega `c543e9f0a1a173d3`: tres comprobaciones locales y tres en el acceso privado, sobre producción sin transformar, verifican ausencia de la entrada de audio y conservación de datos anteriores/reproducción continua. Tipos/lint/build y60 unitarias focales PASS. Rangos/HEAD/integridad/403/reinicioSW/reapertura Chromium offline en IDB/OPFS y actualización normal desde34de PASS, con fixtures internas. Los tests históricos que dependían del selector de audio deben adaptar su setup; no son evidencia actual sin esa adaptación. Evidencia: [evidence-telegram-only-audio.json](evidence-telegram-only-audio.json).


Entrega `4d459aa4c10b6bb6`: acceso temporal preparado con cliente SDK real y almacenamiento en memoria. Los tests positivos de código/2FA son sintéticos; no se convierten en aceptación de cuenta real, fuentes o descarga. Contrato de acceso y límites en [TELEGRAM-SETUP.md](TELEGRAM-SETUP.md).
