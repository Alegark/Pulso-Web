
## Leer playlists de YouTube (opcional)

`api/youtube-playlist.js` lee una playlist **pública o no listada** (solo títulos y nombre del canal) con la API oficial de YouTube Data v3. El navegador no puede leer youtube.com, por eso pasa por esta función. Solo acepta llamadas de la propia app (`Sec-Fetch-Site: same-origin`).

Requiere la variable `YOUTUBE_API_KEY`: Google Cloud Console → proyecto nuevo → APIs y servicios → Biblioteca → «YouTube Data API v3» → Habilitar → Credenciales → Crear credenciales → Clave de API (restringirla a esa API). La cuota gratuita es de 10 000 unidades/día; una playlist de 1300 videos cuesta unas 28.

```sh
npx vercel env add YOUTUBE_API_KEY production
npx vercel deploy --prod
```

Sin la variable el campo de enlace avisa que no está configurado y el pegado manual de líneas sigue funcionando.
