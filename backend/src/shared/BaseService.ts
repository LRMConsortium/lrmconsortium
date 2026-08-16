import type { FilterQuery, Model, ProjectionType, QueryOptions, UpdateQuery } from 'mongoose';
import { ApiError } from './ApiError.js';
import { pageMeta, type PageMeta } from './http.js';
import type { AuthenticatedActor } from '../types/express.js';

/**
 * The minimum a document must look like to go through `BaseService`.
 *
 * Deliberately not `Record<string, unknown>`: a TypeScript *interface* has no
 * implicit index signature, so `IAd`/`ILandlordProfile` would fail that
 * constraint. This says only what the generic code actually relies on.
 */
export type PersistedDocument = { _id?: unknown };

export interface ListParams {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
  filters?: Record<string, unknown>;
  /**
   * A filter the *server* computed, which is not subject to `filterableFields`.
   *
   * ── Why this is a separate parameter and not just `filters` ───────────────
   * `filters` is the client's. It is passed through an allowlist precisely so a
   * caller cannot query on a field nobody meant to expose. That allowlist did
   * exactly what it was built to do to three authorization clauses: a handler
   * computed `{ $or: [{ payer: ... }, { payee: ... }] }`, handed it to `list()`
   * as a filter, and `$or` — not being a listed field — was dropped. What
   * reached Mongo was `{ deletedAt: null }`, and `GET /payments/:userId/history`
   * answered with the whole platform's ledger. Leases and maintenance had the
   * same defect from the same cause.
   *
   * The lesson is not "add `$or` to the allowlist". It is that an allowlist for
   * untrusted input must never be on the path of trusted input, because the
   * failure mode is silent and it fails *open*. So: two doors. Anything through
   * this one is composed with `$and` and never filtered.
   *
   * An empty object here throws rather than widening — see `buildFilter`.
   */
  serverFilters?: Record<string, unknown>;
  includeDeleted?: boolean;
}

export interface ListResult<T> {
  items: T[];
  meta: PageMeta;
}

export interface BaseServiceOptions<T> {
  /** Human name used in error messages, e.g. "Landlord profile". */
  label: string;
  /** Fields a `?search=` term is matched against (case-insensitive). */
  searchableFields?: (keyof T & string)[];
  /** Fields a client is allowed to filter on. Anything else is ignored. */
  filterableFields?: (keyof T & string)[];
  /** Default sort, mongoose syntax. */
  defaultSort?: string;
  /** Path holding the owning user id — enables `own`-scoped reads. */
  ownerPath?: string;
  /** Path holding the owning organisation id. */
  organizationPath?: string;
  /** Paths to populate on read. */
  populate?: string[];
  maxLimit?: number;
}

/**
 * One CRUD engine for every collection in the platform.
 *
 * The important part is `scopeFor`: ownership and regional scoping are applied
 * in the data layer, not left to each controller to remember. A landlord asking
 * for "all properties" gets a query silently narrowed to their own — the
 * handler above does not have to think about it.
 */
export class BaseService<T extends PersistedDocument> {
  protected readonly model: Model<T>;
  protected readonly opts: Required<
    Pick<BaseServiceOptions<T>, 'label' | 'defaultSort' | 'maxLimit'>
  > &
    BaseServiceOptions<T>;

  constructor(model: Model<T>, options: BaseServiceOptions<T>) {
    this.model = model;
    this.opts = {
      defaultSort: '-createdAt',
      maxLimit: 100,
      ...options,
    };
  }

  get name(): string {
    return this.opts.label;
  }

  /** Narrow a query to what `actor` is allowed to see. */
  protected scopeFor(actor?: AuthenticatedActor): FilterQuery<T> {
    if (!actor) return {};
    const scope = actor.accessScope;
    if (scope === 'global' || scope === 'regional' || scope === 'zonal') return {};

    const clauses: FilterQuery<T>[] = [];
    if (this.opts.ownerPath) {
      clauses.push({ [this.opts.ownerPath]: actor.userId } as FilterQuery<T>);
      if (actor.profileId) {
        clauses.push({ [this.opts.ownerPath]: actor.profileId } as FilterQuery<T>);
      }
    }
    if (this.opts.organizationPath && actor.organizationId) {
      clauses.push({ [this.opts.organizationPath]: actor.organizationId } as FilterQuery<T>);
    }
    if (clauses.length === 0) return {};
    return (clauses.length === 1 ? clauses[0]! : { $or: clauses }) as FilterQuery<T>;
  }

