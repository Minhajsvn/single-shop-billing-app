export const PAGE_SIZE = 50;

export type Page<T> = { items: T[]; page: number; pageCount: number; from: number; to: number; total: number };

/** One page of a list. Pages are 1-based and clamped, so removing the last row of the last page steps back a page. */
export function paginate<T>(items: T[], page: number, size = PAGE_SIZE): Page<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  const slice = items.slice(start, start + size);
  return { items: slice, page: current, pageCount, from: total ? start + 1 : 0, to: total ? start + slice.length : 0, total };
}
