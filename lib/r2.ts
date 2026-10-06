import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';

function getS3Client() {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true, // R2 requires path-style addressing
  });
}

export async function uploadAudio(
  audioBlob: Blob,
  contentType: string = 'audio/webm' // Will use blob's actual type if provided
): Promise<string> {
  // Use the blob's actual type, or the provided contentType
  const actualContentType = audioBlob.type || contentType;
  
  // Determine file extension from content type
  const getExtension = (mimeType: string): string => {
    if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
    if (mimeType.includes('aac')) return 'aac';
    if (mimeType.includes('webm')) return 'webm';
    if (mimeType.includes('wav')) return 'wav';
    if (mimeType.includes('ogg')) return 'ogg';
    return 'webm'; // Default fallback
  };
  
  const extension = getExtension(actualContentType);
  const key = `audio/${Date.now()}-${randomBytes(8).toString('hex')}.${extension}`;
  const buffer = Buffer.from(await audioBlob.arrayBuffer());

  const s3Client = getS3Client();

  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: actualContentType,
      // Private ACL (no public access)
    })
  );

  // Return the key/path - you'll construct full URL if needed
  return key;
}

export function getAudioUrl(key: string): string {
  const publicDomain = process.env.R2_PUBLIC_DOMAIN;
  if (publicDomain) {
    return `https://${publicDomain}/${key}`;
  }
  return `${process.env.R2_ENDPOINT}/${process.env.R2_BUCKET_NAME}/${key}`;
}

export async function uploadStudyAudio(
  bankId: string,
  mp3Buffer: Buffer,
  transcriptText?: string,
  meta?: object
): Promise<{ audioUrl: string; transcriptUrl?: string }> {
  const s3Client = getS3Client();
  const audioKey = `audio/study/${bankId}.mp3`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: audioKey,
      Body: mp3Buffer,
      ContentType: 'audio/mpeg',
    })
  );

  let transcriptUrl: string | undefined;
  if (transcriptText) {
    const transcriptKey = `audio/study/${bankId}.txt`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: transcriptKey,
        Body: Buffer.from(transcriptText),
        ContentType: 'text/plain',
      })
    );
    transcriptUrl = getAudioUrl(transcriptKey);
  }

  if (meta) {
    // Sidecar used by scripts/generate-bank-episodes.ts to detect stale episodes.
    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: `audio/study/${bankId}.json`,
        Body: Buffer.from(JSON.stringify(meta)),
        ContentType: 'application/json',
      })
    );
  }

  return { audioUrl: getAudioUrl(audioKey), transcriptUrl };
}

/** Whether a study episode exists for the bank, and its generation metadata if we made it. */
export async function getStudyAudioState<T = unknown>(
  bankId: string
): Promise<{ hasAudio: boolean; meta: T | null }> {
  const s3Client = getS3Client();
  const Bucket = process.env.R2_BUCKET_NAME!;
  try {
    await s3Client.send(
      new HeadObjectCommand({ Bucket, Key: `audio/study/${bankId}.mp3` })
    );
  } catch {
    return { hasAudio: false, meta: null };
  }
  try {
    const res = await s3Client.send(
      new GetObjectCommand({ Bucket, Key: `audio/study/${bankId}.json` })
    );
    const body = await res.Body?.transformToString();
    return { hasAudio: true, meta: body ? (JSON.parse(body) as T) : null };
  } catch {
    return { hasAudio: true, meta: null };
  }
}

/** Publishes the podcast manifest the iOS app reads (audio/study/manifest.json). */
export async function uploadStudyManifest(json: string): Promise<{ manifestUrl: string }> {
  const s3Client = getS3Client();
  const key = 'audio/study/manifest.json';
  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: Buffer.from(json),
      ContentType: 'application/json',
      CacheControl: 'public, max-age=300',
    })
  );
  return { manifestUrl: getAudioUrl(key) };
}
