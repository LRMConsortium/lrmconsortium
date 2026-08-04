import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export function asyncHandler<
  Req extends Request = Request,
  Res extends Response = Response,
>(fn: (req: Req, res: Res, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req as unknown as Req, res as unknown as Res, next)).catch(next);
  };
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export function ok<T>(res: Response, data: T, status = 200): Response {
  return res.status(status).json({ success: true, data });
}

export function created<T>(res: Response, data: T): Response {
  return res.status(201).json({ success: true, data });
}

export function paginated<T>(res: Response, items: T[], meta: PageMeta): Response {
  return res.status(200).json({ success: true, data: items, meta });
}

export function noContent(res: Response): Response {
  return res.status(204).send();
}

export function pageMeta(page: number, limit: number, total: number): PageMeta {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}
