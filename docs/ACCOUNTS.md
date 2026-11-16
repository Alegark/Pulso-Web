# Cuentas de Pulso

Estado: candidato local comprobado con API de prueba. Neon y Google aún no están conectados; no hay registro real habilitado ni publicación de este incremento.

El propietario eligió correo y contraseña más Google, con Neon como base. El acceso de Pulso es opcional y distinto de la conexión personal de Telegram. Este incremento no sincroniza la biblioteca, favoritos, playlists, historial ni archivos entre dispositivos; tampoco mueve la autorización Telegram a un servidor. Iniciar o cerrar una cuenta de Pulso no borra ni cambia los archivos y la organización locales del navegador.

## Servicio y configuración

Se usa Managed Better Auth de Neon con `@neon/auth` 0.8.2. Las dependencias Better Auth/Core/OAuth se fijan en las revisiones 1.7.12 y Better Call 1.4.4 que admite el SDK, evitando el conflicto de peers entre Better Fetch 1.3.2 y 1.3.3. Better Fetch 1.3.2 y Better Auth Utils 0.5.0 son comunes a ese conjunto. El lockfile fija todas las integridades. Los avisos originales se conservan, también para paquetes anidados. No se implementa hashing de contraseñas, OAuth ni firma de sesiones por cuenta propia.

Cloudflare expone `/account-config.json` y una lista cerrada de rutas bajo `/api/account-auth/`. El toolkit oficial de Neon reescribe cookies seguras para el dominio de Pulso; la aplicación cliente usa esa URL del mismo origen. No depende de permitir cookies de terceros. `get-session` fuerza revalidación upstream para no consumir una respuesta cacheada de otra sesión durante el intercambio OAuth. Los encabezados son `no-store`, sin logs propios de visitantes y con errores de interfaz de una lista fija. Se rechazan métodos/rutas no previstos, JSON inválido, origen cruzado, payload excesivo y proveedor distinto de Google. Los destinos de retorno se fijan al mismo origen, no se aceptan del formulario.

Variables privadas de Worker requeridas:

- `PULSO_NEON_AUTH_URL`: Auth Base URL de la rama propia de Neon.
- `PULSO_AUTH_COOKIE_SECRET`: secreto aleatorio generado por el operador, al menos 32 caracteres, exclusivo de la aplicación.
- `PULSO_AUTH_GOOGLE_ENABLED`: `true` únicamente después de configurar las credenciales Google propias y verificar el recorrido. Sin esa condición Google permanece deshabilitado.

Estas variables no se incluyen en archivos públicos, Git, diagnósticos, registros ODD ni memoria. La clave API administrativa de Neon se usa sólo para provisionar; no es una variable del frontend ni del Worker del producto. El archivo estático público de configuración anuncia cuentas deshabilitadas para hosts sin backend. Ninguna UI deshabilitada se presenta como una cuenta creada.

## Preparación de Neon y Google

1. Conectar la cuenta de Neon por su MCP oficial o por una credencial de administración entregada mediante el mecanismo seguro del entorno. Verificar plan Free antes de crear el proyecto de Pulso. No activar pagos ni otros recursos fuera del proyecto.
2. Habilitar Managed Better Auth en su rama, permitir sólo el dominio publicado de Pulso y configurar verificación de correo por código. Revisar proveedor y límites de correo; el SMTP compartido de Neon se documenta para desarrollo y pruebas, y no constituye aceptación de entrega de correos en producción.
3. Crear un cliente web OAuth propio en Google Auth Platform. El callback de Google se obtiene del Auth Base URL real de Neon; no se inventa antes de provisionar la rama. Configurar nombre de Pulso, datos públicos de contacto y alcances mínimos de identidad. No solicitar acceso a Gmail, Drive ni otras APIs.
4. Configurar Client ID y secret en Neon mediante su API/Console. No usar las credenciales compartidas de desarrollo para anunciar acceso público de Pulso con Google.
5. Configurar los secretos del Worker, verificar sesión persistente, registro/verificación, recuperación, Google y cierre de sesión con cuentas de prueba autorizadas. Publicar por el MCP oficial de Cloudflare y actualizar la PR mediante el agente económico, según la autorización permanente del propietario.

## Interfaz y límites

El encabezado ofrece Iniciar sesión / Mi cuenta. El diálogo nativo contiene acceso con Google cuando está habilitado, correo/contraseña, registro con nombre, verificación de seis dígitos, reenvío y recuperación. Los campos de contraseña y código se limpian al finalizar o cerrar; los tokens de recuperación se retiran de la URL y viven sólo durante el formulario en memoria. No se registran códigos, contraseñas, correos reales, tokens ni respuestas crudas en la memoria del proyecto.

Una acción en curso evita doble envío y bloquea una recarga automática de la app. Abrir el diálogo también bloquea actualización para preservar un borrador. El cierre devuelve foco al botón de apertura. Google puede navegar fuera de la página como parte de la acción solicitada; no se promete continuidad de audio durante esa navegación. Las verificaciones locales con API sintética no acreditan cuenta real, SMTP, Google, persistencia real de cookies, Safari físico ni iPhone.

Fuentes oficiales: [React y Neon](https://neon.com/docs/auth/quick-start/react), [flujo de autenticación](https://neon.com/docs/auth/authentication-flow), [configuración para producción](https://neon.com/docs/auth/production-checklist), [Google OAuth](https://neon.com/docs/auth/guides/setup-oauth), [clientes OAuth de Google](https://developers.google.com/identity/openid-connect/openid-connect).

## Comprobaciones locales

La selección nativa de cuentas pasó 18/18 casos en Chromium154 y WebKit27.2 con el SDK real y API TESTONLY; cubre formularios, errores, registro/verificación, recuperación, retorno Google simulado, foco, texto al200% y sesión de prueba. La regresión de interfaz/playlists final pasó36/36; dos ejecuciones WebKit anteriores con falla de continuidad de audio y consecuencias en la navegación se conservan y no se presentan como verdes. La ejecución diagnóstica final pasó sin cambiar el runtime ni relajar la aserción. Las unitarias completas pasaron734/734 y el servidor22/22. Lint, build y Wrangler dry-run pasaron.

Los datos de cuenta y tokens de las fixtures son inventados y exclusivos de prueba. No se ensayó un usuario real de Neon, un correo entregado, Google real, un Android/iPhone físico ni aislamiento/sincronización de bibliotecas por cuenta Pulso. El backend continúa deshabilitado hasta conectarlo y verificarlo.
