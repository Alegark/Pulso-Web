export const LIBRARY_PAGE_SIZE = 50;

/** Bounds presentation only. Callers retain the complete selection for actions. */
export function pageRange(total: number, requested: number, size = LIBRARY_PAGE_SIZE) {
 const pages = Math.max(1, Math.ceil(total / size));
 const page = Math.max(0, Math.min(pages - 1, requested));
 const start = page * size;
 return {page, pages, start, end: Math.min(total, start + size), total};
}
