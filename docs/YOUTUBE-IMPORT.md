# Importar playlists de YouTube

Configuración → General → «Importar playlist de Spotify o YouTube» acepta también un enlace de YouTube con `list=`.

- `GET /api/youtube-playlist?list=<id>` (Worker, `deployment/cloudflare/youtube-playlist.mjs`) lee títulos y canal con la API oficial YouTube Data v3. Requiere el secret `YOUTUBE_API_KEY` (Google Cloud → YouTube Data API v3 → clave restringida a esa API; 10 000 unidades/día, una playlist de 1300 videos ≈ 28). Solo same-origin; no devuelve ids de video ni la clave. Sin el secret responde 503 y la UI lo explica.
- `src/library/youtube-playlist.ts` convierte cada video en título + artista: canal «X - Topic» = artista; «Artista - Título» se separa; se quitan «Official Video», «Lyric Video», hashtags; shorts, mixes y similares se descartan. Una subida de fans con el canal como artista simplemente no aparecerá en el bot.
- `src/playlists/youtube-import.ts` guarda la playlist en Biblioteca igual que el importador de Spotify (misma transacción, límites y membresía). Reutiliza canciones ya presentes con el mismo título y artista, prefiriendo la que tiene copia. Reimportar la misma lista actualiza su playlist en vez de duplicarla.
- Las canciones sin copia se envían a `requestLibraryDownload`, la misma descarga de colección que «Descargar playlist completa»: una tras otra, una canción fallida se aparta y el resto continúa, con reanudación automática.

Pruebas: `tests/unit/youtube-playlist.test.ts` (conversión, cliente y ruta del Worker con Google simulado) y `tests/integration/check-youtube-import.mjs` (importar → playlist → la descarga sigue tras fallos → reabrir sin red y reproducir la copia). Sin tráfico real de Telegram, YouTube ni bots.
