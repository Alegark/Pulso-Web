# Organización portable: contrato de implementación

Diseño T16 r1, revisión estática de código; no aceptación de W15/AC17. Las unidades de formato y reconciliación están en curso. SPEC canónico conserva autoridad. Sin cambios de versión IDB: ampliaciones aditivas sobre v2.

La identidad portable de una ficha/playlist es `{libraryId, id}` con UUIDs. La biblioteca local conserva su UUID en una clave propia; una entidad restaurada conserva `organizationRef` original al reexportar. `exportId` identifica una exportación, nunca una canción. Título, artista y nombre de archivo no se usan para fusionar.

DTO v1 cerrado: `format`, `version`, `exportId`, `libraryId`, `exportedAt`, `tracks`, `favorites`, `playlists`. Track exportado contiene `ref`, título/artista/álbum, duración declarada, fecha, overrides coherentes y `audio` nulo o `{algorithm:'sha256', sha256, bytes}`. Playlist contiene `ref`, nombre y entradas ordenadas `{id, track:ref}`. Favoritos son referencias únicas. Grupos de álbum/artista se derivan de las etiquetas. Serialización campo a campo; no volcado de IndexedDB.

Se excluyen audio, imágenes, letras, sesiones, credenciales, tickets, Object URLs, storage keys, localizadores privados, jobs, ownership, cola y preferencias. Metadata restaurada no demuestra disponibilidad de bytes. Una ficha restaurada sin copia tiene `assetId:null` y conserva su organización. La huella, si existe, identifica bytes exactos; no identidad musical. Una ficha antigua sin manifiesto/huella se puede preservar con audio nulo y advertencia de que no se reconciliará automáticamente.

Reimportar un original verificado enlaza todas las fichas pendientes con la misma huella y longitud. Cada ficha conserva su ID, referencia portable y organización vigente. Una sola copia física puede satisfacer varias fichas distintas; no se fusionan. La lógica pertenece a la publicación compartida por importación, recuperación y deduplicación; no solo al parser. Se releen fichas en la transacción final y se conservan ediciones posteriores al inicio del trabajo. No se fabrica un manifiesto para un backup ni se usa cleanup para borrar kept.

Conflictos: misma identidad con contenido distinto conserva local por defecto; preview permite usar organización del backup por entidad. Locales ausentes del backup se conservan. Igual huella con referencias distintas son fichas distintas. Colisión del UUID local con identidad diferente requiere remapear. Misma identidad con huellas conocidas diferentes bloquea aplicación; no sustituye audio silenciosamente. Entradas de playlist no duplican TrackRef, como el contrato actual; la cola conserva sus ocurrencias por separado.

Límites iniciales: JSON UTF-8 8 MiB, 5000 fichas, 500 playlists, 50000 entradas totales, 300 caracteres por campo musical y 100 por nombre de lista; UUID/huella/fechas/relaciones estrictos. Validar también el resultado combinado y la base local. Un exceso no produce truncación. Campos inesperados, versión futura y relaciones inválidas se rechazan. Texto hostil se representa como texto; ningún campo se convierte en ruta, URL o HTML.

El siguiente módulo de almacenamiento hará snapshot consistente de las entidades/dependencias en una transacción readonly acotada. Preview calcula remapeos/decisiones fuera de IDB y mantiene un plan privado en memoria; el UI recibe identificador, conteos, conflictos y avisos. No mantener lock mientras la persona revisa. Apply adquiere writer lock, comprueba importaciones inciertas y revalida base antes de escribir en una sola transacción breve. Toda divergencia relevante invalida el preview; tema/posición de reproducción no lo invalidan. No IO/parser/hash dentro de IDB.

Un recibo propio se confirma en el mismo commit que las entidades. Cuota/abort/corte antes de commit no aplica parcialmente. Si se pierde confirmación, reabrir y consultar recibo antes de repetir. Cancelación posterior a commit conserva resultado confirmado. Si no se puede comprobar el resultado, estado incierto y reintento suspendido. No altera bytes/cola/audio activo.

Pruebas pendientes del incremento completo: roundtrip y segunda aplicación; origen limpio sin bytes; reimportación IDB/OPFS y recuperación; varias identidades con huella igual; variantes; conflictos y colisiones; preview obsoleto; JSON/versiones/relaciones/límites; cuota/abort/cortes/acuse perdido; exclusión de secretos y efectos sobre engine/cola/kept. Esta lista es trabajo pendiente, no resultados ejecutados.

## Implementación posterior r9

Contrato implementado y probado en las suites concretas de evidence-organization-web.json. Una huella de backup conocida rellena huecos de la ficha local aunque conserve sus metadatos; jamás crea bytes. La inspección tiene motivo original-library-unavailable y startOrganizationRecovery permite nuevo intento consciente en otra encarnación, conservando UNKNOWN anterior por separado. Misma encarnación con recibo inválido no ofrece ese bypass. Nueva preview representa nueva intención; retries del mismo plan son idempotentes. Límites y exclusiones se mantienen. Esta actualización no declara íntegramente aceptado P0-W ni transforma las pruebas desktop en móvil.


## Evolución v2 · R66/R68

El exportador vigente genera v2 con localAlbum explícito y nullable. El lector, serialización y digest v1 se conservan estrictos. Antes de confirmar, preview avisa si Usar copia retiraría datos automáticos nuevos; Conservar local los mantiene. No se incluyen bytes, no se cambia versión IDB ni se promete compatibilidad del lector antiguo con v2. Contrato y etapas verificadas: [ALBUM-METADATA.md](ALBUM-METADATA.md). Los párrafos v1 anteriores conservan la historia de diseño.


## 2026-11-06 · Pertenencia explícita y copia de escucha

[Escuchar, Biblioteca y playlists](PLAYBACK-COPIES-AND-LIBRARY.md) describe el contrato vigente: escuchar conserva una copia verificada sin añadir automáticamente la canción; las acciones próximas a la elección permiten agregarla o confirmar una playlist sin otra descarga. Backups v3 condicionales conservan la pertenencia de canciones organizadas; v1/v2 siguen admitidos. La reproducción con la cuenta real y el iPhone permanece pendiente.
