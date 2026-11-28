# Contribuir a Pulso Web

Gracias por ayudar a mejorar Pulso. Las propuestas deben preservar la privacidad, el almacenamiento por origen, la seguridad de las sesiones y las licencias de terceros.

## 1. Ramas y cambios

Trabaja en una rama descriptiva con uno de estos prefijos: `feat/` para funciones, `fix/` para correcciones, `docs/` para documentación o `chore/` para mantenimiento. No hagas commits ni pushes directos a `main`; abre una pull request para revisión. Mantén cada cambio acotado y explica el problema, el comportamiento resultante, la validación y los pendientes.

## 2. Dónde va cada archivo

- Código de producto: `src/`, organizado en el módulo que corresponda (`src/accounts/`, `src/playlists/`, `src/playback/`, `src/telegram/`, etc.).
- Lógica del Worker y configuración de despliegue: `deployment/` y su configuración existente; los cambios que afecten esos límites deben incluir pruebas de servidor.
- Guías: `docs/guides/`; arquitectura y contratos: `docs/architecture/`; evidencia autorizada: `docs/evidence/`; material histórico: `docs/archive/`.
- Decisiones visuales y fuentes de prototipos: `design/`. Coloca pruebas en `tests/unit/`, `tests/server/` o `tests/integration/` según su nivel.
- Las tareas ODD permanecen en `odd/tasks/`; no las reubiques. Actualiza memoria solo mediante el procedimiento local documentado en [AGENTS.md](AGENTS.md) cuando la tarea lo autorice.

## 3. Archivos que no se deben subir

No subas claves, tokens, contraseñas, `api_id`, `api_hash`, valores de `YOUTUBE_API_KEY`, sesiones o códigos de Telegram, datos privados de usuarios, audio personal ni diagnósticos con información sensible. Tampoco subas `.env` reales, `.local/`, `.engram/`, `.codex/`, `.tools/`, `.wrangler/`, `node_modules/`, `dist/`, perfiles de navegador, logs o artefactos generados. Los siete HTML de muestra enumerados en `.gitignore` se regeneran con los builders de `design/scripts/`; conserva y revisa las fuentes, avisos y prototipos no generados.

## 4. Lista obligatoria antes del commit y de la pull request

- Confirma que estás en tu rama `feat/`, `fix/`, `docs/` o `chore/`, y que el diff no contiene cambios ajenos al objetivo.
- Revisa `git diff --check`, los archivos staged y el diff completo. Comprueba que no hay secretos ni datos personales.
- Añade o ajusta pruebas en el nivel donde vive el comportamiento. No presentes pruebas simuladas como aceptación real de navegador o iPhone.
- Para cambios de código, ejecuta desde la raíz:

  ```sh
  npm ci
  npm run check
  npm run typecheck:tests
  npm run build
  ```

- Para cambios de interacción de navegador, añade la validación correspondiente:

  ```sh
  npm run test:browser
  npm run test:browser:run
  ```

- Si cambias el Worker o su API, ejecuta y revisa `npm run test:cloudflare`; si cambias pruebas Python, revisa el resultado de `npm run test:py`. Ambos están incluidos en `npm run check`.
- Antes de abrir la PR, deja el árbol limpio salvo los archivos destinados al commit y registra los comandos ejecutados, sus resultados y las limitaciones conocidas. La aceptación física de iPhone se mantiene pendiente hasta que el propietario registre sus 16 pruebas.
