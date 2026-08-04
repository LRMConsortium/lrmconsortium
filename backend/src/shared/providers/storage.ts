/**
 * Document storage, behind an interface.
 *
 * Evidence files are the one class of data on this platform that must not live
 * in Mongo: they are large, they are immutable once verified, and a subset of
 * them (ID scans, criminal record checks) are the most sensitive bytes the
 * consortium holds. They belong in object storage with short-lived signed URLs,
 * and the handlers should never know whether that is S3, Backblaze or a Ghana-
 * hosted MinIO cluster.
 *
 * The shipped implementation is a **stub**: it validates, records metadata in
 * memory, and returns signed URLs that expire. Two rules it exists to establish:
 *
 * 1. **A stored object is addressed by key, never by URL.** The document record
 *    holds a key; a URL is minted on demand and expires. A permanent link to a
 *    passport scan sitting in a database row is a breach waiting for a backup
 *    to leak.
 * 2. **Verified evidence is immutable.** `putObject` refuses to overwrite a key
 *    marked immutable. A new version is a new key.
 */

export const STORAGE_CLASSES = ['standard', 'restricted'] as const;
export type StorageClass = (typeof STORAGE_CLASSES)[number];

export const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
] as const;

/** 25 MB. A phone photograph of a certificate is ~3 MB; anything larger is a scan gone wrong. */
export const MAX_OBJECT_BYTES = 25 * 1024 * 1024;

/** Signed URLs live for fifteen minutes. Long enough to download, short enough to leak harmlessly. */
export const SIGNED_URL_TTL_SECONDS = 900;

export interface StoredObject {
  key: string;
  mimeType: string;
  size: number;
  storageClass: StorageClass;
  checksum?: string;
  immutable: boolean;
  uploadedAt: Date;
}

export interface PutRequest {
  key: string;
  mimeType: string;
  size: number;
  storageClass?: StorageClass;
  checksum?: string;
  /** Set once a document is verified; further writes to the key are refused. */
  immutable?: boolean;
}

export interface StorageResult {
  ok: boolean;
  provider: string;
  object?: StoredObject;
  error?: 'invalidObject' | 'tooLarge' | 'unsupportedType' | 'immutable' | 'notFound';
  detail?: string;
}

export interface SignedUrl {
  url: string;
  expiresAt: Date;
  provider: string;
}

export interface StorageProvider {
  readonly name: string;
  putObject(request: PutRequest): Promise<StorageResult>;
  getSignedUrl(key: string, ttlSeconds?: number): Promise<SignedUrl | null>;
  deleteObject(key: string): Promise<StorageResult>;
  head(key: string): Promise<StoredObject | null>;
  /** Freeze a key once its document is verified. */
  markImmutable(key: string): Promise<StorageResult>;
}

/** Rules every provider shares, checked before any vendor call. */
export function validatePut(request: PutRequest): string | null {
  if (!request.key?.trim()) return 'key is required';
  // Dots are required — every key this module mints carries a file extension.
  // No leading dot and no `..`, so a key can never climb out of its prefix.
  if (!/^[a-z0-9][a-z0-9._/-]{3,255}$/i.test(request.key) || request.key.includes('..')) {
    return 'key is malformed';
  }
  if (!Number.isFinite(request.size) || request.size <= 0) return 'size must be positive';
  if (request.size > MAX_OBJECT_BYTES) return `object exceeds ${MAX_OBJECT_BYTES} bytes`;
  if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(request.mimeType)) {
    return `unsupported type ${request.mimeType}`;
  }
  return null;
}

/**
 * The canonical key for a document's evidence.
 *
 * Namespaced by document id and version so a re-upload after `needsMoreInfo` is
 * a new object rather than an overwrite — the reviewer who asked for a better
 * scan can still see what they originally rejected.
 */
export function objectKeyFor(documentId: string, version: number, extension: string): string {
  const safe = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  return `documents/${documentId}/v${Math.max(1, Math.trunc(version))}.${safe}`;
}

export class StubStorageProvider implements StorageProvider {
  readonly name = 'stub';
  private readonly objects = new Map<string, StoredObject>();

  async putObject(request: PutRequest): Promise<StorageResult> {
    const invalid = validatePut(request);
    if (invalid) {
      const error =
        request.size > MAX_OBJECT_BYTES
          ? 'tooLarge'
          : !(ACCEPTED_MIME_TYPES as readonly string[]).includes(request.mimeType)
            ? 'unsupportedType'
            : 'invalidObject';
      return { ok: false, provider: this.name, error, detail: invalid };
    }

    const existing = this.objects.get(request.key);
    if (existing?.immutable) {
      return {
        ok: false,
        provider: this.name,
        error: 'immutable',
        detail: 'this key is frozen; a new version needs a new key',
      };
    }

    const object: StoredObject = {
      key: request.key,
      mimeType: request.mimeType,
      size: request.size,
      storageClass: request.storageClass ?? 'standard',
      checksum: request.checksum,
      immutable: request.immutable ?? false,
      uploadedAt: new Date(),
    };
    this.objects.set(request.key, object);
    return { ok: true, provider: this.name, object };
  }

  async getSignedUrl(key: string, ttlSeconds = SIGNED_URL_TTL_SECONDS): Promise<SignedUrl | null> {
    if (!this.objects.has(key)) return null;
    const ttl = Math.max(60, Math.min(ttlSeconds, 3600));
    return {
      url: `stub://documents/${encodeURIComponent(key)}?ttl=${ttl}`,
      expiresAt: new Date(Date.now() + ttl * 1000),
      provider: this.name,
    };
  }

  async deleteObject(key: string): Promise<StorageResult> {
    const existing = this.objects.get(key);
    if (!existing) return { ok: false, provider: this.name, error: 'notFound' };
    if (existing.immutable) {
      return { ok: false, provider: this.name, error: 'immutable', detail: 'verified evidence cannot be deleted' };
    }
    this.objects.delete(key);
    return { ok: true, provider: this.name };
  }

  async head(key: string): Promise<StoredObject | null> {
    return this.objects.get(key) ?? null;
  }

  async markImmutable(key: string): Promise<StorageResult> {
    const existing = this.objects.get(key);
    if (!existing) return { ok: false, provider: this.name, error: 'notFound' };
    const frozen = { ...existing, immutable: true };
    this.objects.set(key, frozen);
    return { ok: true, provider: this.name, object: frozen };
  }

  reset(): void {
    this.objects.clear();
  }
}

let provider: StorageProvider = new StubStorageProvider();

export function registerStorageProvider(next: StorageProvider): void {
  provider = next;
}

export function storageProvider(): StorageProvider {
  return provider;
}
