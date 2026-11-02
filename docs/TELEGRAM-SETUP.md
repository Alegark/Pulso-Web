# Configuración de Telegram para Pulso

Pulso necesita una identidad API propia de la aplicación, formada por `api_id` y `api_hash`. Telegram explica cómo obtenerla en [Creating your Telegram Application](https://core.telegram.org/api/obtaining_api_id): entrar en [my.telegram.org](https://my.telegram.org), abrir «API development tools» y registrar o consultar la aplicación.

Esta configuración corresponde al responsable de Pulso. Los usuarios finales no tendrán que registrar otra aplicación. No es un token de bot ni el código de acceso de una cuenta.

Para proporcionarla se utiliza la tarjeta privada de configuración del entorno, con un JSON de dos campos: `api_id` y `api_hash`. No enviar esos valores por el chat. Teléfono, códigos y contraseña de verificación en dos pasos quedan fuera de esta configuración y se introducirán sólo en la interfaz privada de autenticación cuando esté preparada.

El receptor local es `scripts/configure-telegram-api.mjs`. Valida el JSON antes de guardarlo en `.local/telegram-owner/api-identity.json`, con permisos de archivo 0600 y directorio 0700. No guarda valores ni hashes de la configuración en diagnósticos, evidencia, ODD o Engram; `.local/` está fuera de Git. El estado se consulta sin imprimir los parámetros:

```sh
node --import tsx scripts/configure-telegram-api.mjs --status
```

Guardar esta configuración no construye un cliente, no abre una sesión y no contacta con Telegram. La siguiente comprobación podrá utilizar la identidad legítima para preparar un cliente local con la red bloqueada; la conexión real requiere el flujo y consentimiento delimitados correspondientes.

En una arquitectura íntegramente web, los parámetros de aplicación que utiliza el cliente son inspeccionables por quien ejecute ese cliente. Esto se distingue de las claves y la sesión privada de cada usuario. La recepción local no publica ni incorpora automáticamente los parámetros al bundle del producto.

Estado al preparar este incremento: identidad API todavía ausente. Cuatro pruebas unitarias del formato y cuatro comprobaciones de filesystem en una copia temporal relocalizada pasan; las entradas de esos tests son fixtures de formato, nunca credenciales reales ni parámetros utilizados para construir un cliente. El producto entregado sigue sin SDK/sesión/red Telegram activos.


Actualización 2026-11-02: identidad API recibida del responsable y almacenada mediante el receptor privado. Se verificaron formato, lectura posterior, permisos 0600/0700 y exclusión de Git; no se publican los valores ni sus huellas. Estado local `configured:true`, `connected:false`, `userSessionLoaded:false`. Esta comprobación no valida la pareja contra Telegram: no se ha construido el cliente SDK ni iniciado una sesión en Pulso. La entrega del producto no cambia.

## Acceso temporal integrado · 2026-11-02

El avance posterior incorpora «Tu cuenta de Telegram» a la web. El propietario autoriza continuar con la integración y acceso real. El panel inicia un worker dedicado únicamente al enviar un número válido con consentimiento; admite código y contraseña de verificación en dos pasos. No registra cuentas nuevas ni contrata servicios. Los fallos de parámetros API, restricciones, código, contraseña, plazo y red se muestran mediante códigos cerrados sin detalles privados.

La primera integración usa `MemoryStorage` explícito. No abre `client.session`, no conserva claves de sesión en IndexedDB, no exporta sesiones ni reutiliza cookies de my.telegram.org. Cerrar/recargar, perder el control o invalidar el ámbito termina el worker y descarta el acceso local; no demuestra revocación remota. «Cerrar sesión en Telegram» solicita `auth.logOut`; un fallo conserva explícitamente la falta de confirmación. Los candidatos de almacenamiento persistente anteriores siguen separados y no se incorporan por esta entrega. La biblioteca local no se atribuye a la cuenta conectada.

La entrega privada puede recibir `/telegram-config.json` mediante `writePrivateTelegramConfiguration` de `scripts/telegram-source.mjs`. Esta copia se excluye del build ordinario, Git, manifiestos de hashes, archivos de fuentes y caché SW; se sirve `no-store` y se lee sólo desde el worker por gesto. Sus parámetros son inspeccionables por quien ejecuta la web, como ya se indicó. Teléfono/código/contraseña sólo se envían a Telegram desde el navegador; el servidor de revisión sigue sin endpoints de escritura ni registro de solicitudes.

La política de red se amplía exclusivamente en la respuesta del worker `session.worker-*.js`: cinco hosts WSS concretos de Telegram y `wasm-unsafe-eval`, sin `unsafe-eval` JavaScript ni comodines. La página, SW y workers de archivos conservan su política anterior. En otro alojamiento debe aplicarse la misma política a ese worker. El SDK y los WASM se acompañan de avisos y `/telegram-sources.tar.gz`, con fuentes C/JS, integración, lockfile y receta de sustitución. No se afirma reconstrucción binaria idéntica ni aceptación jurídica integral.

Pruebas focales y límites se registran en `docs/evidence-telegram-session-web.json`. Preparar un SDK con la identidad local no valida la pareja contra Telegram. Las respuestas positivas de los tests de interfaz son sintéticas e identificadas; no acreditan autenticación real. La siguiente comprobación es que el propietario introduzca su propio número/código/2FA directamente en la web. Selección de fuentes, búsqueda, descarga, persistencia de sesión, iPhone y P0 completos continúan pendientes.


### País y número separados

El formulario permite elegir país/prefijo y escribir el número nacional al lado. No elige país por ubicación ni inspecciona otros datos. Al pegar un número con `+`, el código debe coincidir con el país elegido; el prefijo se añade una sola vez. Los ceros nacionales se conservan: esta comprobación de sintaxis no sustituye el plan de numeración del país. Hay que marcar la autorización y disponer del control de la pestaña antes de enviar. Si otra pestaña conserva el control, ciérrala o cédelo allí y pulsa «Comprobar control».

Los245 pares territorio/código proceden de la fuente Google libphonenumber fijada en `vendor/phone-countries/SOURCE.json`; su licencia y avisos originales acompañan `/THIRD-PARTY-NOTICES.txt` y `/telegram-sources.tar.gz`. No se hacen consultas de red para llenar el selector. Evidencia y límites: `docs/evidence-telegram-country-web.json`.


### Comprobaciones locales pendientes y acceso temporal

La conexión temporal a Telegram usa exclusivamente memoria y no escribe en la biblioteca. Una comprobación o un resultado musical anterior pendiente no impide por sí solo enviar el código de acceso. Esos pendientes siguen visibles y conservan sus restricciones de escritura, recuperación y retirada; autenticarse no los resuelve ni autoriza descargas. Propiedad de la pestaña, base disponible, operaciones incompatibles, reservas, cola, consentimiento y plazo de reintento conservan sus comprobaciones. Perder el ámbito invalida el cliente y sus callbacks como antes. Evidencia: docs/evidence-telegram-library-admission-web.json; cuenta real y teléfono físico pendientes.
