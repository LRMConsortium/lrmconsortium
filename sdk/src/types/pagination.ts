import type { PageMeta } from './envelope.js';

/**
 * Pagination helpers.
 *
 * A list call returns a `Page<T>`, which is an array-like carrying its own
 * `meta` and a `next()` that knows how to fetch the following page. Callers that
 * want everything use `collect()` or the async iterator, and never write a
 * `while (hasNext)` loop by hand.
 */

export interface ListQuery {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
  includeDeleted?: boolean;
  [filter: string]: unknown;
}

export type PageFetcher<T> = (query: ListQuery) => Promise<Page<T>>;

export class Page<T> implements Iterable<T> {
  readonly items: T[];
  readonly meta: PageMeta;
  private readonly query: ListQuery;
  private readonly fetcher: PageFetcher<T>;

  constructor(items: T[], meta: PageMeta, query: ListQuery, fetcher: PageFetcher<T>) {
    this.items = items;
    this.meta = meta;
    this.query = query;
    this.fetcher = fetcher;
  }

  get length(): number {
    return this.items.length;
  }
  get hasNext(): boolean {
    return this.meta.hasNext;
  }
  get hasPrev(): boolean {
    return this.meta.hasPrev;
  }
  get total(): number {
    return this.meta.total;
  }

  [Symbol.iterator](): Iterator<T> {
    return this.items[Symbol.iterator]();
  }

  map<U>(fn: (item: T, index: number) => U): U[] {
    return this.items.map(fn);
  }

  /** The next page, or `null` when this is the last one. */
  async next(): Promise<Page<T> | null> {
    if (!this.meta.hasNext) return null;
    return this.fetcher({ ...this.query, page: this.meta.page + 1 });
  }

  async prev(): Promise<Page<T> | null> {
    if (!this.meta.hasPrev) return null;
    return this.fetcher({ ...this.query, page: this.meta.page - 1 });
  }

  /**
   * Every remaining item, page by page.
   *
   *   for await (const landlord of page.stream()) { … }
   *
   * Streams rather than collecting, so a large tenancy roll does not have to fit
   * in memory before the first row can be processed.
   */
  async *stream(): AsyncGenerator<T, void, undefined> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let current: Page<T> | null = this;
    while (current) {
      for (const item of current.items) yield item;
      current = await current.next();
    }
  }

  /**
   * Every remaining item in one array. `maxPages` is a guard against walking a
   * collection that is larger than the caller expected.
   */
  async collect(maxPages = 100): Promise<T[]> {
    const out: T[] = [...this.items];
    let current: Page<T> | null = this;
    let walked = 1;
    while (current?.meta.hasNext && walked < maxPages) {
      current = await current.next();
      if (!current) break;
      out.push(...current.items);
      walked += 1;
    }
    return out;
  }
}

export function emptyPageMeta(limit = 20): PageMeta {
  return { page: 1, limit, total: 0, totalPages: 0, hasNext: false, hasPrev: false };
}
