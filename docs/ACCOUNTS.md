# Cuentas de Pulso

Estado: Neon MCP conectado y proyecto gratuito de Pulso creado con Managed Better Auth. La aplicación aún no tiene cuentas activadas en Cloudflare: faltan Google propio y correo de producción. Los formularios prediseñados se verifican localmente con API TESTONLY; no equivale a registro real publicado.

El propietario eligió correo y contraseña más Google, con Neon como base. El acceso de Pulso es opcional y distinto de la conexión personal de Telegram. Este incremento no sincroniza la biblioteca, favoritos, playlists, historial ni archivos entre dispositivos; tampoco mueve la autorización Telegram a un servidor. Iniciar o cerrar una cuenta de Pulso no borra ni cambia los archivos y la organización locales del navegador.

## Servicio y configuración

Se usa Managed Better Auth de Neon con el SDK oficial `@neon/auth` 0.8.2. Los formularios son los componentes prediseñados de Better Auth UI que recomienda actualmente Neon; se incorporan a `src/ui/account-kit/` desde el commit identificado en `UPSTREAM.json`, con licencia MIT original. No se utiliza el paquete antiguo `@neondatabase/auth-ui`, que Neon marca como deprecado. Pulso adapta presentación, español, navegación acotada, avisos y limpieza de campos; la autenticación sigue en el SDK y servicio administrados.

Los paquetes Better Auth UI están fijados en 1.7.34. El lockfile conserva las versiones compatibles que resolvió npm, sin `--force` ni `--legacy-peer-deps`; `npm ls` no reporta dependencias inválidas. El SDK conserva una copia compatible de Better Auth 1.7.12 y el paquete de UI usa 1.7.25. No se fuerza una sustitución incompatible entre ambas. El guard de licencias admite avisos de repositorios originales expresamente revisados cuando el tarball omite el archivo o el campo de licencia, y sigue comprobando identidad, versión y bytes/SHA. Las versiones de un mismo paquete se verifican por separado.

La interfaz usa Tailwind únicamente para los componentes de acceso: utilidades bajo `.account-kit`, sin importar el reset global. Se aplican los colores de Pulso, controles táctiles y texto ampliado. Código y CSS se cargan al abrir el acceso habilitado, evitando cargarlos durante la escucha local con cuentas deshabilitadas.

Cloudflare expone `/account-config.json` y una lista cerrada de rutas bajo `/api/account-auth/`. El toolkit oficial de Neon reescribe cookies seguras para el dominio de Pulso; la aplicación cliente usa esa URL del mismo origen. No depende de permitir cookies de terceros. `get-session` fuerza revalidación upstream para no consumir una respuesta cacheada de otra sesión durante el intercambio OAuth. Los encabezados son `no-store`, sin logs propios de visitantes y con errores de interfaz de una lista fija. Se rechazan métodos/rutas no previstos, JSON inválido, origen cruzado, payload excesivo y proveedor distinto de Google. Los destinos de retorno se fijan al mismo origen, no se aceptan del formulario.

Variables privadas de Worker requeridas:

- `PULSO_NEON_AUTH_URL`: Auth Base URL de la rama propia de Neon.
- `PULSO_AUTH_COOKIE_SECRET`: secreto aleatorio generado por el operador, al menos 32 caracteres, exclusivo de la aplicación.
- `PULSO_AUTH_GOOGLE_ENABLED`: `true` únicamente después de configurar las credenciales Google propias y verificar el recorrido. Sin esa condición Google permanece deshabilitado.

Estas variables no se incluyen en archivos públicos, Git, diagnósticos, registros ODD ni memoria. La clave API administrativa de Neon se usa sólo para provisionar; no es una variable del frontend ni del Worker del producto. El archivo estático público de configuración anuncia cuentas deshabilitadas para hosts sin backend. Ninguna UI deshabilitada se presenta como una cuenta creada.

## Preparación de Neon y Google

1. Completado: conexión OAuth del MCP oficial de Neon y proyecto Pulso en organización Free. No se activaron pagos. Base propia y rama de producción con cómputo mínimo de 0,25 CU y máximo de 0,25 CU; suspensión por el valor gratuito de la cuenta. Identificadores y configuración de conexión quedan privados.
2. Completado: Managed Better Auth en la base Pulso, nombre Pulso, origen HTTPS publicado permitido, localhost deshabilitado, correo/contraseña con verificación OTP obligatoria y revocación de sesiones al restablecer contraseña. El SMTP sigue siendo el compartido de Neon para desarrollo/pruebas; falta configurar correo de producción. Se retiró Google compartido de desarrollo mientras se espera el cliente propio. Un GET anónimo a Neon a través del router oficial devolvió 200, sesión nula y no-store; no creó usuarios ni envió correos.
3. Crear un cliente web OAuth propio en Google Auth Platform. El callback de Google se obtiene del Auth Base URL real de Neon; no se inventa antes de provisionar la rama. Configurar nombre de Pulso, datos públicos de contacto y alcances mínimos de identidad. No solicitar acceso a Gmail, Drive ni otras APIs.
4. Configurar Client ID y secret en Neon mediante su API/Console. No usar las credenciales compartidas de desarrollo para anunciar acceso público de Pulso con Google.
5. Configurar los secretos del Worker, verificar sesión persistente, registro/verificación, recuperación, Google y cierre de sesión con cuentas de prueba autorizadas. Publicar por el MCP oficial de Cloudflare y actualizar la PR mediante el agente económico, según la autorización permanente del propietario.

