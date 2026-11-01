# Estado de Pulso Web

Proyecto independiente en desarrollo. El objetivo completo P0-W todavía no está aceptado. `PULSO-WEB-README.md` y `doc/SPEC.md` conservan el handoff original; README.md y SPEC.md siguen enlazados a ellos. Las instrucciones posteriores y la evidencia de implementación se registran en `odd/tasks/` y `docs/`.

La última entrega de prueba verificada es `51c9bdf061455432`: importación local, biblioteca/playlists, cola, portadas y letras incrustadas, organización v2, reinspección explícita de etiquetas y fuentes físicas registradas, reserva de admisión y retirada explícita individual con recuperación. Es un resultado web; iPhone, VoiceOver, zoom real, reproducción bloqueada sostenida y otros gates siguen pendientes. El propietario retiró los editores de canciones del alcance de la interfaz; se conservan los datos históricos.

La retirada explícita se verificó en Chromium con transporte compatible, conserva las fichas y exige una declaración y confirmación nuevas por plan. En el acceso privado actual la reproducción usa Blob acotado y la retirada queda bloqueada por falta de controlador Service Worker verificable. Offline privado e iPhone no están aceptados. No hay proveedores externos ni Telegram real activados. La rama principal puede contener incrementos posteriores en validación; véase docs/LOCAL-COPY-REMOVAL.md para evidencia y límites.

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
