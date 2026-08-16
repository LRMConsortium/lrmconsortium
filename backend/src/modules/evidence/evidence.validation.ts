/**
 * Request shapes for the evidence surface.
 *
 * `.strict()` throughout, and what is absent matters: no schema here accepts a
 * `subject` on a *response*, a `status`, or a computed field. A referee cannot
 * name the person they are scoring; a person cannot resolve their own dispute
 * by posting a status; nobody sends `groupHealth`, which is derived from the
 * ledger and never stored.
 */
import { z } from 'zod';
import { DISPUTE_KINDS } from './evidence.model.js';
import { MAX_DISPUTE_SEVERITY } from '../../config/evidence.js';
import { CURRENCIES } from '../../config/currencies.js';
import { MAX_GROUP_MEMBERS, PERIOD_PATTERN } from './groupRules.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const requestReferenceSchema = z
  .object({
    subject: objectId,
    refereeName: z.string().trim().min(2).max(160),
    refereeEmail: z.string().email().optional(),
    refereePhone: z.string().trim().max(30).optional(),
    relationship: z.string().trim().max(120).optional(),
  })
  .strict()
  .refine((v) => v.refereeEmail !== undefined || v.refereePhone !== undefined, {
    path: ['refereeEmail'],
    message: 'A referee needs an email address or a telephone number to be reachable.',
  });

export const respondToReferenceSchema = z
  .object({
    reference: objectId,
    /** 0–100. A referee who will not score is a `declined`, not a zero. */
    score: z.number().int().min(0).max(100),
    comment: z.string().trim().max(2000).optional(),
  })
  .strict();

export const openDisputeSchema = z
  .object({
    subject: objectId,
    kind: z.enum(DISPUTE_KINDS),
    severity: z.number().int().min(1).max(MAX_DISPUTE_SEVERITY),
    summary: z.string().trim().min(10).max(2000),
  })
  .strict();

export const resolveMemberDisputeSchema = z
  .object({
    resolution: z.string().trim().min(4).max(2000),
  })
  .strict();

/** `YYYY-MM`. A period is a month, and a free-form string would not dedupe. */
const period = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Period must be YYYY-MM');

export const ususuContributionSchema = z
  .object({
    subject: objectId,
    period,
    amount: z.number().nonnegative().finite().optional(),
    currency: z.string().trim().max(8).optional(),
    note: z.string().trim().max(600).optional(),
  })
  .strict();

export const ususuMissSchema = z
  .object({
    subject: objectId,
    period,
    note: z.string().trim().max(600).optional(),
  })
  .strict();

/* ═══════════════════════════════════════════════════════════════════════════
 * Ususu groups
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Opening a circle.
 *
 * `members` is optional at creation because a circle is usually formed before
 * everybody has said yes, and `createdBy` is absent because it comes from the
 * token — a register whose keeper is a field somebody fills in is a register
 * nobody is answerable for.
 *
 * `.strict()`, so `status: 'active'` or `groupHealth: 100` is a refusal rather
 * than a silent drop. A field ignored and a field honoured look identical from
 * a client, and a group that could be created already `active` would skip the
 * moment its members are gathered.
 */
export const createUsusuGroupSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    members: z.array(objectId).max(MAX_GROUP_MEMBERS).optional(),
    contributionAmount: z.number().min(0).optional(),
    currency: z.enum(CURRENCIES).optional(),
    region: z.string().trim().max(120).optional(),
    note: z.string().trim().max(600).optional(),
  })
  .strict();

/** Adding or removing one person. The group and the member, and nothing else. */
export const groupMemberSchema = z
  .object({ group: objectId, member: objectId })
  .strict();

/**
 * Recording a contribution.
 *
 * `period` is required and shaped `YYYY-MM`: it is what a streak is counted
 * over and what makes a duplicate detectable. Without it two entries for March
 * are indistinguishable from March and April.
 */
export const groupContributionSchema = z
  .object({
    group: objectId,
    member: objectId,
    period: z.string().trim().regex(PERIOD_PATTERN, 'Write the period as a year and month, such as 2026-08'),
    amount: z.number().min(0),
    currency: z.enum(CURRENCIES).optional(),
    note: z.string().trim().max(600).optional(),
  })
  .strict();

/** Recording a miss. No amount, because nothing was contributed. */
export const groupMissSchema = z
  .object({
    group: objectId,
    member: objectId,
    period: z.string().trim().regex(PERIOD_PATTERN, 'Write the period as a year and month, such as 2026-08'),
    note: z.string().trim().max(600).optional(),
  })
  .strict();
