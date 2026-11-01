# Estado de Pulso Web

Proyecto independiente en desarrollo. El objetivo completo P0-W todavía no está aceptado. `PULSO-WEB-README.md` y `doc/SPEC.md` conservan el handoff original; README.md y SPEC.md siguen enlazados a ellos. Las instrucciones posteriores y la evidencia de implementación se registran en `odd/tasks/` y `docs/`.

La última entrega de prueba verificada es `c543e9f0a1a173d3`: retira la importación local de canciones y las muestras de la interfaz principal, conforme a la decisión de usar Telegram como única fuente de audio. Conserva las copias existentes, biblioteca/playlists, cola continua, portadas y letras incrustadas, organización v2, reinspección de etiquetas y fuentes físicas protegidas. Es un resultado web; iPhone, VoiceOver, zoom real, reproducción bloqueada sostenida y otros gates siguen pendientes. El propietario retiró los editores de canciones del alcance de la interfaz; se conservan los datos históricos.

La retirada explícita se verificó en Chromium con transporte compatible, conserva las fichas y exige una declaración y confirmación nuevas por plan. En el acceso privado actual la reproducción y las adiciones usan Blob acotado; la retirada queda bloqueada por falta de controlador Service Worker verificable. Offline privado e iPhone no están aceptados. No hay proveedores externos ni Telegram real activados. Véanse docs/QUEUE-INSERTION.md y docs/LOCAL-COPY-REMOVAL.md para evidencia y límites.

El propietario retomó el trabajo y aclaró que Telegram será la única entrada de canciones y álbumes. Se retiran la importación de audios desde el teléfono y las muestras de la interfaz principal. Las copias existentes se conservan; la sesión, búsqueda y descarga reales de Telegram siguen pendientes. Esta decisión posterior sustituye el requisito original de importación local; véase docs/PRODUCT-SOURCES.md. El objetivo completo sigue incompleto.

Comandos del proyecto:

```sh
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

El runner `test:browser` compila páginas de prueba; `test:browser:run` abre Chromium local con sandbox. Consultar `docs/DEVELOPMENT.md` y los recibos de cada incremento para sus comandos y límites. Algunos ejecutores históricos de integración dependen de helpers privados de desarrollo en `.local/`; este repositorio no se presenta todavía como una CI portable de todas esas pruebas.

Los archivos `.local/`, `.tools/`, `node_modules/`, `dist/`, logs y `.env*` están excluidos. No se suben sesiones, credenciales, memoria Engram ni almacenamiento musical del navegador. La configuración de contexto Engram identifica únicamente este proyecto; cada checkout necesita su propia instalación y almacenamiento local.

Presupuesto USD 0. Crear este repositorio privado no publica la aplicación ni autoriza facturación, despliegues, cuentas nuevas o acciones reales en Telegram.
