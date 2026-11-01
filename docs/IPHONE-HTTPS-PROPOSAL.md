# Propuesta de acceso HTTPS para prueba guiada

Estado: PREPARADO, NO PUBLICADO. El «Sí» del propietario autoriza preparar esta propuesta y presentarla antes de publicar, siguiendo la pregunta inmediatamente anterior. No autoriza crear cuentas, facturación ni endpoints públicos todavía.

## Destino concreto

Usar el HTTPS de la máquina InstaBox actual, en el puerto exclusivo **4175**, nombre `Pulso-iPhone`, modo **private** (enlace con token canjeado por cookie). La URL se asignaría bajo el mismo dominio de puertos de esta máquina (`instabox.tech`). No se crea otra máquina ni una cuenta externa. No se toca el puerto existente 8081 ni ningún servicio ajeno.

La publicación propuesta se realizaría, solo tras autorización específica, con `instabox-port publish 4175 --name Pulso-iPhone --private`. El enlace privado no se guarda en Git, Engram, capturas ni logs. Cualquiera que reciba el enlace completo puede acceder; no equivale a login personal. El acceso externo/gateway/cookie/SW aún NO EJECUTADO; si no cumple el caso iPhone, registrar fallo, no desactivar protección silenciosamente.

## Qué se sirve

Copia congelada de `dist/` en `.local/review/iphone-v1/`: 14 archivos, 1163059 bytes (~1.2 MB sin compresión). Contiene bundle de producción, worker, SW y tonos sintéticos públicos. No contiene repositorio, documentación, .git, .engram, .local/engram, configuraciones, credenciales ni datos del propietario.

Servidor preparado: `python3 scripts/serve_review.py`, solo 127.0.0.1:4175. GET/HEAD, rangos, sin listado de directorios ni endpoints de subida/escritura. No registra rutas, query strings ni tokens. La app copia los audios importados al almacenamiento del navegador que los selecciona; el servidor de esta propuesta no los recibe. No hay Telegram ni analítica. Probar inicialmente con los tonos sintéticos del piloto separado `/pilot.html` y sus controles de preparación offline.

Unpublished: `instabox-port unpublish 4175`, luego terminar únicamente el servidor de revisión. Retirar la URL no borra el almacenamiento/SW del iPhone: la copia ya conservada puede seguir abriendo offline. Se mantiene el origen mientras dure el ensayo; se retira al cerrar la prueba por el propietario. No se cambia auto-suspend, tamaño ni facturación de InstaBox.

## USD 0: condición aún no verificada

Documentación oficial consultada: https://instabox.sh/docs/ports.md y https://instabox.sh/docs/pricing.md . Puertos HTTPS y enlaces privados disponibles en la máquina. El plan Free declara 100 GiB/mes de salida incluidos; otros planes tienen crédito/cuota y puede existir cobro por exceso. No se puede confirmar plan/saldo/cuota de esta cuenta desde este proceso: `INSTABOX_API_KEY` no disponible y whoami rechazó la consulta por falta de clave. No se pide una clave para este ensayo.

No se presenta la opción como coste cero garantizado sin esa evidencia. Antes de activar el enlace, el propietario debe confirmar en su cuenta que dispone de cuota incluida suficiente y que no se habilitarán cargos adicionales, además de autorizar el puerto privado. Si no puede confirmarse, conservar esta propuesta sin publicar y elegir otra alternativa gratuita autorizada. No hay fallback pagado.

## Verificación preparatoria realizada

Build original comprobado contra docs/WEB-BUILD-MANIFEST.sha256. Copia revisada sin symlinks. En loopback: GET shell 200, rango MP3 0–1 →206 con 2 bytes, HEAD sin cuerpo/longitud exacta, 416 sin cuerpo, SW con ámbito raíz y MIME adecuado; rutas de memoria/config/repositorio/traversal y listado devuelven 404; POST no disponible. Navegador Chromium abre la biblioteca desde el servidor aislado. Todo esto es local; HTTPS remoto/iPhone aún NO EJECUTADO.

Dispositivo informado: iPhone 13, iOS 27, sin inspección propia. Una vez que el propietario active las pruebas, registrar Safari normal, Chrome y modo Inicio por separado. Por ahora las pruebas físicas continúan pendientes/aplazadas y el trabajo web conserva su prioridad. Ninguna autorización de sesión Telegram ni envío de mensajes se deriva de esta propuesta.
