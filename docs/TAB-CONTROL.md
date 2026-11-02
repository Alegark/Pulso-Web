# Control entre pestañas

Contrato verificado localmente: 17 grupos de navegador completos, incluidos dos controles de main sin transformar. Entrega privada c7f4189340719290 cotejada por separado; iPhone físico sigue pendiente.

Puedes mantener varias pestañas de Pulso abiertas. «Usar en esta pestaña» solicita que la anterior guarde la cola y la posición, suspenda el reproductor y libere el control. Esta pestaña sólo se admite después de obtener los bloqueos nativos; restaura la selección en pausa. «Reproducir» añade una intención explícita de continuar después de la restauración. Si el navegador requiere otro gesto, se muestra el aviso del reproductor y se pulsa Reproducir de nuevo.

Cambiar de pestaña o enfocar la ventana no transfiere el control ni inicia música. Una operación activa, resultado incierto, reserva o estado de almacenamiento incompatible puede impedir el traspaso. Resuelve el pendiente y solicita otra vez. Cancelar invalida la solicitud local y la intención de reproducir; una cesión ya iniciada en la otra pestaña puede terminar igualmente. Sin respuesta o con versiones anteriores se conserva la exclusión: cede manualmente allí o cierra esa entrada.

La cuenta Telegram sigue siendo temporal y propia de cada pestaña en la versión actual. Este cambio no transfiere su sesión ni implementa su persistencia futura. Pruebas locales no acreditan Safari/iPhone físico, reproducción bloqueada ni P0 completo.
