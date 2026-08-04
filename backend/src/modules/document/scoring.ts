/**
 * Verification scoring — how much confidence a document earns.
 *
 * Four independent dimensions, each 0–100, combined into one weighted figure.
 * The point of keeping them separate is that a reviewer needs to know *which*
 * one is low: a document at 62 because it is blurry needs a re-upload, and one
 * at 62 because the name disagrees with the profile needs a conversation. A
 * single number hides that distinction and turns the score into a rubber stamp.
 *
 * The score never *decides* anything on its own — `MIN_SCORE_TO_VERIFY` is a
 * floor below which a reviewer is refused, not a threshold above which
 * verification happens automatically. A human still signs off.
 */

import {
  DOCUMENT_RULES,
  allowedFieldsFor,
  requiredFieldsFor,
  validateField,
  type DocumentType,
  type FieldBag,
} from './documentRules.js';
import { namesMatch, normalise } from './compliance.js';

export const SCORE_DIMENSIONS = ['completeness', 'clarity', 'consistency', 'crossDocument'] as const;
export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

/**
 * Weights. Completeness dominates because a missing field is the failure a
 * reviewer can do nothing about; cross-document agreement is worth least on its
 * own because the blocking version of that judgement lives in `compliance.ts`.
 */
export const SCORE_WEIGHTS: Record<ScoreDimension, number> = {
  completeness: 0.4,
  clarity: 0.2,
  consistency: 0.25,
  crossDocument: 0.15,
};

/** Below this, verification is refused however willing the reviewer. */
export const MIN_SCORE_TO_VERIFY = 60;

export const SCORE_BANDS = ['poor', 'fair', 'good', 'excellent'] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];

