# Pulso Web

Pulso Web es una biblioteca musical personal para buscar música en fuentes de Telegram que el usuario haya autorizado, reproducirla y organizarla en playlists. La interfaz está pensada para escritorio y móvil, con especial atención a Safari en iPhone.

## Estado

La instancia pública está en **v70**: [pulso-web.pruebassoftware.workers.dev](https://pulso-web.pruebassoftware.workers.dev/). El proyecto continúa en desarrollo. La aceptación física en iPhone sigue pendiente: las 16 pruebas reservadas al propietario están descritas en [docs/guides/IPHONE-ACEPTACION.md](docs/guides/IPHONE-ACEPTACION.md). Un build o una prueba automatizada no sustituye esa revisión en el teléfono.

La app permite conectar fuentes de bots de Telegram y buscar en las fuentes seleccionadas. En **Configuración → Conexiones** se pueden importar playlists de Spotify y YouTube/YouTube Music desde una URL o un identificador; importar la lista no inicia descargas masivas. La disponibilidad depende de la fuente, la configuración y las condiciones de cada servicio.

## Datos y privacidad

Las copias de audio y la sesión personal de Telegram se guardan en el navegador y quedan aisladas por origen; abrir otro dominio o perfil no las transfiere. La biblioteca y las playlists se conservan localmente. Al iniciar sesión en una cuenta Pulso, sus fichas, favoritos y playlists pueden sincronizarse como metadatos para restaurar la organización en otro dispositivo; no se sincronizan los archivos de audio, la sesión de Telegram ni la disponibilidad local. Consulta el [contrato de Biblioteca de cuenta](docs/architecture/ACCOUNT-LIBRARY.md) y la [persistencia de Telegram](docs/guides/TELEGRAM-PERSISTENCE.md). Borrar los datos del sitio puede eliminar las copias locales; la cuenta no es una copia de seguridad de audio. Las solicitudes a Telegram, Spotify, YouTube y los servicios de catálogo ocurren al usar esas funciones y se rigen también por sus condiciones.

No incluyas claves, códigos, sesiones de Telegram, datos privados ni archivos de audio personales en el repositorio, en incidencias o en diagnósticos. La política para reportar fallos de seguridad está en [SECURITY.md](SECURITY.md). El presupuesto del proyecto es **USD 0**: no habilites servicios de pago ni consumos facturables.

## Aviso legal

Usa únicamente audio y fuentes a los que tengas derecho de acceso. El usuario es responsable de respetar los derechos de autor, las reglas de Telegram y las condiciones de Spotify, YouTube y otros servicios conectados. Pulso Web es un proyecto independiente y no está afiliado con esos servicios.

## Desarrollo local

Se requiere Node.js `^22.12.0` y npm.

```sh
npm ci
npm run dev
```

Vite imprime la dirección local. Para comprobar los tipos, el código, las pruebas de servidor y la compilación:

```sh
npm run check
npm run typecheck:tests
npm run build
```

### Scripts de `package.json`

| Script | Comando | Uso |
| --- | --- | --- |
| `dev` | `vite` | Servidor local de desarrollo. |
| `typecheck` | `tsc --noEmit` | Comprueba tipos de la app. |
| `lint` | `tsc --noEmit --noUnusedLocals --noUnusedParameters` | Comprueba tipos y símbolos sin uso. |
| `test:unit` | `tsx --test tests/unit/*.test.ts tests/unit/*.test.tsx` | Pruebas unitarias. |
| `build` | `vite build && node scripts/build-sw.mjs` | Build web y generación del service worker. |
| `test:browser` | `node scripts/browser-build.mjs` | Prepara el build para pruebas de navegador. |
| `test:browser:run` | `node scripts/run-browser-tests.mjs` | Ejecuta la suite de navegador configurada. |
| `build:cloudflare` | `node scripts/prepare-cloudflare.mjs` | Prepara los artefactos para Cloudflare. |
| `test:cloudflare` | `node --test tests/server/*.test.mjs` | Pruebas del servidor y Worker. |
| `deploy:cloudflare` | `wrangler deploy --config wrangler.jsonc` | Despliegue de Cloudflare; requiere autorización aplicable. |
| `test:py` | `python3 -B -m unittest discover -s tests/server -p 'test_*.py'` | Pruebas Python del servidor. |
| `check` | `npm run typecheck && npm run lint && npm run test:unit && npm run test:cloudflare && npm run test:py` | Batería local de tipos, lint y pruebas. |
| `typecheck:tests` | `tsc --noEmit -p tsconfig.tests.json` | Comprueba tipos de las pruebas TypeScript. |

## Mapa del repositorio

- `src/`: aplicación TypeScript y React. `accounts/` gestiona cuentas; `playlists/`, playlists; `playback/`, reproducción y cola; `library/`, biblioteca; `telegram/`, acceso a Telegram; `storage/`, almacenamiento; `imports/`, importaciones; `ui/`, componentes e interfaz. También hay módulos en `cache/`, `diagnostics/`, `errors/`, `http/`, `pwa/` y `service-worker/`.
- `public/`: recursos públicos, fixtures y muestras que forman parte de las entradas y pruebas del build.
- `deployment/` y `wrangler.jsonc`: configuración y código del despliegue Cloudflare.
- `scripts/`: preparación de builds, fuentes, licencias y tareas de desarrollo.
- `tests/`: pruebas unitarias, de servidor e integración/navegador.
- `docs/architecture/`: contratos y decisiones técnicas; [SPEC](docs/architecture/SPEC.md) reúne el alcance y los criterios del producto.
- `docs/guides/`: instalación, desarrollo, Telegram, Cloudflare y aceptación por dispositivo.
- `docs/evidence/`: evidencia técnica; `docs/archive/`: documentación archivada.
- `design/`: decisiones de diseño, fuentes de prototipos y herramientas para regenerar HTML de muestra.

Guías útiles: [instalación](docs/guides/INSTALLATION.md), [desarrollo](docs/guides/DEVELOPMENT.md), [configuración de Telegram](docs/guides/TELEGRAM-SETUP.md), [importación de YouTube](docs/guides/YOUTUBE-IMPORT.md) y [Cloudflare](docs/guides/CLOUDFLARE.md). La dirección visual se explica en [design/design.md](design/design.md).

## Licencia

El código de Pulso Web se distribuye bajo la licencia [MIT](LICENSE). Las dependencias y componentes de terceros conservan sus propias licencias y avisos: el build sirve `/THIRD-PARTY-NOTICES.txt`. Para los componentes de Telegram distribuidos bajo **LGPL-3.0**, el build sirve también `/telegram-sources.tar.gz` con las fuentes correspondientes y la receta de sustitución. MIT no reemplaza ni amplía las licencias de esos componentes.
