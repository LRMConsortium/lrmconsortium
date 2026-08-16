/**
 * The built frontend, and whether it is internally consistent.
 *
 * Pure — no Mongoose, no Express, no filesystem. `bundle.production.sh` writes
 * `dist/asset-manifest.json`; this file says what a sound manifest looks like
 * and what has to be true of the pages built alongside it.
 *
 * ── The failure this exists to catch ──────────────────────────────────────
 * A build is a rewrite of every page, and a rewrite that misses one is silent.
 * The page loads, most of it works, and one stylesheet or one script 404s —
 * which on a hashed-filename deployment means it 404s *forever*, because there
 * is no unhashed fallback to fall back to. The member sees an unstyled page or
 * a dead control and has no way to describe either.
 *
 * So the questions here are all "does the built output agree with itself":
 *
 *   • Does every asset the pages reference exist in the manifest?
 *   • Does every asset in the manifest have a hashed name, so it can be
 *     cached forever without a deploy stranding somebody?
 *   • Has every page stopped reaching for the Tailwind CDN?
 *   • Does the compiled palette match the one the pages were designed against?
 *
 * ── Why the palette check is here ─────────────────────────────────────────
 * The pages carry an inline `tailwind.config` for the CDN build; the CLI build
 * reads `tailwind.config.js`. Two configs is two things to keep in step, and a
 * compiled stylesheet built from a different palette is a site that looks
 * subtly wrong everywhere and obviously wrong nowhere — which is the hardest
 * kind of visual bug to notice and the easiest to ship.
 */

export interface ManifestEntry {
  /** The served path, with the content hash in the filename. */
  path: string;
  /** `sha384-…`, for a Subresource Integrity attribute. */
  integrity: string;
  bytes: number;
}

export interface AssetManifest {
  generatedFrom: string;
  assets: Record<string, ManifestEntry>;
}

/**
 * A hashed filename: `name.HASH.ext`, hash at least eight characters.
 *
 * The point of the hash is that the name changes when the bytes do, which is
 * what lets nginx cache the file for a year. An unhashed name in a manifest is
 * a file that either cannot be cached or will be stale for somebody.
 */
export const HASHED_NAME = /\.[A-Za-z0-9]{8,}\.(js|css)$/;

export function isHashed(path: string): boolean {
  return HASHED_NAME.test(path);
}

/** The SRI shape a `<script integrity>` attribute takes. */
export const INTEGRITY_PATTERN = /^sha384-[A-Za-z0-9+/]{64}$/;

export function integrityIsWellFormed(value: string | null | undefined): boolean {
  return typeof value === 'string' && INTEGRITY_PATTERN.test(value);
}

export interface ManifestProblem {
  asset: string;
  code: string;
  message: string;
}

/**
 * Everything wrong with a manifest, as a list.
 *
 * Empty means the build is internally sound. It does **not** mean the build is
 * correct — nothing here opens a browser — but every problem it does catch is
 * one that would otherwise reach a member as a 404 they cannot describe.
 */
