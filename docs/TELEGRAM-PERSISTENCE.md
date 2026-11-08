# Sesión de Telegram conservada en el navegador

Pulso conserva la autorización de Telegram para recuperar la conexión después de recargar o volver a abrir el mismo sitio en el mismo perfil de navegador. La autorización de Telegram está asociada a la clave del cliente, según su [documentación de autenticación](https://core.telegram.org/api/auth). No se conserva el código de acceso ni la contraseña de dos pasos.

## Almacenamiento y restauración

El SDK sigue usando `MemoryStorage` para sus caches y referencias. Sólo su autorización serializada mediante `exportSession()` se escribe en IndexedDB dedicado: `pulso-web-telegram-session-v1`. Es un secreto que permite acceder a la cuenta; no se publica, no viaja por el protocolo de la interfaz ni se incluye en diagnósticos, Git, Engram, fuentes de distribución o archivos de música. El SDK instalado documenta `importSession` y `exportSession`; la guía de [mtcute para navegador](https://mtcute.dev/guide/) también contempla almacenamiento persistente.

La página consulta únicamente si existe el registro, sin leer su valor ni crear la base cuando está ausente. Si existe y esta pestaña obtiene autoridad, el worker importa la autorización y verifica al usuario con `getMe`. Cada conexión recibe un binding nuevo: no se reutilizan capacidades de búsquedas, perfiles, mensajes o callbacks anteriores. No se envían consultas musicales ni códigos automáticamente al restaurar. Este incremento conserva la autorización; el pool de bots y los resultados siguen reconstruyéndose por conexión y no se convierten en preferencias persistentes por esta modificación.

La recuperación automática se intenta una sola vez por cliente. Un fallo de red conserva la autorización y muestra **Reconectar Telegram** para un nuevo intento explícito. Una revocación conocida elimina únicamente la autorización propia, sin borrar una sesión posterior. El teléfono, otro navegador y el navegador compartido de pruebas conservan autorizaciones independientes. Cambiar de dominio o perfil requiere conectarse allí; borrar datos del sitio, el navegador o una revocación de Telegram puede obligar a iniciar sesión otra vez.

## Cierre y olvido

- **Detener conexión local** destruye el cliente de esta pestaña y conserva la autorización guardada. No se reconecta inmediatamente por un efecto de interfaz.
- **Cerrar sesión en Telegram** elimina la autorización guardada propia antes de esperar el cierre remoto. Si la revocación remota no se confirma, el aviso lo indica. La biblioteca y los audios se conservan.
- **Eliminar sesión guardada** funciona desde el estado desconectado o con error, sin cargar SDK/WASM/configuración API ni contactar con Telegram. Repara también un registro local ilegible; no revoca por sí solo una autorización remota.

Las escrituras usan transacciones nativas y una generación. Un login nuevo invalida las escrituras del anterior; olvidar cambia la generación y borra el secreto en la misma transacción. Una autorización antigua no puede volver a aparecer por un commit tardío. Errores de almacenamiento se muestran como tales, sin afirmar que se guardó o eliminó la sesión. El almacenamiento del navegador es accesible al código autorizado del mismo origen: no se afirma protección frente a XSS o una extensión con acceso al perfil.

## Pruebas y alcance

[Evidencia](evidence-telegram-persistence-web.json) separa la integración completa con SDK sintético, el SDK instalado con transporte simulado y las pruebas nativas de IndexedDB. Se comprobaron recarga, cierre local, logout, revocación, error de red sin bucle, olvido sin configuración y conservación de los datos musicales. Una inyección de `QuotaExceededError` prueba el manejo de fallo, no el agotamiento físico del dispositivo.

El propietario inició sesión en el navegador compartido y root comprobó la restauración real tras recargar, sin pedir otro código. Después de las correcciones de compatibilidad descritas en [reproducción elegida](SELECTED-SONG-PLAYBACK.md), un caso real descargó y reprodujo, reutilizó una sola copia y quedó pausado con la sesión conectada. La evidencia real se separa de los fixtures anteriores en [evidence-real-selected-song-web.json](evidence-real-selected-song-web.json). No acredita Safari/iPhone físico, todos los bots ni cierre P0.
