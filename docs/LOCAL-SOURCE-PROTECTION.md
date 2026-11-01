# Fuentes físicas y protección de cola

Protección de fuentes entregada en `b88da5c9b1ea9b8c`; reserva documental y guardas de admisión verificadas en la entrega posterior `3899d01ac792b938`. R86/R87 core y R88/R90 root tienen aceptación focal. No se permite retirar archivos con este incremento. Núcleo e interfaz de retirada explícita empiezan aparte en R91/R92, aún sin integrar.


Un assetId identifica una ficha de almacenamiento y puede seguir existiendo después de reparar su archivo. Para decidir si una copia está en uso hace falta conocer la generación física realmente entregada al reproductor: backend, clave, revisión, hash, longitud y los demás campos del manifiesto. Consultar el asset después de crear una URL no demuestra qué bytes usó esa URL.

`prepareLocalSources()` devuelve cada ocurrencia en orden, incluido A/B/A, con su URL y snapshot validado. Blob captura el manifiesto de la misma lectura verificada que materializa el audio, sin una nueva pasada. Un SW con `physicalSources:1` fija sus tickets al snapshot completo y rechaza un cambio de generación. Las respuestas se emiten después del commit. Los wrappers antiguos siguen devolviendo `string[]`; un controlador legado proporciona protección desconocida, sin conceder autoridad para retirar.

El bundle tiene `release():Promise<void>` idempotente para sus propios recursos. Preparar otra cola no debe invalidar la anterior antes de sustituirla. Liberar tickets no borra archivos ni demuestra que se hayan retirado bytes ya entregados o lectores activos. La generación sigue protegida por lectores compartidos y por las referencias del reproductor cuando corresponda.

El registro root incluye toda la cola preparada y actual, las preparaciones antes del primer await y los recursos de bundles aún retenidos. Si quitar una entrada futura no libera su bundle, el registro conserva esa referencia como retenida. Capturas opacas ligadas a scope/proof/Activity/DBgeneration evitan interpretar un snapshot JSON como permiso. Una fuente desconocida o un desajuste con Player debe seguir siendo desconocido. Pausar, terminar una pista o cambiar repeat/shuffle no autoriza borrar su archivo.

R81: diez grupos Chromium154 nativos con IDB/OPFS/SW/Blob, tipos/lint/TS7 focal PASS. Cubre snapshots, cambios de manifiesto, rangos, lectores, release propio, legado, límites y denegaciones sin fallback. Las inyecciones TESTONLY están identificadas. No demuestra audio sostenido, heap, reapertura offline ni iPhone. Recibo `.local/evidence/local-source-pinning-r81.json` y contrato `.local/local-source-pinning-r81/APIs-final.json`.

El diseño de retirada R78 exige además revisión de referencias, confirmación explícita de pérdida, journal/recibos, exclusión sin deadlock y recuperación de incertidumbre. Nada de eso se considera implementado por fijar fuentes. No se han borrado copias del propietario. USD 0; P0-W e iPhone pendientes.


R83 conserva capturas opacas y seriales estables ante ticks, pending antes del primer await, stage/publish antes de Player.setQueue y cleanup propio. Quitar una entrada futura mantiene los recursos del bundle como retainedSources hasta liberar el bundle completo. Diez unitarias del registro PASS; tipos y lint actuales PASS. R84: doce grupos Chromium154 con sandbox, dos controles de main sin transformar y diez observaciones TESTONLY. Incluye arranque frío IDB/OPFS, cola A/B/A, selección completa53, generaciones, DB/proof/Activity, handoff, refresh de rescan/backup y limpieza propia. No sustituye Player/IDB/lector. Los probes Blob usan una página blank propia para respetar la CSP del producto. Sus fallos de arnés y selecciones anteriores quedan separados.

Recibos locales: `.local/evidence/source-protection-r83.json` y `.local/evidence/source-protection-main-r84.json` (SHA-256 `7befa295d490cc8e14499538e52e8dfdc9e8cfabd02acfe6a1c7514dec74d90d`). R85 aprueba limitadamente el delta R83 con seis probes propios; la entrega final y sus checks se describen a continuación. No autoridad de borrado ni aceptación global de T12/P0, iPhone/Safari o modo privado offline.

