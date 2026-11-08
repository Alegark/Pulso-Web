# Estado de Pulso Web

Proyecto independiente en desarrollo. El objetivo completo P0-W todavía no está aceptado. `PULSO-WEB-README.md` y `doc/SPEC.md` conservan el handoff original; README.md y SPEC.md siguen enlazados a ellos. Las instrucciones posteriores y la evidencia de implementación se registran en `odd/tasks/` y `docs/`.

La última entrega de prueba es `4d459aa4c10b6bb6`: incorpora acceso temporal a Telegram mediante teléfono, código y verificación en dos pasos, solicitado explícitamente por el propietario. El worker usa `MemoryStorage` sin guardar sesión y sólo conecta por gesto. El acceso real con una cuenta todavía no está confirmado; las respuestas positivas de las pruebas UI son sintéticas. La búsqueda y descarga siguen pendientes. Conserva la biblioteca, la cola y la decisión de no importar canciones desde el teléfono. Evidencia y límites en `docs/evidence-telegram-session-web.json`.

La retirada explícita se verificó en Chromium con transporte compatible, conserva las fichas y exige una declaración y confirmación nuevas por plan. En el acceso privado actual la reproducción y las adiciones usan Blob acotado; la retirada queda bloqueada por falta de controlador Service Worker verificable. Offline privado e iPhone no están aceptados. Las letras externas siguen desactivadas. El acceso temporal a Telegram está disponible por gesto, sin cuenta autenticada confirmada. Véanse docs/QUEUE-INSERTION.md y docs/LOCAL-COPY-REMOVAL.md para evidencia y límites.

El propietario retomó el trabajo y aclaró que Telegram será la única entrada de canciones y álbumes. Se retiran la importación de audios desde el teléfono y las muestras de la interfaz principal. Las copias existentes se conservan; la validación de sesión real, la búsqueda y la descarga de Telegram siguen pendientes. Esta decisión posterior sustituye el requisito original de importación local; véase docs/PRODUCT-SOURCES.md. El objetivo completo sigue incompleto.

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


## Sesión conservada · 2026-11-08

La autorización de Telegram se guarda en IndexedDB dedicado y puede recuperarse tras recarga en el mismo navegador. Cachés del SDK siguen en RAM; teléfono/código/contraseña no se guardan. Restaurar no envía consultas musicales y mantiene autoridad y callbacks nuevos. Detener local conserva; logout y olvido explícito eliminan según su resultado confirmado. Red sin bucle, revocación, cuota inyectada, reopen de proceso y reproducción local offline comprobados con datos propios. 507 unidades, final37/37 native main con SDK sintético y19checks SDK instalado con transporte simulado, separados. Build3d461e76723ce8a4 entregado en copia privada existente. [Contrato y límites](docs/TELEGRAM-PERSISTENCE.md); [evidencia](docs/evidence-telegram-persistence-web.json). Cuenta real, fallo musical del propietario, iPhone y P0 siguen pendientes.
