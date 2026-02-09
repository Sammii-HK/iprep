/**
 * Audio lifecycle management script
 *
 * Deletes R2 audio files older than a configurable retention period.
 * Keeps transcripts and scores permanently — only audio blobs are removed.
 *
 * Usage:
 *   npx tsx scripts/cleanup-audio.ts                  # dry run (default 90 days)
 *   npx tsx scripts/cleanup-audio.ts --execute        # actually delete
 *   npx tsx scripts/cleanup-audio.ts --days 60        # custom retention
 *   npx tsx scripts/cleanup-audio.ts --days 60 --execute
 *
 * Requires environment variables:
 *   DATABASE_URL, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 */

import { PrismaClient } from "@prisma/client";
import {
  S3Client,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const args = process.argv.slice(2);
const dryRun = !args.includes("--execute");
const daysIndex = args.indexOf("--days");
const retentionDays = daysIndex >= 0 ? parseInt(args[daysIndex + 1], 10) : 90;

if (isNaN(retentionDays) || retentionDays < 1) {
  console.error("Invalid --days value. Must be a positive integer.");
  process.exit(1);
}

const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

console.log(`Audio Cleanup Script`);
console.log(`  Mode: ${dryRun ? "DRY RUN (no deletions)" : "EXECUTE (will delete!)"}`);
console.log(`  Retention: ${retentionDays} days`);
console.log(`  Cutoff date: ${cutoffDate.toISOString()}`);
console.log("");

async function main() {
  const prisma = new PrismaClient();
  const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
  });

  const bucketName = process.env.R2_BUCKET_NAME!;

  try {
    // Find session items with audio URLs older than cutoff
    const oldItems = await prisma.sessionItem.findMany({
      where: {
        createdAt: { lt: cutoffDate },
        audioUrl: { not: null },
      },
      select: {
        id: true,
        audioUrl: true,
        createdAt: true,
      },
    });

    console.log(`Found ${oldItems.length} session items with audio older than ${retentionDays} days.`);

    let deleted = 0;
    let failed = 0;
    let skipped = 0;

    for (const item of oldItems) {
      if (!item.audioUrl) {
        skipped++;
        continue;
      }

      // Extract the R2 key from the audio URL
      // URL format: {endpoint}/{bucket}/{key}
      const key = extractR2Key(item.audioUrl, bucketName);
      if (!key) {
        console.warn(`  Could not extract key from URL: ${item.audioUrl}`);
        skipped++;
        continue;
      }

      if (dryRun) {
        console.log(`  [DRY RUN] Would delete: ${key} (created: ${item.createdAt.toISOString()})`);
        deleted++;
      } else {
        try {
          await s3.send(
            new DeleteObjectCommand({
              Bucket: bucketName,
              Key: key,
            })
          );

          // Clear the audioUrl in the database (keep transcript and scores)
          await prisma.sessionItem.update({
            where: { id: item.id },
            data: { audioUrl: null },
          });

          deleted++;
          if (deleted % 100 === 0) {
            console.log(`  Deleted ${deleted} audio files so far...`);
          }
        } catch (error) {
          console.error(`  Failed to delete ${key}:`, error);
          failed++;
        }
      }
    }

    console.log("");
    console.log("Summary:");
    console.log(`  Total eligible: ${oldItems.length}`);
    console.log(`  ${dryRun ? "Would delete" : "Deleted"}: ${deleted}`);
    console.log(`  Skipped: ${skipped}`);
    if (failed > 0) console.log(`  Failed: ${failed}`);

    // Also check for orphaned R2 objects (optional, slower)
    if (args.includes("--check-orphans")) {
      console.log("\nChecking for orphaned R2 objects...");
      let orphanCount = 0;
      let continuationToken: string | undefined;

      do {
        const listResult = await s3.send(
          new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: "audio/",
            MaxKeys: 1000,
            ContinuationToken: continuationToken,
          })
        );

        for (const obj of listResult.Contents || []) {
          if (!obj.Key || !obj.LastModified) continue;
          if (obj.LastModified >= cutoffDate) continue;

          // Check if any session item references this key
          const fullUrl = `${process.env.R2_ENDPOINT}/${bucketName}/${obj.Key}`;
          const refCount = await prisma.sessionItem.count({
            where: { audioUrl: fullUrl },
          });

          if (refCount === 0) {
            orphanCount++;
            if (dryRun) {
              console.log(`  [ORPHAN] ${obj.Key} (${obj.LastModified.toISOString()}) - no DB reference`);
            } else {
              await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: obj.Key }));
              console.log(`  Deleted orphan: ${obj.Key}`);
            }
          }
        }

        continuationToken = listResult.NextContinuationToken;
      } while (continuationToken);

      console.log(`  Orphaned objects found: ${orphanCount}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

function extractR2Key(audioUrl: string, bucketName: string): string | null {
  try {
    const url = new URL(audioUrl);
    const path = url.pathname;
    // Path is /{bucket}/{key} or just /{key}
    if (path.startsWith(`/${bucketName}/`)) {
      return path.substring(`/${bucketName}/`.length);
    }
    // Try removing leading slash
    return path.startsWith("/") ? path.substring(1) : path;
  } catch {
    // Not a valid URL, try treating the whole string as a key
    const prefix = `/${bucketName}/`;
    const idx = audioUrl.indexOf(prefix);
    if (idx >= 0) {
      return audioUrl.substring(idx + prefix.length);
    }
    return null;
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
