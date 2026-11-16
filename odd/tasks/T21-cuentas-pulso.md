# T21 · Registro y cuentas de Pulso

Estado: EN CURSO. Autorización del propietario: agregar cuentas e inicio de sesión con correo/contraseña y Google, usando Neon; tiene cuenta pero aún no proyecto. Presupuesto USD 0, sin pagos. Cuenta de Pulso independiente de Telegram. Las canciones y la organización permanecen locales; no se añade sincronización ni historial remoto por inferencia.

## Implementación candidata

Nuevo controlador de cuenta con estado comprobado por el proveedor, acción única en vuelo, mensajes cerrados y sin almacenamiento de credenciales. Adaptador oficial `@neon/auth` 0.8.2 y diálogo responsive: registro, acceso, recuperación, verificación de correo, reenvío y cierre. Cookie y OAuth gestionados por toolkit oficial, detrás del mismo origen Cloudflare. Registro/login no modifican el control de reproducción, IndexedDB musical, ámbito o vault de Telegram.

Proxy cerrado de operaciones, validación de JSON/campos/origen, destinos de retorno del mismo origen, límites de request/response/plazo, no-store y logs SDK silenciados. Configuración falla cerrada sin Auth Base URL propia y cookie secret. Google sólo se anuncia habilitado tras configuración propia del operador. Revalidación de get-session evita que una cookie anterior oculte un nuevo verifier OAuth.

Dependencias Better Auth y Better Call fijadas dentro del contrato del SDK para resolver el conflicto de peers detectado en la primera instalación. Avisos originales de nuevos paquetes registrados por bytes/SHA; generador ampliado para comprobar paquetes anidados sin relajar versión/licencia/notice. Test histórico de metadatos detectó un cambio involuntario del texto de error; se conservó la aserción y se restauró el contrato. Fuentes musicales concurrentes previas se preservan; no se atribuyen al incremento de cuentas.

## Evidencia actual y límites

Recibos privados en `.local/pulso-accounts/`. Hasta el primer ciclo: 734/734 unitarias, 20/20 pruebas servidor con los seis casos iniciales de cuentas; después se añadieron dos casos del toolkit real con fetch sustituido, que pasan en selección focal 8/8. Lint/build y Wrangler dry-run pasan; ninguna publicación ni cuenta real por ello. Las pruebas de navegador aún están EN CURSO: negativos conservados sobre foco nativo hacia chrome del navegador, locator que excluye un diálogo cerrado y error SDK lanzado frente a devuelto. Se corrigió el mapeo de error sin usar mensajes crudos; no se declara navegador verde todavía.

## Dependencias externas pendientes

El acceso de Neon no está conectado en las herramientas disponibles. La búsqueda de plugins encontró la integración oficial de Neon no instalada y se sugirió al propietario. Hay una solicitud segura de clave API alternativa pendiente, sin clave recibida. No se creó proyecto, usuario real ni cliente Google. La identidad y la configuración deben verificarse con el acceso que autorice el propietario antes de activar el producto.

Pendientes: cerrar pruebas nativas combinadas y documentar límites, conectar Neon gratuito, crear/configurar proyecto/Auth, cliente Google propio, verificación/recovery con entrega de correo autorizada, prueba real de sesión y publicación/Git por agente económico. No simular esos pasos ni habilitar el botón Google con credenciales compartidas de desarrollo. iPhone/P0 global siguen pendientes.

Documentación: `docs/ACCOUNTS.md`. Engram exclusivo Pulso-Web: lectura inicial de 15 documentos verificada contra bytes/SHA actuales; esta nueva tarea aumenta el conjunto a 16 y requiere sync seguido de lectura independiente antes del cierre.

## Cierre local de la preparación · 2026-11-16

Selección final de cuentas 18/18 en Chromium154 y WebKit27.2, con UI de producción y SDK oficial real; únicamente la API de cuentas se sustituye por respuestas TESTONLY. Incluye registro sin sesión inventada, verificación/reenvío, recuperación con token retirado de la URL, fallo de login con mensaje cerrado y borrado del campo, doble envío, perfil/restore/close, retorno OAuth sintético con verifier consumido, foco y 320/1366 a texto200%, backend deshabilitado honesto. Esto NO demuestra Google real, SMTP ni persistencia real de autorización Neon. Reporte crudo final `.local/pulso-accounts/browser-google.log`; su campo `path` identifica el JSON independiente de esa ejecución.

Finales:734/734 unitarias,22/22 servidor, lint/build y dry-run WorkersFree PASS. Los ocho casos nuevos de servidor incluyen toolkit oficial con fetch sustituido: cookies seguras mismo origen y revalidación del verifier con cookie antigua. General+playlist36/36 final en `.local/pulso-accounts/interface-diagnostic.log`,225 archivos frozen antes/después, sin pageerrors/externos y cleanuptrue. Dos ejecuciones previas31/36 fallaron en WebKit en la continuidad de audio tras resize y luego en acciones bloqueadas por quedar el player abierto. La ejecución diagnóstica mantiene la misma aserción y añade el estado observado; pasa36/36 sin cambios runtime. No se atribuye una causa no demostrada a los RED anteriores; quedan preservados. Browser18/18 también conserva cero errores JS/externos y cleanuptrue.

Las dos solicitudes seguras de clave API agotaron su plazo sin respuesta; no se recibió ninguna clave. Se encontró el plugin oficial Neon no instalado y se sugirió al propietario; conexión pendiente. No se creó proyecto ni usuario real, no se configuró Google y no se publicó este candidato deshabilitado. Próximo paso imprescindible: acceso Neon autorizado por MCP y cliente Google propio. Los cambios quedan locales y separados de las modificaciones musicales preexistentes; publicación y Git por agente económico al completar la configuración y aceptación aplicables.
