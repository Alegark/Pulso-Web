# Barra inferior del reproductor

Corrección solicitada sobre la captura de la app funcional, 2026-11-13.

| Before | After | Why |
| --- | --- | --- |
| Barra alta, con el volumen distribuido como un formulario | Dock de88px en escritorio, con tres zonas alineadas | Dar espacio a la página y mantener los controles cerca. |
| Etiquetas visibles «Posición» y «Volumen», con sliders grandes | Tiempos junto al progreso y un icono de volumen | Jerarquía musical y controles reconocibles; nombres accesibles conservados. |
| Play descentrado respecto al progreso por el botón de abrir | Anterior/Play/Siguiente centrados; abrir junto al volumen | Alinear visualmente el transporte con la pista temporal. |
| Slider del volumen extendido a toda la columna | Control de volumen acotado, sin borde de campo de formulario | Evitar que domine la barra. |
| Un override de padding dejaba contenido detrás del dock | Reserva inferior según las alturas medidas de barra y navegación | Permitir llegar al final del contenido. |

En móvil se conservan título, intérprete, Play/Pausa y abrir, con controles de44px. Seek y volumen aparecen desde1024px. El escritorio con puntero preciso usa Play de36px; con puntero táctil conserva44px. Los ranges mantienen teclado nativo y foco visible. Las barras de progreso usan valores HTML y CSS estático: no añaden estilos inline incompatibles con CSP ni efectos sobre audio.

La presentación está concentrada en `src/ui/mini-player.css`, importado después de las hojas generales. `MiniPlayer.tsx` conserva handlers y nombres accesibles; no se cambian el reproductor, la cola, Telegram, la pertenencia a Biblioteca ni el almacenamiento. No se crea otro Audio. La portada opcional del contrato sólo se presenta cuando el propietario la proporciona; este incremento no añade lectura de imágenes ni peticiones remotas.

Las pruebas locales usan datos y audio propios en perfiles aislados, separados de la sesión y música del propietario. Evidencia y límites: `docs/evidence-mini-player-layout-web.json` y `.local/mini-player-layout/`.
