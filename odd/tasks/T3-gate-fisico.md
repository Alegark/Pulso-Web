# T3 · Transporte mínimo y gate físico · EN CURSO

Objetivo: AC04/AC06/AC10 preliminares; V8,V17,V19,V30. Depende del piloto T2. No avanzar a UI completa antes de resolver la frontera móvil.

Implementado: fixtures MP3 A/C y AAC-LC/M4A B, propias/sintéticas; fallback IDB por chunks con hash incremental @noble/hashes; staging con operación, relectura integral antes de commit y revisión esperada; publicación tras commit; fallo incierto preserva staging. No cleanup destructivo automático. Store limitado a fixtures, aún sin OPFS ni importación general.

SW de producción: shell versionado separado, sin skipWaiting; tickets opacos por owner y generación, namespace local, validación antes de bytes; propietario probado con Web Locks + capacidad aleatoria; ranges y HEAD. Restaura selección/posición pausada y crea tickets nuevos, sin Object URLs persistidas.

PASS Chromium 154 Linux en preview de T3: A→B→C WAV; después MP3→AAC→MP3 mediante ruta SW. Servidor 4173 apagado, reabrir `/` desde shell, restaurar B pausada y luego reproducir A→B→C. No demuestra audibilidad física. Segunda pestaña bloqueada sin takeover. PASS 9 checks HTTP: cerrado/abierto/sufijo/416/multipart 200/HEAD/ticket inválido/GET-MIME y ticket publicado. PASS 6 casos IDB reales en runner aislado por origen 4174. PASS 8 unitarias locales. Evidencia resumida en docs/evidence-*.json y DEVICE-MATRIX.md.

Fallos observados y corregidos: IDs de Web Locks no iguales a IDs de Clients SW; cursor de revocación borraba tickets recién creados; Vary: Origin del servidor preview impedía recuperar módulos offline. Véase docs/DEFECTS.md. No se modificó SPEC original.

Límites: SW forzado a terminar/reiniciar NO EJECUTADO; cierre completo del navegador NO EJECUTADO; cuota/cortes exhaustivos NO EJECUTADOS; iPhone/Safari/Chrome/Inicio NO EJECUTADOS. No descargar/importar música del propietario todavía. FixtureStore no es T6 completo.

Siguiente: origen HTTPS dedicado autorizado e intervención física con docs/IPHONE-GATE-T3.md. Continuar preflight SDK público T4 sin autenticar ni prometer gate aprobado. Objetivo P0-W ACTIVO y sin aceptación completa.

Refuerzo posterior del mismo gate: validación de manifiesto/huella antes de servir audio, clientId obligatorio y proof lock ligado al titular global. PASS 9 unitarias locales; PASS 11 casos de IDB real (incluyen 5 nuevos cortes/corrupción); cuota simulada mediante excepción de IDB, no agotamiento real del disco. PASS 5 checks de integridad/revocación y otra pestaña 403 sin bytes. Repetición A→B→C y reapertura con servidor apagado PASS Chromium tras los cambios. Evidencia evidence-storage-cuts.json, evidence-media-integrity.json y evidence-cross-tab.json. No se ejecutó iPhone ni terminación forzada del SW. T3 permanece EN CURSO; no expandir UI para eludir ese gate.

Cambio expreso posterior del propietario: gate físico APLAZADO/PENDIENTE durante la fase WEB. Ya no bloquea T6 y posteriores que puedan probarse independientemente en web. Sus resultados locales no prueban Safari/iPhone ni pantalla bloqueada. Se conserva este historial y la aceptación física final, sin nuevas peticiones de teléfono en esta fase.

## Primera observación física aportada por el propietario

Tras recuperar el servidor, el propietario informó: «Funciona bien aún con bloqueo». Contexto declarado anteriormente: iPhone 13/iOS 27; captura muestra Safari, sin versión del navegador verificada. Registrar observación positiva preliminar de reproducción bloqueada, duración y transición entre archivos DESCONOCIDAS. Se preguntó únicamente si siguió la misma pista o avanzó a otra para distinguir AC04; no se declara AC04 completo, ni 10 pistas/30 minutos, remoto, offline o modo Inicio.

La captura anterior de «Nothing is listening on this port in the sandbox» y la ausencia de listener/handle confirmaron caída del servidor temporal, recuperado como servicio de usuario propio de Pulso. HTTPS y archivo sintético vuelven a 200; enlace privado conservado, sin tocar servicios ajenos. Mientras la VM corra, el proceso ya no depende de la sesión de la herramienta. No se promete servicio después de detener la VM.

Aclaración posterior del propietario a la pregunta de avance: «Todavía no lo comprobé». La transición automática entre pistas con pantalla bloqueada queda explícitamente NO EJECUTADA/PENDIENTE. La observación previa solo aporta continuidad de reproducción bloqueada, sin duración medida. No elevarla a AC04 completo ni repetir preguntas como si faltara una respuesta.

El propietario respondió «Funciona bien» tras recibir el enlace directo a /samples.html con tres muestras visibles. Registrar conformidad funcional preliminar de esa página en su contexto de teléfono, no asumir que observó las tres transiciones ni que hizo la prueba bloqueada: esos detalles no fueron especificados. No volver a pedir ahora la misma comprobación. Se conserva la aceptación completa pendiente y la prioridad de continuar implementación web.

## Instrucciones físicas solicitadas por el propietario

Tras entregar recuperación web, el propietario preguntó qué probar en iPhone. Se dio protocolo corto para candidato privado416c4e0dbc97cfca: Safari, Cargar música de prueba (Aurora/Brisa/Camino), repetición desactivada/aleatorio apagado, reproducir Aurora y bloquear un minuto, informar si avanzó sola a Brisa y Camino. No se pidió nuevamente modelo/iOS ni acceso, no se alteró almacenamiento. Esta interacción prepara observación física, no la sustituye: resultado todavía PENDIENTE; las aceptaciones restantes siguen APLAZADAS/PENDIENTES. docs/IPHONE-GATE-T3.md añade protocolo vigente conservando el diagnóstico histórico.