  protected buildFilter(params: ListParams, actor?: AuthenticatedActor): FilterQuery<T> {
    const filter: Record<string, unknown> = {};

    if (!params.includeDeleted) filter.deletedAt = null;

    const allowed = this.opts.filterableFields ?? [];
    for (const [key, value] of Object.entries(params.filters ?? {})) {
      if (value === undefined || value === '' || !allowed.includes(key as keyof T & string)) continue;
      filter[key] = value;
    }

    const search = params.search?.trim();
    const searchable = this.opts.searchableFields ?? [];
    if (search && searchable.length > 0) {
      const rx = new RegExp(escapeRegex(search), 'i');
      filter.$or = searchable.map((f) => ({ [f]: rx }));
    }

    /* ── Composition, not merging ────────────────────────────────────────
     * Everything below is `$and`-ed rather than spread into one object. A
     * spread loses a key when two clauses share it, and the key they share is
     * always `$or`: the client's `?search=` builds one, `scopeFor` builds one,
     * and an authorization filter builds one. Spreading any two of those keeps
     * the last and silently discards the rest — and the one discarded is the
     * one that was restricting the query. */
    const clauses: FilterQuery<T>[] = [filter as FilterQuery<T>];

    if (params.serverFilters !== undefined) {
      /* An empty server filter can only be a mistake, and it is the mistake
       * that leaks: the handler meant to restrict the query and computed
       * nothing. Refusing loudly here turns a silent full-collection read into
       * a 500 in a test run. Deliberate "match nothing" is `{ _id: null }`. */
      if (Object.keys(params.serverFilters).length === 0) {
        throw ApiError.internal(
          `${this.opts.label}: an empty serverFilters is a query nobody restricted`,
        );
      }
      clauses.push(params.serverFilters as FilterQuery<T>);
    }

    const scope = this.scopeFor(actor);
    if (Object.keys(scope).length > 0) clauses.push(scope);

    if (clauses.length === 1) return clauses[0]!;
    return { $and: clauses } as FilterQuery<T>;
  }

