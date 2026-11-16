# Pulso en Cloudflare

## Pruebas funcionales sobre la web publicada · 2026-11-14

Por instrucción del propietario, las siguientes pruebas funcionales y visuales se realizan en la página publicada de Cloudflare y registran dominio y entrada de release exactos. Las unidades y fixtures locales sirven de apoyo; no sustituyen ese recorrido ni se declaran como prueba de la web pública. La sesión, música y organización del propietario se conservan; las mutaciones de prueba usan datos propios identificables y el alcance autorizado.

El propietario autorizó el cambio de toda la cuenta de `publiex` a `pruebassoftware`, incluidos los otros Workers con workers.dev habilitado. El renombrado ya está aplicado mediante el MCP oficial; no se borró ni recreó el subdominio, ni se modificaron código, bindings o flags de los Workers. La comprobación HTTPS posterior se registra por separado en [la evidencia del cambio](evidence-cloudflare-domain-web.json). El nuevo origen requiere iniciar sesión allí y no migra automáticamente IndexedDB/OPFS del anterior.

## Acceso Telegram por QR · versión actual

La entrada directa actual es [9006dcecc26d4049](https://pulso-web.pruebassoftware.workers.dev/releases/9006dcecc26d4049.html), con las [correcciones probadas en la sesión real](evidence-published-session-repair-web.json). Conserva **Configuración → Cuenta y fuentes → Entrar con Telegram o QR**. Escanea y aprueba desde Telegram del teléfono, en Ajustes → Dispositivos → Vincular dispositivo; después pulsa **Ya autoricé el acceso** en Pulso. La contraseña de dos pasos, si corresponde, se introduce sólo en Pulso. Véanse [persistencia](TELEGRAM-PERSISTENCE.md) y [evidencia original del QR](evidence-telegram-qr-login-web.json).

Se verificaron 45 rutas públicas por bytes/SHA, los bindings conservados y la generación de un QR real, sin aprobar una cuenta. No se modificó el secret ni se añadió una migración, pago o recurso. La recepción de códigos y el límite429 del catálogo siguen pendientes.

El staging puede conservar candidatos intermedios que nunca se publicaron. El manifiesto de despliegue de esta actualización selecciona el dist actual más los inmutables de publicaciones confirmadas: 47 archivos, incluidos dos metadatos no servidos. Excluye tres rutas intermedias, comprobadas404. Un futuro despliegue debe conservar los inmutables publicados y excluir esos candidatos sin publicar; no basta con subir todo el staging acumulado.

Pulso está publicado en **https://pulso-web.pruebassoftware.workers.dev** con acceso público autorizado por el propietario. La cuenta se conectó al MCP oficial mediante OAuth. El propietario confirmó **Workers Free**; la facturación no se pudo consultar mediante esos permisos OAuth. No se activaron planes de pago ni dominios comprados. `workers_dev: true` y `preview_urls: false` son la configuración vigente.

## Arquitectura

Actualización2026-11-15: las consultas de metadatos iTunes se hacen directamente desde el navegador, donde se verificó HTTP200 y CORS legible. El egress de Cloudflare estaba devolviendo429; no se añade un reintento automático tras ese error. `/catalog-config.json` anuncia `itunes:false,artwork:true`. El transporte comparte una cola y cadencia mínima3,1s entre metadatos directos, cancelación y cooldown429/503; el relay acotado sigue sirviendo las imágenes. Los endpoints anteriores de metadatos permanecen para compatibilidad, pero ya no son la vía anunciada al frontend.

Las respuestas del shell guardadas después de una redirección se reconstruyen al servirlas desde caché, conservando cuerpo, estado y cabeceras. Esto evita el fallo de navegación observado al activar una versión nueva de Cloudflare. El worker se comprueba con `updateViaCache:none`; se mantiene la activación por cierre normal de clientes, sin `skipWaiting`, unregister, borrar cachés o eliminar IndexedDB. Se verificó reapertura con sesión, bots, música y playlist conservados.

- Worker con Static Assets sirve el frontend, service worker y fuentes/licencias de Telegram. Los assets ordinarios se sirven directamente; HTML, SDK worker, SW y endpoints pasan por el Worker para conservar sus políticas.
- `/catalog-config.json`, `/catalog/itunes/search`, `/catalog/itunes/lookup` y `/catalog/artwork` conservan el contrato del prototipo. Sólo GET públicos de metadatos iTunes US y PNG/JPEG/WebP de cinco hosts Apple admitidos; sin JSONP, hosts arbitrarios, redirecciones, audio ni credenciales reenviadas.
- Un Durable Object SQLite coordina todas las consultas al proveedor: mínimo 3,1 segundos entre metadatos, cooldown compartido, 8 cargas originales como máximo, plazo de 10 segundos y caché RAM hasta 32 MiB/5 minutos. Sólo persisten dos timestamps de cuota; ni consultas ni resultados se escriben en su base. Las respuestas están limitadas a 1 MiB de JSON y 2 MiB por imagen.
- Música, organización local y sesión Telegram permanecen en el navegador. No se conecta Neon, Firebase, R2 ni una base de usuarios por esta entrega.
- `/telegram-config.json` lee `TELEGRAM_API_IDENTITY` desde un secret de Worker y devuelve únicamente la identidad de aplicación que necesita el SDK del navegador. Esos valores son legibles por los visitantes autorizados de la web; el secret evita meterlos en Git, artefactos o variables de build, pero no convierte una identidad de aplicación cliente en un secreto inaccesible al navegador. No contiene sesiones, auth keys, códigos ni contraseñas Telegram.

## Preparación local

```sh
npm ci
npm run test:cloudflare
npm run build:cloudflare
npx wrangler deploy --dry-run --outdir .local/cloudflare-setup/dry-run
npx wrangler dev --local --ip 127.0.0.1
```

El build de Cloudflare se realiza en `.local/cloudflare-setup/build-root`; la salida revisable está en `.local/cloudflare-setup/site` y su manifiesto en `site-manifest.json`. No sustituye `dist` de la entrega anterior ni copia el archivo privado de identidad Telegram. Wrangler y su estado local son herramientas de desarrollo, sin inclusión en el bundle de la app.

## Publicación y futuras actualizaciones

La vía solicitada por el propietario es el MCP oficial de Cloudflare: `https://mcp.cloudflare.com/mcp`, configurado en `.codex/config.toml` sin credenciales. OAuth queda en el almacén privado del cliente; no en el repositorio. Conectar un cliente nuevo requiere autorizar esa cuenta mediante su flujo OAuth. El MCP no pudo consultar Billing; no se debe inferir el plan a partir de `default_usage_model`.

El despliegue del 2026-11-13 creó únicamente `pulso-web`, después de comprobar que el nombre estaba libre. Los Workers anteriores no se sustituyeron. El MCP creó la sesión de assets, cargó el Worker y la migración SQLite, vinculó el secret de identidad de aplicación y habilitó la URL pública con previews desactivadas. La subida de los bytes usó el endpoint oficial Direct Upload con el JWT temporal emitido por esa sesión MCP: el proxy del MCP añade su propia cabecera Authorization y no permite usar correctamente ese JWT dentro de `execute`. No se utilizó Wrangler para desplegar remotamente ni se pidió un API token adicional. El token de carga y la identidad de aplicación se mantuvieron fuera de los logs y recibos.

Para actualizar:

1. Mantener Workers Free, sin activar recursos de pago. Preparar el candidato con `npm run build:cloudflare` y validar el manifiesto y las pruebas antes de mutar recursos remotos.
2. Leer el Worker y la versión actuales mediante MCP. En una actualización, comprobar que son los de Pulso; no volver a aplicar una migración inicial ni sobrescribir otros servicios.
3. Registrar el manifiesto completo en `assets-upload-session` mediante MCP; transferir sólo los hashes solicitados con su JWT temporal. Adjuntar el completion token al upload de Worker y conservar los bindings/migraciones existentes conforme al incremento. No poner credenciales o sesiones de usuarios dentro de assets o código.
4. Mantener previews desactivadas. Verificar de nuevo sin Authorization la URL pública, HTML y hashes de assets, CSP de documento/SDK, WASM, SW, capacidades, configuración no-store, catálogo y portadas.

`npm run deploy:cloudflare` es una alternativa manual de Wrangler y **no fue el mecanismo de esta publicación**. Un cambio local o un push a Git no actualizan automáticamente la web; no se configuró CI/CD.

La evidencia de la entrega está en [evidence-cloudflare-public.json](evidence-cloudflare-public.json). Los recibos de autenticación, despliegue y comprobaciones completas permanecen en `.local/cloudflare-mcp/` y `.local/cloudflare-publish/`, fuera de Git.

El cambio de origen no migra IndexedDB, OPFS, permisos ni la sesión Telegram del enlace anterior. Los datos del origen viejo permanecen allí y no deben borrarse. Una prueba de Cloudflare no debe presentarse como migración de música o aceptación física de iPhone.

## Fuentes oficiales consultadas

- [MCP oficial y OAuth](https://github.com/cloudflare/mcp).
- [Direct Upload de Static Assets](https://developers.cloudflare.com/workers/static-assets/direct-upload/).
- [Static Assets y binding](https://developers.cloudflare.com/workers/static-assets/binding/).
- [Límites y facturación de Static Assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).
- [Durable Objects Free/SQLite](https://developers.cloudflare.com/durable-objects/platform/pricing/).
- [Secrets de Workers](https://developers.cloudflare.com/workers/configuration/secrets/).
- [Access para workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

Las comprobaciones HTTPS acreditan esta entrega concreta. No acreditan una sesión Telegram real en el origen nuevo, descargas musicales reales, iPhone físico ni la aceptación global P0-W. El primer control remoto del catálogo devolvió 403; el negativo se conservó y las comprobaciones posteriores se registran por separado, sin atribuir una causa no demostrada.

## Límite observado al cerrar la entrega

La búsqueda pública completa de MOSCA desde la UI quedó **bloqueada por HTTP429 de iTunes** en dos intentos. El segundo devolvió Retry-After46/44 segundos. No se continuó reintentando ni se declara aceptado ese recorrido. El lookup exacto de la edición sí devolvió17pistas y su portada HTTP200; esa comprobación no sustituye la búsqueda completa. La publicación y la navegación están verificadas, pero esta restricción del catálogo sigue abierta.

## Actualización de acceso Telegram · 2026-11-13

El reenvío manual autorizado por Telegram está publicado; véase [la evidencia del incremento](evidence-telegram-code-resend-web.json). El build conserva por bytes/SHA los assets con hash y las entradas versionadas de la publicación anterior para no romper pestañas abiertas. La actualización mantuvo los bindings existentes, sin migración SQLite nueva ni reemplazo del secret. Confirmar una recepción real de código sigue pendiente del propietario; el límite429 del catálogo no se presenta como resuelto por este cambio.


## Validación autenticada publicada · 2026-11-15

La sesión real del propietario se conservó en el perfil persistente compartido, incluso tras recarga y activación normal del service worker. KDMusic_Bot principal y DeezerMusicBot secundario quedan guardados. Metadatos iTunes directos desde el navegador con cadencia/cooldown compartidos; las imágenes continúan por el relay acotado. La prueba anterior del relay429 permanece como evidencia histórica. El shell reconstruye respuestas cacheadas con redirección para permitir reabrir entradas versionadas. No se borran cachés, sesiones ni datos para actualizar.

Entrada final9c78c674d7ab20a8;60/60rutas públicas exactas por bytes/SHA,62entradas del manifiesto incluidos2metadatos no servidos. Se retienen los inmutables publicados previos y se excluyen3intermedios nunca publicados. Cloudflare MCP conserva ASSETS/CATALOG/secret, sin migración ni recursos de pago. Evidencia actual en evidence-published-session-repair-web.json; los recibos y negativos completos permanecen privados en .local/published-session-tests.

El lote MOSCA inicial terminó13/17, con4conflictos; una selección explícita posterior de la fila cuyo snapshot confirmó no-dispatched consiguió audio y elevó a14las pistas añadidas. Tres siguen sin confirmar. La continuación automática a otro proveedor sólo admite conflict+not-dispatched tras liquidación y guardas exactas; acknowledged/uncertain detienen. No equivale a demostrar los17audios ni recepción universal de códigos.


## Safari: catálogo y carátulas · 2026-11-15

La versión9006dcecc26d4049 corrige la búsqueda directa de iTunes en Safari sin seguir redirecciones: se omite media=music cuando entity ya identifica álbum, canción o artista. WebKit desviaba las consultas anteriores al esquema nativo musics://; no era una pérdida de la sesión de Telegram. La aceptación publicada sin sustituciones pasa4/4grupos en WebKit de Linux, con portadas,17pistas deMOSCA y62publicaciones deNsqk.62/62rutas públicas verificadas; perfilpersistente real conectado y pausado tras reapertura. iPhone físico sigue pendiente. [Evidencia](evidence-safari-catalog-web.json) y [alternativas](CATALOG-ALTERNATIVES.md).


## Actualización automática y MB · 2026-11-15

La entrada `d586ee3e549273ac` publicó la actualización segura. El 2026-11-15 se publicó `d87da0091a3ec082` para mantener la tarjeta abierta «Actualización de la app» al inicio de Configuración, con estado comprobado y «Recargar app», visible antes y después del inicio de sesión. El incremento cambia sólo UI/CSS; el Worker es idéntico. La comprobación HTTPS confirmó 75 rutas públicas con bytes y SHA-256 exactos, el entry actual y los bindings ASSETS/CATALOG/TELEGRAM_API_IDENTITY; previews permanecen desactivadas. La acción manual pausa música y espera que terminen las operaciones.

Los tamaños de descargas, caché, cuotas, archivos locales, progreso y espacio liberado se muestran en MB decimales. No cambian los límites internos ni los datos guardados. Verificación combinada708/708unidades y36/36grupos Chromium/WebKit; comprobación publicada de actualización mientras sonaba música, recarga tras pausa/manual y conservación de Telegram.72/72archivos de origen coinciden en contexto nuevo. [Evidencia](evidence-automatic-update-web.json). iPhone físico pendiente.


## Recargar pestañas antiguas · 2026-11-15

La reparación publicada en deployment9a3c36e13ae64f5b8f2b7a3d2aaa8c07 evita que un service worker viejo mantenga indefinidamente el HTML anterior al recargar. La instalación del worker nuevo añade un puente a los documentos públicos cacheados; en la próxima navegación abre la versión actual, con fallback de la app anterior sin conexión. No borra música ni sesiones, ni activa el worker a la fuerza sobre una reproducción. Las navegaciones futuras prefieren red con fallback offline. Abrir una URL de versión vieja en el navegador también sirve la app actual; el fetch de metadatos conserva sus bytes originales.

El navegador debe recibir primero el SW reparado: las páginas con código anterior no se pueden actualizar retroactivamente en memoria. Su primer refresco puede instalar la reparación antes de que la siguiente carga use el puente. La prueba pública se hizo con la misma pestaña antigua de raíz, sin enlace especial: tras instalar el SW y recargar apareció el botón, mientras otra pestaña conservó audio y Telegram. [Evidencia](evidence-legacy-update-web.json).


El incremento de álbumes añade `musicbrainz:true` a catalog-config cuando existe CATALOG. Las rutas cerradas `/catalog/musicbrainz/{search,artists,artist-albums,release,artwork}` usan el mismo Durable Object, con estado de cuota propio y sin migración ni binding nuevo. Sólo se persisten marcas de tiempo/cooldown; respuestas públicas se cachean en RAM con límites. User-Agent identifica Pulso y su contacto. No se reenvían cookies, autorización ni headers del visitante. El respaldo se usa sólo si iTunes falla o queda vacío; no cambia TELEGRAM_API_IDENTITY ni la sesión del navegador. La prueba publicada del incremento queda separada de los fixtures en evidence-album-backup-web.json.
