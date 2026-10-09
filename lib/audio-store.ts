/**
 * The boundary for deleting audio objects from R2. Everything that removes stored audio goes through an
 * `AudioObjectStore`, so the logic (which keys are allowed, how partial failure is reported) is tested against a fake
 * and the real bucket is only ever touched by an explicit operator command.
 */
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

export interface AudioObjectStore {
  /** Delete one object. Deleting a key that is already gone must succeed (R2 and S3 both behave this way). */
  deleteObject(key: string): Promise<void>;
}

export interface AudioDeletionReport {
  requested: number;
  deleted: string[];
  failed: Array<{ key: string; error: string }>;
  refused: string[];
  /** True only when every requested key was deleted. Never claim completeness otherwise. */
  complete: boolean;
}

/** Shared episode files that are not owned by any one learner and must never be deleted by an account purge. */
const SHARED_KEYS = new Set(['audio/study/manifest.json']);

/** A key is deletable only if it is inside the audio/ prefix, is not a shared file, and has no path tricks. */
export function isDeletableAudioKey(key: string): boolean {
  return (
    typeof key === 'string' &&
    key.startsWith('audio/') &&
    key.length > 'audio/'.length &&
    key.length < 512 &&
    !key.includes('..') &&
    !key.includes('//') &&
    !key.endsWith('/') &&
    !SHARED_KEYS.has(key)
  );
}

export async function deleteAudioObjects(store: AudioObjectStore, keys: string[]): Promise<AudioDeletionReport> {
  const unique = [...new Set(keys)];
  const refused = unique.filter((k) => !isDeletableAudioKey(k));
  const allowed = unique.filter(isDeletableAudioKey);
  const deleted: string[] = [];
  const failed: Array<{ key: string; error: string }> = [];
  for (const key of allowed) {
    try {
      await store.deleteObject(key);
      deleted.push(key);
    } catch (error) {
      failed.push({ key, error: error instanceof Error ? error.name : 'unknown error' });
    }
  }
  return { requested: unique.length, deleted, failed, refused, complete: failed.length === 0 && refused.length === 0 };
}

/** The real adapter. Constructed only from an explicit credentials object, never from ambient environment. */
export function createR2AudioStore(creds: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string }): AudioObjectStore {
  const s3 = new S3Client({
    region: 'auto',
    endpoint: creds.endpoint,
    credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
    forcePathStyle: true,
  });
  return {
    async deleteObject(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: creds.bucket, Key: key }));
    },
  };
}
