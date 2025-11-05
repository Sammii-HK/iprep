import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomBytes } from 'crypto';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function uploadAudio(
  audioBlob: Blob,
  contentType: string = 'audio/webm'
): Promise<string> {
  const key = `audio/${Date.now()}-${randomBytes(8).toString('hex')}.webm`;
  const buffer = Buffer.from(await audioBlob.arrayBuffer());

  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      // Private ACL (no public access)
    })
  );

  // Return the key/path - you'll construct full URL if needed
  return key;
}

export function getAudioUrl(key: string): string {
  // Construct public URL if needed, or use signed URL for private access
  // For v1, assuming we'll use signed URLs or direct R2 access
  return `${process.env.R2_ENDPOINT}/${process.env.R2_BUCKET_NAME}/${key}`;
}
