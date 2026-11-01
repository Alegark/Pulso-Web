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
