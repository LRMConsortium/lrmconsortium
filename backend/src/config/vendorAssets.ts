/**
 * The third-party assets LRMC serves itself, and how to tell whether they are
 * really there.
 *
 * Pure — no Mongoose, no Express. Reads `frontend/deploy/vendor.lock.json` and
 * whatever is on disk in `frontend/assets/vendor/`, and reports the difference.
 *
 * ── The failure this exists to prevent ────────────────────────────────────
 * "We self-host Alpine" is a sentence about a directory, and a directory is a
 * thing that can be empty, or half-written, or written by somebody else. The
 * pages fall back to a CDN and then to `boot.js`, so an empty vendor directory
 * does not break anything visibly — it just quietly removes the reason
 * self-hosting was done. That is precisely the kind of thing nobody notices for
 * a year.
 *
 * ── PENDING is not PASS, and it is not FAIL either ────────────────────────
 * This repository was built in a sandbox with no route to unpkg or the npm
 * registry, so the assets could not be fetched and their hashes could not be
 * recorded. The lockfile says `sha384: null` for each one.
 *
 * A hash invented to make an assertion go green would be worse than no
 * assertion at all, so `vendorStatus` reports three states rather than two:
 *
 *   `verified` — the file is present and its bytes match the recorded hash.
 *   `pending`  — no hash has been recorded. The fetch script has not been run.
 *   `broken`   — a hash was recorded and the bytes do not match it, or the
 *                file named in the lockfile is missing while others are there.
 *
 * The suite fails on `broken` and *reports* `pending` as tracked debt, in the
 * same way `PLANNED_PAGES` tracks unbuilt pages. A number that should go down,
 * printed where it cannot be forgotten.
 */

export interface VendorAsset {
  file: string;
  package: string;
  version: string;
  url: string;
  sha384: string | null;
  bytes: number | null;
  why: string;
}

export interface VendorLock {
  assets: VendorAsset[];
}

export type VendorState = 'verified' | 'pending' | 'broken';

export interface VendorReport {
  file: string;
  version: string;
  state: VendorState;
  /** Why, in a sentence somebody deploying can act on. */
  detail: string;
}

/** Assets the lockfile builds rather than downloads. */
export function isBuilt(asset: VendorAsset): boolean {
  return asset.url === 'built';
}

/**
 * Semantic-version shape, loosely.
 *
 * Loose on purpose: the point is to refuse `latest`, `*`, `^3.14` and an empty
 * string, all of which are ways of saying "whatever is newest" — and a build
 * that changes under you is the opposite of what a lockfile is for.
 */
export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export function versionIsPinned(version: string | null | undefined): boolean {
  return typeof version === 'string' && VERSION_PATTERN.test(version);
}

/**
 * `sha384-…` base64, as an SRI hash is written.
 *
 * Checked for shape as well as presence, because the failure mode of a
 * hand-edited lockfile is a hash somebody pasted with the prefix included or a
 * hex digest where base64 was expected — and either would compare unequal
 * forever, which reads as tampering.
 */
/* Exactly 64 characters and NO padding. A sha384 digest is 48 bytes, and 48 is
 * divisible by 3, so base64 needs no `=` at all — a trailing `=` here means
 * somebody pasted a sha256 (which does pad) or hand-edited it. This pattern was
 * written with `=$` first, and it made every real hash look malformed. */
export const SHA384_PATTERN = /^[A-Za-z0-9+/]{64}$/;

export function hashIsWellFormed(hash: string | null | undefined): boolean {
  return typeof hash === 'string' && SHA384_PATTERN.test(hash);
}

/**
 * What state each asset is in.
 *
 * `present` and `hashOf` are passed in rather than read here, so this file
 * stays pure and the suite can drive every branch without writing files.
 */
export function vendorStatus(
  lock: VendorLock,
  present: (file: string) => boolean,
  hashOf: (file: string) => string | null,
): VendorReport[] {
  const assets = Array.isArray(lock?.assets) ? lock.assets : [];

  return assets.map((asset) => {
    const base = { file: asset.file, version: asset.version };

    if (!versionIsPinned(asset.version)) {
      return {
        ...base,
        state: 'broken' as const,
        detail: `Version "${asset.version}" is not pinned. A build that changes under you is not a lockfile.`,
      };
    }

    if (asset.sha384 !== null && !hashIsWellFormed(asset.sha384)) {
      return {
        ...base,
        state: 'broken' as const,
        detail: 'The recorded hash is not base64 sha384. It would never compare equal, which reads as tampering forever.',
      };
    }

    const there = present(asset.file);

    if (!there) {
      /* A missing file with a recorded hash is a regression: somebody fetched
       * it once and it is gone now. A missing file with no hash is simply work
       * that has not been done. */
      return asset.sha384
        ? {
          ...base,
          state: 'broken' as const,
          detail: `Pinned at ${asset.version} but not on disk. It was fetched once; it is not there now.`,
        }
        : {
          ...base,
          state: 'pending' as const,
          detail: isBuilt(asset)
            ? 'Not built yet. Run scripts/bundle.production.sh.'
            : 'Not fetched yet. Run scripts/fetch-vendor-assets.sh.',
        };
    }

    if (!asset.sha384) {
      /* On disk, but nobody wrote down what it should be. That is the state
       * where "we self-host it" is true and "we know what we serve" is not. */
      return {
        ...base,
        state: 'pending' as const,
        detail: 'On disk but not pinned. Run the fetch script with --write to record its hash.',
      };
    }

    const actual = hashOf(asset.file);
    if (actual === asset.sha384) {
      return { ...base, state: 'verified' as const, detail: `sha384 matches at ${asset.version}.` };
    }
    return {
      ...base,
      state: 'broken' as const,
      detail: `Bytes on disk do not match the recorded hash. Expected sha384-${asset.sha384}, got ${actual ? `sha384-${actual}` : 'nothing readable'}.`,
    };
  });
}

/** Nothing is broken. Pending is allowed; wrong is not. */
export function vendorIsSound(reports: VendorReport[]): boolean {
  return !reports.some((r) => r.state === 'broken');
}

/** How much is still outstanding — a number that should go down. */
export function vendorPending(reports: VendorReport[]): VendorReport[] {
  return reports.filter((r) => r.state === 'pending');
}

/**
 * Is this deployable?
 *
 * Separate from `vendorIsSound` and deliberately stricter. A build with pending
 * assets is fine to develop against and **must not** reach the C4 servers: it
 * would serve pages that reach for a CDN LRMC has decided not to depend on, and
 * the whole exercise would be undone silently.
 *
 * `bundle.production.sh` calls this. Nothing else should.
 */
export function vendorIsDeployable(reports: VendorReport[]): boolean {
  return reports.length > 0 && reports.every((r) => r.state === 'verified');
}