## Interfaz y límites

El encabezado ofrece Iniciar sesión / Mi cuenta. El diálogo usa los formularios prediseñados de correo/contraseña, registro con confirmación, recuperación y verificación OTP de seis dígitos. Google se muestra cuando el backend anuncia capacidad. Los campos de contraseña y código se restablecen al terminar una solicitud; los borradores de correo de las vistas sólo viven en memoria del diálogo. El token de recuperación se retira de la URL y se pasa al componente adaptado por una propiedad en memoria. No se registran códigos, contraseñas, correos reales, tokens ni respuestas crudas en memoria del proyecto.

Una acción en curso evita doble envío y bloquea una recarga automática de la app. Abrir el diálogo también bloquea actualización para preservar un borrador. El cierre devuelve foco al botón de apertura. Google puede navegar fuera de la página como parte de la acción solicitada; no se promete continuidad de audio durante esa navegación. Las verificaciones locales con API sintética no acreditan cuenta real, SMTP, Google, persistencia real de cookies, Safari físico ni iPhone.

Fuentes oficiales: [UI recomendada y personalización](https://neon.com/docs/auth/reference/ui-components), [Better Auth UI](https://better-auth-ui.com/docs/shadcn), [React y Neon](https://neon.com/docs/auth/quick-start/react), [flujo de autenticación](https://neon.com/docs/auth/authentication-flow), [configuración para producción](https://neon.com/docs/auth/production-checklist), [Google OAuth](https://neon.com/docs/auth/guides/setup-oauth), [clientes OAuth de Google](https://developers.google.com/identity/openid-connect/openid-connect).

## Comprobaciones locales

La selección nativa final de cuentas pasó 18/18 casos en Chromium154 y WebKit27.2 con SDK real y API TESTONLY. Incluye registro sin sesión inventada, OTP y reenvío con reloj de prueba, recuperación con token retirado de la URL, error de acceso cerrado y borrado del campo, envío doble con una solicitud, perfil/restauración/cierre sintéticos, retorno de Google simulado, foco y geometría 320/1366 con texto al 200%. El candidato exportado de HEAD con sólo cuentas, separado del trabajo concurrente de singles, pasó 739/739 unitarias y 22/22 servidor; lint, build y dry-run pasan. El Worker compila a 288,49 KiB (60,40 KiB gzip). La regresión general/playlist y el caso adicional de login/logout durante audio nativo pasaron 38/38: un solo elemento y source, tiempo avanzando, y tracks/assets/chunks/playlists idénticos antes y después. El runner conserva sus avisos style-src-attr de WebKit; no se presenta como CSP global cero. La selección final de cuentas rechaza violaciones script-src/style-src-elem y pasó sin ellas: Zod se configura sin JIT antes de cargar el SDK, y el OTP usa una hoja estática self y omite la alternativa noscript en esta aplicación JavaScript. No se cambia la CSP.

Los fallos previos quedan en `.local/pulso-auth-ui/`: peer-deps incompatibles corregidos sin forzar npm, textos de selectores antiguos, error de formulario ocultado tras limpiar la contraseña (corregido), y una ejecución con las 18 acciones pasando pero un error WebKit durante una navegación. La ejecución final de cuentas pasó sin errores JS ni peticiones externas observadas y con limpieza completa. Un selector de reenvío distinguía erróneamente mayúsculas y se corrigió conservando el recibo negativo.

Los datos de cuenta y tokens de las fixtures son inventados. No se probó entrega SMTP, Google real, registro real de Neon ni restauración de autorización real en Android/iPhone. No se añadió sincronización de bibliotecas, historial remoto ni separación musical por cuenta Pulso. El backend público continúa deshabilitado hasta configurar y aceptar las dependencias de producción.

La revisión visual y sus límites están en [design/ACCOUNTS.md](../design/ACCOUNTS.md). La preparación está en Git para revisión; no equivale a cuentas habilitadas en el despliegue público.
