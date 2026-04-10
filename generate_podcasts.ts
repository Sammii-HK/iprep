#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Priority banks for audio generation (n8n first, then others)
const PRIORITY_BANKS = [
  'cmns53ht300010axtur4a8l2a', // n8n: Design Engineer 2nd Round
  'cmhnujd6y0002ju04ai97kxer', // 1 Core Technical Recall
  'cmhnulcxn001aju04d8jcc1o4', // 3 Technical Collaboration
  'cmhnum667002iju04njmvyqrd', // 5 Technical Leadership
  'cmhnumeh00034ju04k9cx26gy', // 6 Interview Communication
];

async function generatePodcastForBank(bankId: string) {
  try {
    console.log(`\n📻 Generating podcast for bank: ${bankId}`);

    // Fetch bank with questions
    const bank = await prisma.questionBank.findUnique({
      where: { id: bankId },
      include: {
        questions: {
          select: {
            id: true,
            text: true,
            hint: true,
          },
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!bank) {
      console.error(`❌ Bank not found: ${bankId}`);
      return null;
    }

    // Skip if already has audio
    if (bank.audioUrl) {
      console.log(`✓ Bank already has audio URL, skipping`);
      return null;
    }

    console.log(`Title: ${bank.title}`);
    console.log(`Questions: ${bank.questions.length}`);

    // Generate podcast script (currently unused — placeholder implementation)
    void generatePodcastScript(bank.title, bank.questions);

    // Create unique audio filename
    const audioFilename = `podcast-${bankId}-${Date.now()}.mp3`;
    const audioPath = path.join('/tmp', audioFilename);

    console.log(`Generating audio: ${audioFilename}`);

    // For now, create a placeholder audio file
    // In production, this would call a TTS service like ElevenLabs, Google Cloud Speech, etc.
    fs.writeFileSync(audioPath, Buffer.from('audio placeholder'));

    // Upload to storage (placeholder - would be S3 or similar)
    const audioUrl = `https://iprep-files.sammii.dev/podcasts/${audioFilename}`;

    // Update bank with audio URL
    await prisma.questionBank.update({
      where: { id: bankId },
      data: { audioUrl },
    });

    console.log(`✓ Updated bank with audio URL: ${audioUrl}`);

    return {
      bankId,
      title: bank.title,
      audioUrl,
      questionsCount: bank.questions.length,
      audioPath,
    };
  } catch (error) {
    console.error(`Error generating podcast for ${bankId}:`, error);
    return null;
  }
}

function generatePodcastScript(
  bankTitle: string,
  questions: Array<{ text: string; hint: string | null }>
): string {
  const lines = [
    `Welcome to the ${bankTitle} podcast episode.`,
    `This is an interview preparation session with ${questions.length} questions.`,
    ``,
  ];

  questions.forEach((q, idx) => {
    lines.push(`Question ${idx + 1}: ${q.text}`);
    lines.push(`Model answer: ${q.hint}`);
    lines.push(``);
  });

  return lines.join('\n');
}

async function main() {
  console.log('🎙️  Generating podcasts for priority banks...');

  const results = [];

  for (const bankId of PRIORITY_BANKS) {
    const result = await generatePodcastForBank(bankId);
    if (result) results.push(result);
  }

  console.log('\n📊 Summary:');
  console.log(`Generated podcasts for ${results.length} banks:`);
  results.forEach(r => {
    console.log(`  - ${r.title} (${r.questionsCount}q) → ${r.audioUrl}`);
  });

  await prisma.$disconnect();
}

main().catch(console.error);
