import type { Request, Response } from 'express';
import type { RequestHandler } from 'express';
import { ApiError } from './ApiError.js';
import { asyncHandler, created, noContent, ok, paginated } from './http.js';
import type { BaseService, ListParams, PersistedDocument } from './BaseService.js';

export interface CrudController {
  list: RequestHandler;
  get: RequestHandler;
  create: RequestHandler;
  update: RequestHandler;
  remove: RequestHandler;
  restore: RequestHandler;
  verify: RequestHandler;
  me: RequestHandler;
}

const RESERVED = new Set(['page', 'limit', 'sort', 'search', 'includeDeleted']);

function readListParams(req: Request): ListParams {
  const q = req.query as Record<string, string | undefined>;
  const filters: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(q)) {
    if (RESERVED.has(key) || value === undefined) continue;
    filters[key] = value === 'true' ? true : value === 'false' ? false : value;
  }
  return {
    page: q.page ? Number(q.page) : 1,
    limit: q.limit ? Number(q.limit) : 20,
    sort: q.sort,
    search: q.search,
    includeDeleted: q.includeDeleted === 'true',
    filters,
  };
}

/** Body that survived `validate()`, falling back to the raw body. */
function body<T>(req: Request): T {
  return (req.validated?.body ?? req.body) as T;
}

function requireId(req: Request): string {
  const id = req.params.id;
  if (!id) throw ApiError.badRequest('Missing resource id');
  return id;
}

export function createCrudController<T extends PersistedDocument>(
  service: BaseService<T>,
): CrudController {
  return {
    list: asyncHandler(async (req: Request, res: Response) => {
      const { items, meta } = await service.list(readListParams(req), req.actor);
      return paginated(res, items, meta);
    }),

    get: asyncHandler(async (req: Request, res: Response) => {
      const doc = await service.findById(requireId(req), req.actor);
      return ok(res, doc);
    }),

    create: asyncHandler(async (req: Request, res: Response) => {
      const doc = await service.create(body<Partial<T>>(req), req.actor);
      return created(res, doc);
    }),

    update: asyncHandler(async (req: Request, res: Response) => {
      const doc = await service.update(requireId(req), body(req), req.actor);
      return ok(res, doc);
    }),

    remove: asyncHandler(async (req: Request, res: Response) => {
      await service.remove(requireId(req), req.actor);
      return noContent(res);
    }),

    restore: asyncHandler(async (req: Request, res: Response) => {
      const doc = await service.restore(requireId(req), req.actor);
      return ok(res, doc);
    }),

    verify: asyncHandler(async (req: Request, res: Response) => {
      if (!req.actor) throw ApiError.unauthenticated();
      const { status, note } = body<{ status: 'pending' | 'inReview' | 'verified' | 'rejected' | 'suspended'; note?: string }>(req);
      const doc = await service.setVerification(requireId(req), status, req.actor, note);
      return ok(res, doc);
    }),

    /** `GET /me` — the member-portal entry point for every profile type. */
    me: asyncHandler(async (req: Request, res: Response) => {
      if (!req.actor) throw ApiError.unauthenticated();
      const doc = await service.findOne({ user: req.actor.userId } as never);
      if (!doc) throw ApiError.notFound(`${service.name} for current user`);
      return ok(res, doc);
    }),
  };
}
