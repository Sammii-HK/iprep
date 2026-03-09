import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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
  transcriptText?: string
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

  return { audioUrl: getAudioUrl(audioKey), transcriptUrl };
}
