import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { uploadAudio, getAudioUrl } from '@/lib/r2';
import { transcribeAudio, analyzeTranscript } from '@/lib/ai';
import {
  countWords,
  countFillers,
  calculateWPM,
  calculateFillerRate,
  detectLongPauses,
} from '@/lib/scoring';
import {
  analyzeConfidenceFromTranscript,
  analyzeIntonationFromTranscript,
} from '@/lib/audio-analysis';

// Simple in-memory rate limiting (upgrade to Redis in v2)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 10; // requests per window
const RATE_LIMIT_WINDOW = 60000; // 1 minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT) {
    return false;
  }

  record.count++;
  return true;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      );
    }

    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;
    const sessionId = formData.get('sessionId') as string;
    const questionId = formData.get('questionId') as string;

    if (!audioFile || !sessionId || !questionId) {
      return NextResponse.json(
        { error: 'Missing required fields: audio, sessionId, questionId' },
        { status: 400 }
      );
    }

    // Convert File to Blob
    const audioBlob = new Blob([await audioFile.arrayBuffer()], {
      type: audioFile.type,
    });

    // Upload audio to R2
    const audioKey = await uploadAudio(audioBlob, audioFile.type);
    const audioUrl = getAudioUrl(audioKey);

    // Transcribe with Whisper
    const { transcript, words: wordTimestamps } = await transcribeAudio(audioBlob);

    // Calculate delivery metrics
    const wordCount = countWords(transcript);
    const fillerCount = countFillers(transcript);
    const fillerRate = calculateFillerRate(fillerCount, wordCount);
    const longPauses = wordTimestamps
      ? detectLongPauses(wordTimestamps)
      : 0;

    // Estimate duration from timestamps or use default
    const duration =
      wordTimestamps && wordTimestamps.length > 0
        ? wordTimestamps[wordTimestamps.length - 1].end
        : Math.max(30, wordCount / 2); // Rough estimate: 2 words per second

    const wpm = calculateWPM(wordCount, duration);

    // Analyze confidence and intonation from transcript
    const confidenceScore = analyzeConfidenceFromTranscript(
      transcript,
      fillerCount,
      wordCount,
      longPauses
    );
    const intonationScore = analyzeIntonationFromTranscript(transcript, wordCount);

    // Analyze content with GPT
    const analysis = await analyzeTranscript(transcript);

    // Save SessionItem
    const sessionItem = await prisma.sessionItem.create({
      data: {
        sessionId,
        questionId,
        audioUrl,
        transcript,
        words: wordCount,
        wpm,
        fillerCount,
        fillerRate,
        longPauses,
        confidenceScore,
        intonationScore,
        starScore: analysis.starScore,
        impactScore: analysis.impactScore,
        clarityScore: analysis.clarityScore,
        aiFeedback: analysis.tips.join(' | '),
      },
      include: {
        question: true,
      },
    });

    // Return scorecard data
    return NextResponse.json({
      id: sessionItem.id,
      audioUrl: sessionItem.audioUrl,
      transcript: sessionItem.transcript,
      metrics: {
        words: sessionItem.words,
        wpm: sessionItem.wpm,
        fillerCount: sessionItem.fillerCount,
        fillerRate: sessionItem.fillerRate,
        longPauses: sessionItem.longPauses,
      },
      scores: {
        confidence: sessionItem.confidenceScore,
        intonation: sessionItem.intonationScore,
        star: sessionItem.starScore,
        impact: sessionItem.impactScore,
        clarity: sessionItem.clarityScore,
      },
      tips: analysis.tips,
    });
  } catch (error) {
    console.error('Error processing practice:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to process practice',
      },
      { status: 500 }
    );
  }
}
