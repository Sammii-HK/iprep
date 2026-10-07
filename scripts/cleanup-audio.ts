/**
 * Audio lifecycle management script
 *
 * Deletes R2 audio files older than a configurable retention period.
 * Keeps transcripts and scores permanently — only audio blobs are removed.
 *
 * This script deletes external objects, so it has the strongest guard in the repo:
 *   - no env file is ever loaded implicitly (use --env-file <path>);
 *   - an explicit --target local|preview|production is required;
 *   - the database and the R2 bucket must both match that target;
 *   - default is a DRY RUN. Deleting needs --execute AND --expect-delete <N>, where N is
 *     the count the dry run reported, so a changed dataset cannot surprise you;
 *   - production additionally needs --confirm <production database endpoint id>;
 *   - --delete-orphans is DISABLED (see the guard below): the orphan report is a hint only and nothing orphaned is deleted.
 *
 * Usage:
 *   npx tsx scripts/cleanup-audio.ts --target preview --env-file <file>                       # dry run
 *   npx tsx scripts/cleanup-audio.ts --target preview --env-file <file> --execute --expect-delete 12
 *   npx tsx scripts/cleanup-audio.ts --target production --env-file <file> --confirm <endpoint> --days 60
 *
 * Variables (from the environment or --env-file):
 *   DATABASE_URL, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 */

import { PrismaClient } from "@prisma/client";
import {
  S3Client,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

import { loadExplicitEnvFile, printTarget, resolveScriptTarget, TargetError } from "./lib/target";

const args = process.argv.slice(2);

// DISABLED: the orphan-deleting mode is unsafe and must not run, not even as a dry run of the deletion.
// It decides an object is an orphan when no SessionItem.audioUrl equals the endpoint-form URL of its key. That is
// wrong in three ways: it ignores QuizAttempt.audioUrl and AttemptEvidence.audioRef (legitimate audio would be
// deleted), it compares a URL string so audio stored through a public-domain URL always looks orphaned, and it knows
// nothing about the study episode files keyed by bank id. Ownership of historical R2 objects is an open gate
// (docs/P2_GATES_AND_DEBT.md). Nothing is contacted before this check, so refusing here cannot touch R2 or the database.
if (args.includes("--delete-orphans")) {
  console.error(
    "Refused: --delete-orphans is disabled because it can delete legitimate audio (quiz answers, AttemptEvidence audio, " +
      "public-URL audio and study episodes are all misclassified as orphans). See docs/P2_GATES_AND_DEBT.md, " +
      "\"R2 ownership gate\". The reporting mode (without --delete-orphans) over-reports for the same reasons: treat it as a hint only."
  );
  process.exit(4);
}

Object.assign(process.env, loadExplicitEnvFile(args));

let dryRun = true;
try {
  const resolved = resolveScriptTarget({
    argv: args,
    env: process.env,
    uses: { db: true, r2: true },
    mutating: true,
    destructive: true,
  });
  printTarget("Audio Cleanup Script", resolved);
  dryRun = resolved.dryRun;
} catch (e) {
  if (e instanceof TargetError) {
    console.error(`Refused: ${e.message}`);
    process.exit(3);
  }
  throw e;
}
const expectDeleteIdx = args.indexOf("--expect-delete");
const expectDelete = expectDeleteIdx >= 0 ? parseInt(args[expectDeleteIdx + 1], 10) : NaN;
const deleteOrphans = args.includes("--delete-orphans");
const daysIndex = args.indexOf("--days");
const retentionDays = daysIndex >= 0 ? parseInt(args[daysIndex + 1], 10) : 90;

if (isNaN(retentionDays) || retentionDays < 1) {
  console.error("Invalid --days value. Must be a positive integer.");
  process.exit(1);
}

const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

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

    if (!dryRun && expectDelete !== oldItems.length) {
      console.error(
        `Refused: --execute needs --expect-delete ${oldItems.length} (the count found now). ` +
          `Got ${Number.isNaN(expectDelete) ? "nothing" : expectDelete}. Re-run the dry run and pass its count.`
      );
      process.exit(3);
    }

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
            if (dryRun || !deleteOrphans) {
              console.log(`  [ORPHAN] ${obj.Key} (${obj.LastModified.toISOString()}) - no DB reference${dryRun || deleteOrphans ? "" : " (not deleted: pass --delete-orphans)"}`);
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