Build candidato `b88da5c9b1ea9b8c`: compilación y cuatro checks dirigidos PASS (assets IDB/OPFS, seis teclado, tres licencias/shell offline y actualización normal8cfb→b88). Readback133 archivos src/public/dist exacto. Revisión R85 cerrada favorable; entrega y smoke HTTPS privado PASS. Resumen portable: `docs/evidence-source-protection-web.json`.

Misma copia HTTPS autorizada actualizada35 archivos con lectura SHA y assets viejos conservados; `/open.html` selecciona b88. Smoke propio Chromium154 PASS: biblioteca/mini, importación/APIC y etiquetas propias, reinspección sin cambios con audio activo, playlists/lote, letras locales, backupv2, copias OPFS verificar/exportar segundo gesto con hash exacto/URL propia liberada, diagnóstico opt-in,17avisos y handoff real a nueva owner pausada. Un Audio por documento, CSP intacta. Transporte privado Blob8/24MiB; offline privado NO demostrado. Padre coteja133src/public/dist y11recibos separados en `.local/evidence/source-protection-delivery-parent-verification.json`.

R86 siguiente: reserva opaca documental no destructiva y rechazo de preparaciones nuevas mientras esté vigente. Sólo implementación del registro y tests propios; root/admisión y revisión de esa API aún pendientes. El source de desarrollo puede cambiar después del snapshot entregado; no reetiquetar los recibos anteriores sobre él. No executor/journal/UI de retirada, no borrados ni permisos nuevos. P0-W/T12/iPhone continúan pendientes.


Reserva en desarrollo posterior a la entrega b88: R86 añade reserve/hasReservation/canPrepare con ocho grupos y18unitarias PASS; R87 core favorable con seis probes propios. Root integra `source-review-admission.ts`, captura opaca privada y epoch de callbacks, token Activity propio, rechazo antes de pausar/preparar cola y bloqueo de mutaciones/persistencia de posición mientras esté ocupada. Lectura y reproducción continúan. Los23tests focales incluyen cinco nuevos del adaptador; tipos/lint PASS. R88 navegador de aplicación y R89 revisión root PENDIENTES, no nueva entrega. No botón ni executor/journal de retirada, y la reserva por sí sola no acredita presencia del archivo ni autoriza perder un original.


Validación root pendiente: R89 detectó un callback antiguo de guardado manual de letras que conservaba permiso; R88 confirmó una escritura real en IDB durante la reserva con datos sintéticos. Root añadió `captureWriteCurrent` al panel, con guarda de época capturada al renderizar, permiso vigente y comprobación antes de Activity/mutador, también para ausencia y borrador de archivo. Seis probes de lógica y tipos/lint PASS; nuevo navegador R88 y revisión R90 siguen PENDIENTES. El RED nativo y freeze anterior se conservan; no nueva entrega sobre estos cambios hasta cerrarlos.


R88 final: once grupos Chromium154 sandbox PASS sobre diez fuentes congeladas, incluidos dos controles de main sin transformar. La regresión nativa de callbacks antiguos guardar/ausencia/importar letras pasa durante y después de la reserva, mientras un gesto nuevo posterior sí guarda. RED original conservado y separado. Revisión R90 y nuevo build/checks de producto PENDIENTES; la entrega b88 sigue vigente. Esto valida admisión documental, todavía sin interfaz reservadora ni retiro de archivos.


## Cierre web de reserva y guardas · 2026-11-01

R90 cierra R89-P2-01 con seis grupos propios de lógica Node; el GREEN nativo corresponde a los once grupos finales de R88, cotejados con freeze10. RED original nativo conservado. No suma de etapas como suite única. Build `3899d01ac792b938`, checks de assets IDB/OPFS, teclado6, licencias3/shelloffline y actualización normal desde b88 PASS. Padre coteja134src/public/dist y12recibos separados, luego35archivos de la copia HTTPS autorizada con assets previos conservados. Smoke propio PASS: un Audio, importación/portada/tags propios, rescan sin cambios con audio activo, biblioteca/mini, playlist/lote, letras locales, backupv2, copias por segundo gesto y handoff a nueva owner pausada. Transporte privado Blob8/24MiB; offline privado sigue pendiente.

`sourceReview` queda privado en root: puede reservar una generación sin pausar la reproducción y conserva exclusión hasta su release, aun si pierde vigencia. Todavía no hay interfaz de reservar o retirar en esta entrega. R91 implementa el núcleo con consentimiento y journal; R92 prepara presentación controlada; su integración, revisión y pruebas siguen pendientes. Resumen: `docs/evidence-source-reservation-web.json`.