  async list(params: ListParams = {}, actor?: AuthenticatedActor): Promise<ListResult<T>> {
    const page = Math.max(1, Math.trunc(params.page ?? 1));
    const limit = Math.min(this.opts.maxLimit, Math.max(1, Math.trunc(params.limit ?? 20)));
    const filter = this.buildFilter(params, actor);

    const query = this.model
      .find(filter)
      .sort(params.sort || this.opts.defaultSort)
      .skip((page - 1) * limit)
      .limit(limit);

    for (const path of this.opts.populate ?? []) query.populate(path);

    const [items, total] = await Promise.all([
      query.lean<T[]>().exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { items, meta: pageMeta(page, limit, total) };
  }

  async findById(
    id: string,
    actor?: AuthenticatedActor,
    projection?: ProjectionType<T>,
  ): Promise<T> {
    const scope = this.scopeFor(actor);
    const filter = { _id: id, deletedAt: null, ...scope } as FilterQuery<T>;
    const query = this.model.findOne(filter, projection);
    for (const path of this.opts.populate ?? []) query.populate(path);
    const doc = await query.exec();
    if (!doc) throw ApiError.notFound(this.opts.label);
    return doc as unknown as T;
  }

  async findOne(filter: FilterQuery<T>): Promise<T | null> {
    return this.model.findOne({ ...filter, deletedAt: null }).exec() as Promise<T | null>;
  }

  async exists(filter: FilterQuery<T>): Promise<boolean> {
    const found = await this.model.exists({ ...filter, deletedAt: null }).exec();
    return found !== null;
  }

  async create(payload: Partial<T>, actor?: AuthenticatedActor): Promise<T> {
    const doc: Record<string, unknown> = { ...payload };
    if (actor) {
      doc.createdBy = actor.userId;
      doc.updatedBy = actor.userId;
      if (this.opts.ownerPath && doc[this.opts.ownerPath] === undefined) {
        doc[this.opts.ownerPath] = actor.userId;
      }
    }
    try {
      const created = await this.model.create(doc as T);
      return created.toObject() as unknown as T;
    } catch (err) {
      throw translateMongoError(err, this.opts.label);
    }
  }

  async update(id: string, payload: UpdateQuery<T>, actor?: AuthenticatedActor): Promise<T> {
    const scope = this.scopeFor(actor);
    const filter = { _id: id, deletedAt: null, ...scope } as FilterQuery<T>;
    const $set = {
      ...(payload as Record<string, unknown>),
      ...(actor ? { updatedBy: actor.userId } : {}),
    };
    const options: QueryOptions<T> = { new: true, runValidators: true, context: 'query' };
    try {
      const doc = await this.model.findOneAndUpdate(filter, { $set }, options).exec();
      if (!doc) throw ApiError.notFound(this.opts.label);
      return doc.toObject() as unknown as T;
    } catch (err) {
      throw translateMongoError(err, this.opts.label);
    }
  }

  /** Soft delete. Nothing in an institutional ledger is ever truly dropped. */
  async remove(id: string, actor?: AuthenticatedActor): Promise<{ id: string }> {
    const scope = this.scopeFor(actor);
    const doc = await this.model
      .findOneAndUpdate(
        { _id: id, deletedAt: null, ...scope } as FilterQuery<T>,
        { $set: { deletedAt: new Date(), status: 'archived', ...(actor ? { updatedBy: actor.userId } : {}) } },
        { new: true },
      )
      .exec();
    if (!doc) throw ApiError.notFound(this.opts.label);
    return { id };
  }

  async restore(id: string, actor?: AuthenticatedActor): Promise<T> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: id } as FilterQuery<T>,
        { $set: { deletedAt: null, status: 'active', ...(actor ? { updatedBy: actor.userId } : {}) } },
        { new: true },
      )
      .exec();
    if (!doc) throw ApiError.notFound(this.opts.label);
    return doc.toObject() as unknown as T;
  }

  /** Back Office verification transition, shared by every verifiable profile. */
  async setVerification(
    id: string,
    status: 'pending' | 'inReview' | 'verified' | 'rejected' | 'suspended',
    actor: AuthenticatedActor,
    note?: string,
  ): Promise<T> {
    const $set: Record<string, unknown> = {
      verificationStatus: status,
      updatedBy: actor.userId,
    };
    if (status === 'verified') {
      $set.verifiedAt = new Date();
      $set.verifiedBy = actor.userId;
      $set.rejectionReason = undefined;
    }
    if (status === 'rejected') $set.rejectionReason = note ?? 'Not specified';
    if (note) $set.verificationNotes = note;

    const doc = await this.model
      .findOneAndUpdate({ _id: id, deletedAt: null } as FilterQuery<T>, { $set }, { new: true })
      .exec();
    if (!doc) throw ApiError.notFound(this.opts.label);
    return doc.toObject() as unknown as T;
  }

  async count(filter: FilterQuery<T> = {}): Promise<number> {
    return this.model.countDocuments({ ...filter, deletedAt: null }).exec();
  }

  /** Does `actor` own `id`? Used by `requireOwnership`. */
  async isOwnedBy(id: string, actor: AuthenticatedActor): Promise<boolean> {
    if (!this.opts.ownerPath && !this.opts.organizationPath) return false;
    const scope = this.scopeFor(actor);
    if (Object.keys(scope).length === 0) return false;
    return this.exists({ _id: id, ...scope } as FilterQuery<T>);
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface MongoLikeError {
  code?: number;
  name?: string;
  keyPattern?: Record<string, unknown>;
  errors?: Record<string, { message?: string; path?: string }>;
  message?: string;
}

export function translateMongoError(err: unknown, label: string): unknown {
  const e = err as MongoLikeError;
  if (e?.code === 11000) {
    const field = Object.keys(e.keyPattern ?? {})[0] ?? 'field';
    return ApiError.duplicate(`${label} ${field}`);
  }
  if (e?.name === 'ValidationError' && e.errors) {
    return ApiError.validation(
      `${label} failed validation`,
      Object.values(e.errors).map((v) => ({ field: v.path ?? '', message: v.message ?? 'invalid' })),
    );
  }
  if (e?.name === 'CastError') {
    return ApiError.badRequest(`Malformed identifier for ${label}`);
  }
  return err;
}