export function manifestProblems(manifest: AssetManifest | null | undefined): ManifestProblem[] {
  const out: ManifestProblem[] = [];
  const add = (asset: string, code: string, message: string) =>
    out.push({ asset, code, message });

  if (!manifest || typeof manifest !== 'object' || !manifest.assets) {
    add('manifest', 'malformed', 'That is not an asset manifest.');
    return out;
  }

  const entries = Object.entries(manifest.assets);
  if (!entries.length) {
    add('manifest', 'empty', 'A build that produced no assets is not a build.');
    return out;
  }

  const seenPaths = new Map<string, string>();

  for (const [logical, entry] of entries) {
    if (!entry || typeof entry.path !== 'string' || !entry.path) {
      add(logical, 'no-path', 'No served path.');
      continue;
    }
    if (!entry.path.startsWith('/')) {
      add(logical, 'relative-path', `"${entry.path}" is relative. nginx serves absolute paths.`);
    }
    if (!isHashed(entry.path)) {
      add(logical, 'not-hashed',
        `"${entry.path}" has no content hash, so it cannot be cached without stranding somebody on the next deploy.`);
    }
    if (!integrityIsWellFormed(entry.integrity)) {
      add(logical, 'bad-integrity', 'The integrity value is not sha384 base64.');
    }
    /* A zero-byte asset passes every naive check and breaks every page that
     * loads it. An empty stylesheet in particular looks like a design problem
     * rather than a build one, and somebody will spend a day on it. */
    if (!Number.isFinite(entry.bytes) || entry.bytes <= 0) {
      add(logical, 'empty-asset', 'Zero bytes. That is a failed build step, not an asset.');
    }
    /* Two logical names resolving to one file means one of them was never
     * built and is silently borrowing the other's output. */
    const already = seenPaths.get(entry.path);
    if (already) {
      add(logical, 'duplicate-path', `Resolves to the same file as "${already}".`);
    }
    seenPaths.set(entry.path, logical);
  }

  return out;
}

/**
 * Assets a built page still reaches for that the manifest does not have.
 *
 * `referenced` is every `src`/`href` in the built HTML. Anything under
 * `/assets/` that is not in the manifest is a 404 waiting for a member — and on
 * a hashed deployment it is a permanent one.
 */
export function danglingReferences(
  manifest: AssetManifest,
  referenced: string[],
): string[] {
  const served = new Set(Object.values(manifest.assets).map((a) => a.path));
  return referenced
    .filter((r) => r.startsWith('/assets/'))
    /* Images are copied wholesale rather than hashed — they are not in the
     * manifest and are not expected to be. */
    .filter((r) => !r.startsWith('/assets/img/'))
    .filter((r) => !served.has(r));
}

/**
 * Assets that were built and nothing references.
 *
 * Not a failure — a page might be added next week — but worth reporting. Dead
 * weight in a deploy is bytes on a C4 server and a thing somebody has to reason
 * about later.
 */
export function orphanedAssets(
  manifest: AssetManifest,
  referenced: string[],
): string[] {
  const used = new Set(referenced);
  return Object.values(manifest.assets).map((a) => a.path).filter((p) => !used.has(p));
}

/**
 * Has this page stopped shipping the Tailwind JIT compiler?
 *
 * The single largest saving in the build, and the easiest to lose: a page added
 * after the bundler was written would carry the CDN script again and nobody
 * would notice, because it works.
 */
export function stillUsesCdnTailwind(html: string): boolean {
  return /cdn\.tailwindcss\.com/.test(html);
}

/**
 * The palette, read out of either config shape.
 *
 * The pages carry an inline `tailwind.config` for the CDN build and the CLI
 * reads `tailwind.config.js`. This pulls the LRMC colours out of whichever it
 * is given, so the two can be compared.
 */
export function paletteOf(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  /* `name: '#RRGGBB'` and `100:'#RRGGBB'`, which covers both the nested scales
   * and the flat `lrmc` block. Deliberately not a JS parser: this reads two
   * files whose shape is known and a parser would be a great deal of machinery
   * for one comparison. */
  for (const match of source.matchAll(/(\w+)\s*:\s*'(#[0-9A-Fa-f]{6})'/g)) {
    const key = match[1]!;
    const value = match[2]!.toUpperCase();
    /* Last wins, and both files list them in the same order, so a disagreement
     * shows up rather than being masked by ordering. */
    out[`${key}:${value}`] = value;
  }
  return out;
}

/** Colours in one palette and not the other, in both directions. */
export function paletteDrift(a: string, b: string): string[] {
  const left = paletteOf(a);
  const right = paletteOf(b);
  const drift: string[] = [];
  for (const key of Object.keys(left)) if (!(key in right)) drift.push(`only in the pages: ${key}`);
  for (const key of Object.keys(right)) if (!(key in left)) drift.push(`only in the CLI config: ${key}`);
  return drift;
}
