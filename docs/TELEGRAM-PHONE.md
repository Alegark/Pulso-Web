# Teléfono internacional y país

El acceso usa un campo de teléfono completo con `+`, código de país y número nacional. Se puede escribir o pegar sin elegir primero un país. La lista de países está dentro de la página, permite buscar por nombre sin tildes, ISO o prefijo y se maneja con teclado o puntero. No depende del menú nativo del navegador remoto.

Un prefijo exclusivo como `+58` muestra Venezuela. Los prefijos compartidos como `+1` no inventan un país: se conserva una elección explícita compatible o se muestra «Prefijo compartido». Un teléfono internacional válido puede enviarse sin precisar ese territorio. La detección usa sólo los datos fijados de `phoneCountries`, sin red, SIM ni ubicación.

Elegir un país sustituye el prefijo reconocido y conserva los dígitos nacionales, incluidos los ceros; si sólo había un prefijo incompleto o desconocido, inserta el nuevo prefijo sin inventar un número. El foco pasa al teléfono. La validación comprueba formato, prefijo conocido y un máximo de 15 dígitos; no acredita que el número exista ni valida el plan nacional.

El borrador se puede editar sin tener autoridad para conectarse. Los callbacks de borradores antiguos caducan por render, y los campos dejan de ser editables durante un envío. Enviar código sigue requiriendo el botón, un número completo válido, autorización, control y las capturas vigentes de sesión/admisión. Escribir, detectar país y elegir una opción no inician sesión ni envían RPC.

La normalización legacy se conserva para sus consumidores. El cambio no modifica SDK, sesión temporal, cuotas, backend, configuración API ni autenticación de cuenta. Biblioteca, copia de reproducción y nuevas acciones de playlist siguen siendo un incremento separado; el componente SelectedSongActions está preparado y todavía no integrado.

Evidencia de la integración y límites: `docs/evidence-telegram-phone-web.json`. La prueba local de los campos no acredita autenticación con cuenta real ni Safari físico.
