import { z } from 'zod';
import { ERROR_KINDS, MAX_MESSAGE, MAX_STACK } from './errorCollector.js';

/**
 * A fault report from a browser.
 *
 * The most permissive schema on the platform, and deliberately so: the most
 * valuable report is the one from a page that broke before the member could
 * sign in, and every field somebody has to get right is a report that never
 * arrives.
 *
 * `.strict()` all the same. Not to be difficult — to keep this from quietly
 * becoming a general-purpose write endpoint. An intake that accepts unknown
 * fields is an intake somebody eventually posts a whole object graph to, and
 * the error log becomes a second copy of the database.
 *
 * Note what is **absent**: no `reportedBy` (it comes from the token, if there
 * is one), no `severity` (derived from the kind — a client that could set it
 * could page a coordinator at will), and no `path` (derived from `url`, which
 * is reduced to a template before storage).
 */
export const errorReportSchema = z
  .object({
    kind: z.enum(ERROR_KINDS),
    message: z.string().trim().min(1).max(MAX_MESSAGE * 2),
    /** The script, not the data. Kept, and redacted anyway. */
    source: z.string().trim().max(600).optional(),
    line: z.number().int().min(0).max(10_000_000).optional(),
    column: z.number().int().min(0).max(10_000_000).optional(),
    stack: z.string().max(MAX_STACK * 2).optional(),
    /** The page. Reduced to a path template server-side; never stored raw. */
    url: z.string().max(2000).optional(),
    /** Which control, for a dead path. */
    control: z.string().trim().max(200).optional(),
  })
  .strict();
