# Estado de Pulso Web

Proyecto independiente en desarrollo. El objetivo completo P0-W todavía no está aceptado. `PULSO-WEB-README.md` y `doc/SPEC.md` conservan el handoff original; README.md y SPEC.md siguen enlazados a ellos. Las instrucciones posteriores y la evidencia de implementación se registran en `odd/tasks/` y `docs/`.

La última entrega de prueba verificada es `8cfb8eb02744ca5c`: importación local, biblioteca/playlists, cola, portadas y letras incrustadas, organización v2 y reinspección explícita de etiquetas. Es un resultado web; iPhone, VoiceOver, zoom real, reproducción bloqueada sostenida y otros gates siguen pendientes. El propietario retiró los editores de canciones del alcance de la interfaz; se conservan los datos históricos.

La rama principal puede contener incrementos posteriores en validación. En particular, las fuentes físicas del transporte y su registro en el reproductor se están comprobando antes de implementar retirada de copias. No hay función de borrado habilitada ni proveedor externo o Telegram real activados.

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
