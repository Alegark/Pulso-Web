# T2 · Audio local y cola · EN CURSO

Propósito: piloto W08/W09 bajo V13–V17 y AC04 preliminar, dependiente del bootstrap T1.

Implementado: un Audio persistente fuera de React; tres WAV sintéticos propios A/B/C; IDs separados para track/ocurrencia, snapshot de entradas en memoria; generación invalida listeners/rechazos antiguos, ended deduplicado, replay desde cero, seek acotado, anterior con umbral 3 s, Media Session opcional. Web Locks sin takeover limita propietario por origen.

PASS local: 5 casos del controlador real: A/B/A sin autoplay al seleccionar, ended duplicado/callback antiguo, replay, rechazo antiguo y seek/anterior. Medio simulado; no demuestra DOM, codecs, audibilidad ni bloqueo.

PENDIENTE: pruebas navegador, MP3/AAC-LC, restore pausado desde IDB, repeat/shuffle y transporte mínimo para T3. No se construirá biblioteca/UI completa antes del gate. Fixtures WAV no se confunden con importación ni descargas.

Siguiente: completar fixtures y persistencia mínima con pruebas de publicación/recuperación; luego navegador servido autorizado; preparar acta física antes de solicitar intervención del teléfono. D02/D04/D07 siguen abiertas. No ejecutar Telegram real ni publicar.
