# Fuentes físicas y protección de cola

Incremento T12 en curso. R81 core implementado y probado por separado; revisión R82, registro/main R83 e integración de navegador R84 pendientes. No se ha publicado este incremento ni se permite retirar archivos con él. La última entrega vigente es 8cfb8eb02744ca5c.

Un assetId identifica una ficha de almacenamiento y puede seguir existiendo después de reparar su archivo. Para decidir si una copia está en uso hace falta conocer la generación física realmente entregada al reproductor: backend, clave, revisión, hash, longitud y los demás campos del manifiesto. Consultar el asset después de crear una URL no demuestra qué bytes usó esa URL.

`prepareLocalSources()` devuelve cada ocurrencia en orden, incluido A/B/A, con su URL y snapshot validado. Blob captura el manifiesto de la misma lectura verificada que materializa el audio, sin una nueva pasada. Un SW con `physicalSources:1` fija sus tickets al snapshot completo y rechaza un cambio de generación. Las respuestas se emiten después del commit. Los wrappers antiguos siguen devolviendo `string[]`; un controlador legado proporciona protección desconocida, sin conceder autoridad para retirar.

El bundle tiene `release():Promise<void>` idempotente para sus propios recursos. Preparar otra cola no debe invalidar la anterior antes de sustituirla. Liberar tickets no borra archivos ni demuestra que se hayan retirado bytes ya entregados o lectores activos. La generación sigue protegida por lectores compartidos y por las referencias del reproductor cuando corresponda.

El registro root deberá incluir toda la cola preparada y actual, las preparaciones antes del primer await y los recursos de bundles aún retenidos. Si quitar una entrada futura no libera su bundle, el registro conserva esa referencia como retenida. Capturas opacas ligadas a scope/proof/Activity/DBgeneration evitan interpretar un snapshot JSON como permiso. Una fuente desconocida o un desajuste con Player debe seguir siendo desconocido. Pausar, terminar una pista o cambiar repeat/shuffle no autoriza borrar su archivo.

R81: diez grupos Chromium154 nativos con IDB/OPFS/SW/Blob, tipos/lint/TS7 focal PASS. Cubre snapshots, cambios de manifiesto, rangos, lectores, release propio, legado, límites y denegaciones sin fallback. Las inyecciones TESTONLY están identificadas. No demuestra audio sostenido, heap, reapertura offline ni iPhone. Recibo `.local/evidence/local-source-pinning-r81.json` y contrato `.local/local-source-pinning-r81/APIs-final.json`.

El diseño de retirada R78 exige además revisión de referencias, confirmación explícita de pérdida, journal/recibos, exclusión sin deadlock y recuperación de incertidumbre. Nada de eso se considera implementado por fijar fuentes. No se han borrado copias del propietario. USD 0; P0-W e iPhone pendientes.
