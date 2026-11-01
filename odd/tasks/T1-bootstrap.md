# T1 · Auditoría y bootstrap · EN CURSO

Identidad: pulso-web-local-20261031. Almacén reservado: `.local/engram/` dentro de este proyecto; no se ha abierto ninguna base ajena.

Autorización: orden del propietario del 2026-10-31, destino explícito; D01 resuelta. USD 0, sin puertos/publicación/cuentas/Telegram real. SPEC y README originales conservados. Leídos completos, incluyendo D01–D10, V1–V32, AC01–AC24 y T1–T20.

Objetivo: bootstrap mínimo verificable (W01/W08; V1,V21,V29,V30). Auditoría: solo documentación inicial y enlaces; sin app previa. Node 22.23.3, npm 10.9.9, ~18 GiB libres. ffmpeg y engram no encontrados mediante command -v. Catálogo de herramientas sin Engram. No se instala otro agente ni se usa almacén global.

Engram: NO DISPONIBLE/NO VERIFICADO. No existe sincronización ni FullContentVerified. La tarea Markdown es canónica. La ruta reservada no es una base funcional. Cuando exista herramienta local, verificar aislamiento, lectura íntegra y SHA-256 antes/después de sincronizar.

Modelo confirmado por catálogo T3: codex/gpt-6.1-sol; inheritedOptions vacío, serviceTier por defecto del catálogo = default. Sin delegaciones ni cambio de modelo. UI mínima al servicio del piloto de integración/audio, sin fase de diseño completa.

Cambios: React DOM + TS strict + Vite, versiones exactas y lockfile; controles mínimos y capacidades detectables; tareas ODD y matriz física separada. No se reutilizó código de los proyectos de referencia.

Distribución candidata Telegram consultada mediante npm view: @mtcute/web 0.32.7, MIT, exports ESM/CJS/types y tarball publicado. No instalada; worker/auth/búsqueda/bytes/build del SDK NO EJECUTADOS (D03 abierta, T4 pendiente).

Verificación: PASS typecheck, lint limitado a TypeScript, 5 unitarias y build. Primer typecheck FAIL por declaración CSS ausente; corregido con vite/client. npm audit: 0 conocidas. Licencias y versiones declaradas de dependencias registradas en docs/DEPENDENCIES.md; no equivalen a auditoría jurídica.

Límites: capacidades de navegador DESCONOCIDAS, browser e iPhone NO EJECUTADOS. T1 no marcada completada por faltarle esa evidencia. Siguiente: autorización específica para servir localmente y preparación del transporte T3; no publicar.

Actualización de autorización: el propietario permite servidores temporales exclusivamente en loopback para pruebas locales; ya no hace falta pedir permiso para ello. Objetivo ampliado a todo P0-W en P0-W.md y create_goal activo.

## Actualización metodológica · Engram real verificado

La indisponibilidad descrita arriba corresponde a la auditoría inicial y queda superada. Engram oficial 3.5.1 está instalado por el propietario, con identidad de memoria `Pulso-Web` (canonizada `pulso-web`), contexto `.engram/config.json` y almacenamiento persistente exclusivo `.local/engram/`. `pulso-web-local-20261031` fue la etiqueta provisional del trabajo, no el identificador que debe usarse para Engram.

En esta sesión se leyeron AGENTS.md, docs/ENGRAM-LOCAL.md y las cinco tareas canónicas; `python3 scripts/sync_odd_memory.py --read-only` verificó su contenido íntegro, proyecto, bytes y SHA-256, con FullContentVerified=true. Se adopta el helper que utiliza el MCP oficial inmediatamente, sin depender de recargar las herramientas nativas ni reiniciar T3. No se repiten las pruebas aisladas ya aprobadas, al no haber cambios en helpers ni fallos nuevos.

Después de este cambio se ejecutará sincronización y una lectura independiente adicional. Se mantiene la historia inicial, el presupuesto USD 0 y el bloqueo externo HTTPS/iPhone; esto no acredita ninguna capacidad de audio o aceptación física.


## 2026-11-01 · Autorización específica de GitHub y repositorio privado

El propietario solicita repositorio en su cuenta y ayuda para iniciar sesión, y confirma el flujo de dispositivo. GitHub CLI autenticado como Alegark; creado https://github.com/Alegark/Pulso-Web y comprobado privado/vacío antes de subir. Se configura origin y autor local Alegark con correo noreply; no configuración global ni token en remote. Credencial aislada en .local/github/ con permisos privados, excluida de Git; ningún secreto se guarda en este registro o Engram. La restricción histórica de cuentas/publicación continúa para los servicios no autorizados y no impide esta acción expresa sobre GitHub.

Se prepara commit inicial del estado real de desarrollo, con STATUS.md y exclusiones de almacenamiento privado, dependencias, builds y caches. Typecheck/lint y 180 unitarias PASS sobre fuentes actuales; no build ni aceptación browser nuevos. Push y cotejo del SHA remoto aún pendientes. Crear repo no completa T1/P0 ni publica aplicación, habilita facturación o cambia los gates Telegram/iPhone. ODD+Engram14 con sync y lectura independiente después del registro.


## 2026-11-01 · Primer código subido y cotejado en GitHub privado

Push inicial main completado en https://github.com/Alegark/Pulso-Web. Commit 66a88a8dd112af8af15babda08f31f9b1c3f546b coincide con refs/heads/main remoto; repo comprobado isPrivate=true/isEmpty=false. 351 archivos en snapshot inicial; README/SPEC conservados como enlaces y originales con hashes canónicos. Auditoría previa de paths/tamaños/patrones no detectó secretos de los tipos comprobados y excluyó almacenamiento privado/credenciales/memoria/dependencias/builds/caches; es una comprobación acotada, no garantía universal. Ningún deploy, workflow o facturación habilitado. STATUS explica fuentes en validación y límites de portabilidad de runners históricos. Tipos/lint y180 unitarias PASS registrados antes del commit.

R84 continúa prueba final de doce grupos sobre freeze R83/R81; intento10/12 tuvo observador fetchblob bloqueado por CSP, sin defecto de producto confirmado, y conserva raws. Revisión independiente R85 Sol6.1medium/default iniciada sobre registro/main congelados; ninguna aceptación de main o retirada por iniciar. Su resultado y recibo R84 siguen pendientes, no se publican nuevas fuentes como entrega. El runner R84 puede cambiar durante su trabajo autorizado y queda fuera del commit metodológico posterior. USD0/P0-W no completo/iPhone aplazado permanecen. Sync ODD+Engram14 y lectura independiente después del registro de este resultado.
