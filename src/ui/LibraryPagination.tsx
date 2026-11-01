import React from 'react';
import {pageRange} from '../library/pagination';

/** A changed scope resets synchronously, so a new filter never renders an old page. */
export function useLibraryPage(total: number, scope: string) {
 const [position, setPosition] = React.useState({scope, page: 0});
 const range = pageRange(total, position.scope === scope ? position.page : 0);
 // Commit a clamp/reset so later growth cannot unexpectedly restore an old page.
 React.useEffect(() => {
  if(position.scope !== scope || position.page !== range.page) setPosition({scope, page: range.page});
 }, [scope, range.page, position]);
 return {...range, onPage: (page: number) => setPosition({scope, page: pageRange(total, page).page})};
}

export function LibraryPagination({page, pages, start, end, total, onPage}: ReturnType<typeof useLibraryPage>) {
 return <nav aria-label="Páginas de canciones">
  <p id="library-page-position" role="status">{total ? `${start + 1}–${end} de ${total} canciones` : '0 de 0 canciones'} · Página {page + 1} de {pages}</p>
  <button type="button" aria-disabled={page === 0} aria-describedby="library-page-position" onClick={() => {if(page > 0) onPage(page - 1);}}>Página anterior</button>
  <button type="button" aria-disabled={page === pages - 1} aria-describedby="library-page-position" onClick={() => {if(page < pages - 1) onPage(page + 1);}}>Página siguiente</button>
 </nav>;
}
