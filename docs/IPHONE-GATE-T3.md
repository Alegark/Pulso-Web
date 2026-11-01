# Gate T3 · incremento revisable

Estado: PREPARADO PARA SOLICITAR ORIGEN HTTPS. NO EJECUTADO en iPhone. No acredita AC04/AC06/AC10 completos.

Paquete: `.local/releases/pulso-t3.tar.gz`, generado desde `dist/` de producción, sin servidor, credenciales, sesión ni bibliotecas privadas. Hashes en `docs/BUILD-MANIFEST.sha256`. Debe servirse en un origen HTTPS dedicado autorizado por el propietario, con `/sw.js` en raíz y mismo origen. No instalar certificados, publicar túneles ni activar servicios/facturación por inferencia. No compartir origen con otros productos: el lock y SW deben quedar aislados. La app no conecta a Telegram.

## Diagnóstico preliminar con el propietario

1. Registrar fecha, hash del build/lockfile, origen, modelo de iPhone, versión exacta de iOS y Safari. Usar inicialmente Safari normal. Volumen moderado: son tonos sintéticos de cuatro segundos.
2. Abrir la raíz `/`. Pulsar **Preparar audios offline**. Esperar «Tres archivos completos verificados». Si falla, conservar mensaje y detener ese caso; no llamarlo descarga completa.
3. Pulsar A y comprobar audiblemente A→B→C sin bloquear. A/C son MP3; B es AAC-LC/M4A. Son archivos distintos, no una pista con cambios de tono.
4. Pulsar A y bloquear enseguida. Observar si siguen A→B→C y controles/metadata del sistema. Anotar qué transición falló y el tiempo, sin sustituir observación por estado de UI. Esto es diagnóstico corto, no la aceptación de 10 pistas/30 minutos.
5. Desactivar Wi-Fi/datos. Cerrar la pestaña; reabrir exactamente el mismo origen `/`. Debe recuperar cola/selección pausada, sin audio espontáneo. Pulsar A: observar A→B→C sin red. Registrar errores y si se tuvo que habilitar red.
6. Con audio en curso, probar pausa, seek y siguiente desde la app y desde controles del sistema disponibles. No asumir soporte si faltan. Registrar interrupciones/ruta solo si se prueban realmente.
7. Chrome normal y modo añadido a Inicio tienen actas nuevas. No copiar PASS de Safari. En modo Inicio se prepara primero su propio almacenamiento si está separado.

## Lo pendiente incluso si pasa

10 pistas / 30 minutos, streaming Telegram con bytes pendientes al bloqueo, OPFS, formatos/archivos grandes, almacenamiento bajo presión, reinicio forzado del SW, interrupciones/auriculares/Bluetooth y todas las demás aceptaciones. La prueba de servidor apagado en Chromium solo acredita ese entorno, no iPhone ni cierre completo del navegador.

El acta puede ser Markdown sin datos privados: caso, acciones, observación audible, resultado PASS/FAIL/NO EJECUTADO, duración y límite. El propietario aporta la observación física; el agente no afirma haber oído el teléfono.

## Protocolo corto vigente solicitado posteriormente por el propietario

El diagnóstico anterior pertenece al piloto inicial. Para la app privada actual416c4e0dbc97cfca y el enlace ya autorizado: abrir Safari, pulsar Cargar música de prueba y comprobar Aurora/Brisa/Camino; apagar repetición y aleatorio, reproducir Aurora y bloquear aproximadamente un minuto sin desbloquear. Informar qué pistas se oyeron y dónde se detuvo. No requiere canciones propias, borrar datos, nuevas cuentas ni permisos. La observación de avance automático bloqueado continúa PENDIENTE hasta el reporte del propietario.

El candidato no incluye aún el nuevo handoff en revisión. Esta prueba corta no acredita30min/10pistas, offline, grandes archivos ni toda la aceptación móvil; el offline del enlace privado sigue sin comprobar. No repetir las acciones antiguas de tonos de4s como si fueran los controles actuales.