export function scoreBand(score: number): ScoreBand {
  if (score < 50) return 'poor';
  if (score < 70) return 'fair';
  if (score < 85) return 'good';
  return 'excellent';
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Completeness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How much of the type's schema is filled in.
 *
 * Required fields carry the weight; optional ones can only lift a document that
 * has already answered everything mandatory, and are capped at a fifth of the
 * total. Otherwise a submission padded with optional notes could out-score one
 * that actually has its ID number.
 */
export function completenessScore(type: DocumentType, fields: FieldBag): number {
  const required = requiredFieldsFor(type);
  const optional = DOCUMENT_RULES[type].optionalFields;

  const requiredHit = required.filter((f) => present(fields[f])).length;
  const requiredScore = required.length === 0 ? 100 : (requiredHit / required.length) * 100;

  if (requiredHit < required.length) return clamp(requiredScore * 0.8);

  const optionalHit = optional.filter((f) => present(fields[f])).length;
  const optionalBonus = optional.length === 0 ? 20 : (optionalHit / optional.length) * 20;
  return clamp(80 + optionalBonus);
}

// ─────────────────────────────────────────────────────────────────────────────
// Clarity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How legible the artefact is.
 *
 * These inputs come from the storage provider's extraction step, which is
 * stubbed — so clarity is the one dimension that degrades to a neutral 70 when
 * nothing is known, rather than to zero. Scoring an unmeasured document as
 * illegible would block every upload until OCR exists.
 */
export interface ClaritySignals {
  /** Bytes. A 4 KB "scan" is a screenshot of an error page. */
  fileSize?: number;
  pageCount?: number;
  /** 0–1, from OCR. */
  ocrConfidence?: number;
  /** Longest edge in pixels. */
  resolution?: number;
  mimeType?: string;
}

export const CLARITY_NEUTRAL = 70;
export const MIN_USEFUL_BYTES = 20_000;
export const MIN_USEFUL_RESOLUTION = 1000;

export function clarityScore(signals: ClaritySignals = {}): number {
  const parts: number[] = [];

  if (signals.ocrConfidence !== undefined) {
    parts.push(clamp(signals.ocrConfidence * 100));
  }
  if (signals.fileSize !== undefined) {
    parts.push(clamp(Math.min(1, signals.fileSize / MIN_USEFUL_BYTES) * 100));
  }
  if (signals.resolution !== undefined) {
    parts.push(clamp(Math.min(1, signals.resolution / MIN_USEFUL_RESOLUTION) * 100));
  }
  if (signals.mimeType !== undefined) {
    // A PDF or a photograph is fine; anything else is a reviewer's problem.
    const good = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic'];
    parts.push(good.includes(signals.mimeType) ? 100 : 40);
  }

  if (parts.length === 0) return CLARITY_NEUTRAL;
  return clamp(parts.reduce((a, b) => a + b, 0) / parts.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// Consistency
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Does the document contradict itself?
 *
 * Every field is re-run through its own validator, and the dates are checked
 * against each other. A malformed field costs more than a merely absent one,
 * because absence is a gap and malformation is a claim that cannot be true.
 */
export function consistencyScore(type: DocumentType, fields: FieldBag, asOf: Date): number {
  const allowed = allowedFieldsFor(type);
  const populated = Object.entries(fields).filter(([f, v]) => allowed.includes(f) && present(v));
  if (populated.length === 0) return 0;

  let penalty = 0;
  for (const [field, value] of populated) {
    if (validateField(field, value, asOf)) penalty += 1;
  }

  const issued = fields.issuedOn ? new Date(String(fields.issuedOn)) : null;
  const expires = fields.expiresOn ? new Date(String(fields.expiresOn)) : null;
  const dob = fields.dateOfBirth ? new Date(String(fields.dateOfBirth)) : null;

  if (issued && expires && expires.getTime() <= issued.getTime()) penalty += 2;
  if (dob && issued && dob.getTime() > issued.getTime()) penalty += 2;
  // A document issued to someone before they could sign it.
  if (dob && issued && issued.getFullYear() - dob.getUTCFullYear() < 0) penalty += 2;

  const worst = populated.length + 4;
  return clamp((1 - penalty / worst) * 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-document agreement
// ─────────────────────────────────────────────────────────────────────────────

export interface SiblingDocument {
  type: DocumentType;
  status: string;
  fields: FieldBag;
}

/**
 * Does this document agree with the holder's other verified documents?
 *
 * Compared only against *verified* siblings — agreeing with another unverified
 * upload proves nothing, and would let two forged documents vouch for each
 * other. With no verified siblings there is nothing to agree or disagree with,
 * so the dimension returns a neutral score rather than a perfect one.
 */
export const CROSS_NEUTRAL = 75;

export function crossDocumentScore(fields: FieldBag, siblings: SiblingDocument[]): number {
  const verified = siblings.filter((s) => s.status === 'verified');
  if (verified.length === 0) return CROSS_NEUTRAL;

  let comparisons = 0;
  let agreements = 0;

  for (const sibling of verified) {
    if (present(fields.holderName) && present(sibling.fields.holderName)) {
      comparisons += 1;
      if (namesMatch(fields.holderName, sibling.fields.holderName)) agreements += 1;
    }
    if (present(fields.dateOfBirth) && present(sibling.fields.dateOfBirth)) {
      comparisons += 1;
      const a = new Date(String(fields.dateOfBirth)).toISOString().slice(0, 10);
      const b = new Date(String(sibling.fields.dateOfBirth)).toISOString().slice(0, 10);
      if (a === b) agreements += 1;
    }
    if (present(fields.address) && present(sibling.fields.address)) {
      comparisons += 1;
      if (normalise(fields.address).includes(normalise(sibling.fields.address).split(' ')[0] ?? '')) {
        agreements += 1;
      }
    }
  }

  if (comparisons === 0) return CROSS_NEUTRAL;
  return clamp((agreements / comparisons) * 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// The composite
// ─────────────────────────────────────────────────────────────────────────────

export interface DocumentScore {
  completeness: number;
  clarity: number;
  consistency: number;
  crossDocument: number;
  overall: number;
  band: ScoreBand;
  /** True when the score alone permits a reviewer to verify. */
  meetsVerificationFloor: boolean;
  /** The lowest dimension, so a reviewer knows what to ask for. */
  weakest: ScoreDimension;
}

export function scoreDocument(input: {
  type: DocumentType;
  fields: FieldBag;
  asOf: Date;
  clarity?: ClaritySignals;
  siblings?: SiblingDocument[];
}): DocumentScore {
  const completeness = completenessScore(input.type, input.fields);
  const clarity = clarityScore(input.clarity);
  const consistency = consistencyScore(input.type, input.fields, input.asOf);
  const crossDocument = crossDocumentScore(input.fields, input.siblings ?? []);

  const overall = clamp(
    completeness * SCORE_WEIGHTS.completeness +
      clarity * SCORE_WEIGHTS.clarity +
      consistency * SCORE_WEIGHTS.consistency +
      crossDocument * SCORE_WEIGHTS.crossDocument,
  );

  const dimensions: [ScoreDimension, number][] = [
    ['completeness', completeness],
    ['clarity', clarity],
    ['consistency', consistency],
    ['crossDocument', crossDocument],
  ];
  const weakest = dimensions.reduce((low, d) => (d[1] < low[1] ? d : low))[0];

  return {
    completeness,
    clarity,
    consistency,
    crossDocument,
    overall,
    band: scoreBand(overall),
    meetsVerificationFloor: overall >= MIN_SCORE_TO_VERIFY,
    weakest,
  };
}
