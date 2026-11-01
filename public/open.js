// Network-only entry: never clears storage, changes ownership or activates a SW.
// The private gateway has already authorized this request before this file runs.
const status = document.getElementById('opening');
const retry = document.getElementById('retry');
retry.addEventListener('click', () => location.reload());
const address = new URL(location.href);
if (address.searchParams.has('_token')) {
  address.searchParams.delete('_token');
  history.replaceState(null, '', address.pathname + address.search + address.hash);
}
async function openLatest() {
  try {
    const response = await fetch('/latest.json', {cache: 'no-store', credentials: 'same-origin'});
    if (!response.ok) throw new Error('latest-unavailable');
    const result = await response.json();
    if (result?.version !== 1 || typeof result.entry !== 'string' || !/^\/releases\/[a-f0-9]{16}\.html$/.test(result.entry)) throw new Error('latest-invalid');
    const link = document.getElementById('latest');
    link.href = result.entry;
    link.hidden = false;
    status.textContent = 'Abriendo la última versión de prueba…';
    location.replace(result.entry);
  } catch {
    status.textContent = 'No se pudo consultar la versión. Comprueba la conexión y abre el enlace privado completo en este navegador.';
    retry.hidden = false;
  }
}
void openLatest();
