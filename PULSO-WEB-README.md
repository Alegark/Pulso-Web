# Pulso Web

Biblioteca musical personal para **buscar canciones y álbumes desde fuentes autorizadas de Telegram, reproducirlos, descargarlos y organizarlos en playlists**, con una interfaz inspirada en la claridad de Spotify y Apple Music.

La prioridad es una buena experiencia en **iPhone desde Safari o Chrome**, incluida la reproducción y el avance de cola con la pantalla bloqueada. Esa capacidad es un objetivo de aceptación que debe comprobarse en el teléfono.

> **Estado · 2026-11-10:** prototipo web funcional con búsqueda de canciones, álbumes y artistas, reproducción, playlists, favoritos y gestión de copias locales. Las pruebas automatizadas locales no sustituyen la aceptación física en iPhone, que sigue pendiente. El SPEC conserva la propuesta original; las tareas ODD y la evidencia documentan los incrementos implementados.

## Documentación principal

[**SPEC.md**](SPEC.md) es la especificación detallada: alcance, decisiones pendientes, interfaz, contratos de datos, Telegram, audio, almacenamiento, seguridad, referencias de código, pruebas y tareas.

El SPEC incluye:

- **18 capacidades** del producto, identificadas como W01–W18.
- **32 invariantes** para conservar datos, privacidad y coherencia.
- **24 criterios de aceptación**, con el entorno necesario para comprobarlos.
- **20 tareas futuras**, ordenadas para probar las fronteras críticas antes de ampliar la app.

Este README es la entrada breve; el SPEC gobierna los requisitos. Una función descrita aquí todavía no equivale a una función disponible.

## Experiencia que buscamos

```text
Importar audios o conectar Telegram
→ elegir fuentes → buscar canciones o álbumes
→ escuchar y añadir a biblioteca → crear playlists
→ descargar → escuchar sin conexión y con el teléfono bloqueado
→ reabrir con la biblioteca conservada y la cola pausada
```

### Funciones principales

- Búsqueda local y remota, con fuentes seleccionadas, paginación y cancelación.
- Biblioteca con canciones, artistas, álbumes, favoritos y playlists.
- Reproductor persistente, minirreproductor, cola, seek, repetición y aleatorio.
- Descargas verificadas, estado real de disponibilidad y gestión de almacenamiento.
- Importación de archivos propios o autorizados y edición local de metadatos.
- Controles accesibles, tema claro/oscuro y textos en español.

La paridad completa también contempla letras, exportación de organización, un adaptador de bot verificado y Guardar en Telegram como acción manual. Su alcance y condiciones están en el SPEC.

**Las recomendaciones algorítmicas quedan aplazadas.** Primero se completa el recorrido musical principal.

## Qué significan las acciones

| Acción | Resultado esperado |
|---|---|
| Añadir a biblioteca | Conservar la ficha y su procedencia; no obliga a descargar. |
| Añadir a playlist o favorito | Organizar localmente; no crea mensajes ni canales. |
| Descargar | Conservar un archivo completo, verificado y disponible offline. |
| Quitar descarga | Retirar la copia local elegible y conservar la organización. |
| Borrar playlist | Quitar esa lista sin borrar canciones ni archivos. |
| Guardar en Telegram | Enviar o reenviar únicamente tras elegir destino y confirmar. |

Una cache de JavaScript, un buffer de reproducción o una ficha persistida no son una descarga musical completa.

## Propuesta técnica

Las siguientes son **elecciones propuestas sujetas a los primeros pilotos**, no integraciones ya verificadas:

| Área | Propuesta |
|---|---|
| Interfaz web | React DOM + TypeScript, con Vite y diseño responsive. |
| Telegram | `@mtcute/web` como candidato, mediante un adaptador y un worker. |
| Reproducción | Un `HTMLAudioElement` persistente y Media Session según capacidades. |
| Organización | IndexedDB, con transacciones y migraciones comprobables. |
| Archivos | OPFS cuando sea viable; fallback IndexedDB por fragmentos. |
| Offline y rangos | Service Worker same-origin, separando shell y archivos musicales. |
| Infraestructura | Primera alternativa sin backend propio; alojamiento HTTPS por resolver. |
| Calidad | Pruebas de lógica, integración en navegador y aceptación física en iPhone. |

Las versiones exactas, el lockfile y los paquetes publicados se verificarán al crear el proyecto. La aplicación del usuario debe funcionar con su bundle de producción, sin depender del entorno de desarrollo.

### Referencias investigadas

El SPEC contiene enlaces a commits y archivos concretos de ocho proyectos: **Telegram Web A, Telegram Web K, mtcute, Ampcast, Snae Player, Koel, telegram-web-player y SoundGrammy**.

Se estudiaron recorridos de autenticación, búsqueda, entrega de bytes, audio, cola y persistencia. Algunos necesitan servidor o motor nativo; sirven como referencia de sus contratos, no como prueba de que funcionen en Safari. Revisar licencia y dependencias antes de incorporar código.

## Origen del proyecto y recorrido de implementación

El plan inicial que guio la implementación fue:

