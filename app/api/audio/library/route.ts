import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getAudioUrl } from '@/lib/r2';
import { existsSync, statSync } from 'fs';
import { join } from 'path';

/** Slugify a bank title to match local audio filenames */
function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);

    // Fetch all banks and folders with their structure
    const [banks, folders] = await Promise.all([
      prisma.questionBank.findMany({
        where: { userId: user.id },
        include: {
          _count: { select: { questions: true } },
          folderItems: { select: { folderId: true } },
        },
        orderBy: { order: 'asc' },
      }),
      prisma.bankFolder.findMany({
        where: { userId: user.id },
        include: {
          items: {
            include: {
              bank: {
                include: {
                  _count: { select: { questions: true } },
                },
              },
            },
            orderBy: { order: 'asc' },
          },
        },
        orderBy: { order: 'asc' },
      }),
    ]);

    // Check which banks have audio on R2
    const banksInFolders = new Set(
      folders.flatMap((f) => f.items.map((item) => item.bankId))
    );

    const localDir = join(process.cwd(), 'public', 'audio', 'study');

    // Helper to check if audio exists (local first, then R2)
    const checkAudio = async (bankId: string, bankTitle: string) => {
      // 1. Check local files by title slug
      const slug = slugify(bankTitle);
      const localPath = join(localDir, `${slug}.mp3`);

      if (existsSync(localPath)) {
        const stats = statSync(localPath);
        return {
          hasAudio: true,
          url: `/audio/study/${slug}.mp3`,
          transcriptUrl: null,
          fileSizeBytes: stats.size,
          generatedAt: stats.mtime.toISOString(),
        };
      }

      // 2. Check local files by bank ID
      const localPathById = join(localDir, `${bankId}.mp3`);
      if (existsSync(localPathById)) {
        const stats = statSync(localPathById);
        return {
          hasAudio: true,
          url: `/audio/study/${bankId}.mp3`,
          transcriptUrl: null,
          fileSizeBytes: stats.size,
          generatedAt: stats.mtime.toISOString(),
        };
      }

      // 3. Fall back to R2
      const audioUrl = getAudioUrl(`audio/study/${bankId}.mp3`);
      try {
        const head = await fetch(audioUrl, { method: 'HEAD' });
        if (!head.ok) return null;

        const transcriptUrl = getAudioUrl(`audio/study/${bankId}.txt`);
        const transcriptHead = await fetch(transcriptUrl, { method: 'HEAD' });

        return {
          hasAudio: true,
          url: audioUrl,
          transcriptUrl: transcriptHead.ok ? transcriptUrl : null,
          fileSizeBytes: Number(head.headers.get('content-length') || 0),
          generatedAt: head.headers.get('last-modified'),
        };
      } catch {
        return null;
      }
    };

    // Check audio for all banks in parallel
    const audioMetadata = await Promise.all(
      banks.map((bank) => checkAudio(bank.id, bank.title))
    );

    const audioMap = new Map(
      banks.map((bank, idx) => [bank.id, audioMetadata[idx]])
    );

    const items: Array<
      | {
          type: 'bank';
          id: string;
          title: string;
          order: number;
          questionCount: number;
          createdAt: string;
          audio: ReturnType<typeof audioMap.get> | null;
        }
      | {
          type: 'folder';
          id: string;
          title: string;
          color: string | null;
          order: number;
          banks: Array<{
            id: string;
            title: string;
            questionCount: number;
            order: number;
            audio: ReturnType<typeof audioMap.get> | null;
          }>;
        }
    > = [];

    // Add top-level banks
    for (const bank of banks) {
      if (!banksInFolders.has(bank.id)) {
        items.push({
          type: 'bank',
          id: bank.id,
          title: bank.title,
          order: bank.order,
          questionCount: bank._count.questions,
          createdAt: bank.createdAt.toISOString(),
          audio: audioMap.get(bank.id) || null,
        });
      }
    }

    // Add folders with nested banks
    for (const folder of folders) {
      items.push({
        type: 'folder',
        id: folder.id,
        title: folder.title,
        color: folder.color,
        order: folder.order,
        banks: folder.items.map((item) => ({
          id: item.bank.id,
          title: item.bank.title,
          questionCount: item.bank._count.questions,
          order: item.order,
          audio: audioMap.get(item.bank.id) || null,
        })),
      });
    }

    return NextResponse.json({ items });
  } catch (error) {
    console.error('Audio library error:', error);
    return NextResponse.json({ error: 'Failed to load audio library' }, { status: 500 });
  }
}