1. **Leer el SPEC**, especialmente §C y las decisiones D01–D10. Confirmar el directorio, las instrucciones y los recursos disponibles.
2. **Crear un bootstrap mínimo** con dependencias fijadas y una tarea ODD.
3. **Demostrar audio local y cola** con archivos autorizados, un solo motor y controles reales.
4. **Probar pronto en el iPhone** el cambio de pista bloqueado y el acceso offline. Registrar navegador, versión y modo de apertura.
5. **Validar Telegram por separado:** sesión personal, fuente elegida, búsqueda, cancelación y lectura de bytes.
6. **Comprobar reproducción remota bloqueada** con bytes que aún no estaban disponibles antes del bloqueo.
7. Ampliar biblioteca, interfaz, playlists y descargas siguiendo §T, conservando pruebas del recorrido completo.

Si falla una frontera esencial, registrar el caso y resolver la decisión correspondiente antes de construir toda la interfaz.

### Instalación y ejecución

Desde la raíz del repositorio, con Node.js compatible con Vite 8 y npm:

```sh
npm ci
npx vite --host 127.0.0.1
```

El terminal muestra el puerto local. Para verificar y compilar:

```sh
npm run lint
npm run test:unit
python3 -m unittest discover -s tests/server -v
npm run build
```

La compilación genera `dist/`. Engram es una herramienta local de desarrollo, no una dependencia del producto. El uso de Telegram requiere configurar una identidad API propia por el procedimiento de [configuración privada](docs/TELEGRAM-SETUP.md); el repositorio no incluye credenciales ni sesiones. Para desplegar, usa HTTPS y conserva las políticas de seguridad indicadas en la documentación.

Las funciones e investigaciones actuales están en [interfaz](docs/UI-INTEGRATION.md), [álbumes y artistas](docs/ALBUMS-AND-ARTISTS.md), [copias y Biblioteca](docs/PLAYBACK-COPIES-AND-LIBRARY.md), [bots sugeridos](docs/BOT-SUGGESTIONS.md) y [portadas](docs/ARTWORK-PROVIDERS.md). La investigación de fuentes directas fue [descartada por el propietario](docs/DIRECT-AUDIO-SOURCES.md).

Pulso guarda las copias musicales y la sesión personal en el dispositivo. El relay opcional del prototipo sólo maneja metadatos públicos y portadas temporalmente; no almacena música en Cloudflare. `.local/`, `.tools/`, `node_modules/`, `dist/` y archivos de entorno quedan fuera de Git.

## Método de desarrollo: ODD + Engram local

- **ODD — Organic Driven Development:** una tarea persistente por objetivo sustancial, con alcance, requisitos, cambios, pruebas y siguiente paso.
- **Engram local:** memoria de decisiones y evidencia del proyecto, con lectura y sincronización verificadas.
- El proyecto nuevo tendrá **su propio identificador y almacén de memoria**. No copiar la base ni las rutas fijas del proyecto anterior.
- Los documentos y el código conservan la autoridad; la memoria ayuda a recuperarlos.
- Trabajar en cambios pequeños y coherentes, manteniendo un responsable por reparación.
- Sin RDD ni OpenDesign. Engram y Firecrawl son herramientas del desarrollo, no dependencias del reproductor.

## Validación y definición de terminado

Una prueba unitaria, un build o Playwright en escritorio acredita su propio entorno. La aceptación móvil requiere **iPhone real**.

Se comprobarán por separado:

- Continuidad de la pista actual y avance a archivos distintos al bloquear.
- Streaming remoto con nuevas solicitudes de bytes después del bloqueo.
- Reapertura y reproducción de una playlist descargada sin red.
- Safari, Chrome y modo añadido a Inicio, con resultados independientes.
- Interrupciones, controles del sistema, accesibilidad y recuperación de datos.

El criterio completo incluye **10 pistas consecutivas y al menos 30 minutos de escucha bloqueada**, además de las demás aceptaciones del SPEC. Todavía no se ha ejecutado esa prueba para esta aplicación.

Media Session ofrece controles del sistema; no garantiza ejecución continua. El almacenamiento del navegador puede sufrir purga: una descarga conservada por la app no sustituye una copia externa.

## Recursos y privacidad

- **Presupuesto: USD 0 total.** Usar recursos gratuitos o cuota incluida; no activar pagos ni alternativas facturables.
- Cuentas, despliegue, publicación y operaciones reales en Telegram requieren su autorización aplicable.
- Usar fuentes accesibles y archivos propios o autorizados. No automatizar pagos, uniones a canales ni acciones desconocidas de bots.
- Sesiones, claves, contraseñas, códigos y contenido privado quedan fuera de Git, Engram, capturas públicas y contexto de IA.
- Seguir condiciones del servicio y revisar licencias antes de reutilizar código.

## Llevar estos documentos al proyecto nuevo

En el repositorio de origen, este archivo se llama `PULSO-WEB-README.md` para conservar el README existente.

Copiar estos dos documentos a la raíz del destino:

```text
README.md    ← PULSO-WEB-README.md
SPEC.md      ← SPEC.md
```

El SPEC es autocontenido y conserva las referencias públicas necesarias. No hace falta trasladar el historial Swift/React Native, los staging, las sesiones ni las bases locales de memoria.

**Siguiente paso:** entregar ambos archivos a la IA del proyecto web, confirmar dónde comenzará y trabajar desde T1–T3 con las comprobaciones descritas.
