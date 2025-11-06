import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { uploadAudio, getAudioUrl } from '@/lib/r2';
import { transcribeAudio, analyzeTranscriptEnhanced } from '@/lib/ai';
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
import { handleApiError, RateLimitError, ValidationError, NotFoundError, ExternalServiceError } from '@/lib/errors';
import { validateAudioFile, validateId } from '@/lib/validation';
import { getConfig } from '@/lib/config';

// Simple in-memory rate limiting (upgrade to Redis in v2)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, {
      count: 1,
      resetTime: now + getConfig().limits.rateLimitWindowMs,
    });
    return true;
  }

  if (record.count >= getConfig().limits.rateLimitRequests) {
    return false;
  }

  record.count++;
  return true;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    if (!checkRateLimit(ip)) {
      throw new RateLimitError('Rate limit exceeded. Please try again later.');
    }

    const formData = await request.formData();
    const audioFile = formData.get('audio') as File | null;
    const sessionId = formData.get('sessionId') as string | null;
    const questionId = formData.get('questionId') as string | null;

    // Validate required fields
    if (!audioFile || !sessionId || !questionId) {
      throw new ValidationError('Missing required fields: audio, sessionId, questionId');
    }

    // Validate IDs
    if (!validateId(sessionId) || !validateId(questionId)) {
      throw new ValidationError('Invalid sessionId or questionId format');
    }

    // Validate audio file
    const audioValidation = validateAudioFile(audioFile);
    if (!audioValidation.valid) {
      throw new ValidationError(audioValidation.error || 'Invalid audio file');
    }

    // Check if session and question exist (with question text for context)
    const [session, question] = await Promise.all([
      prisma.session.findUnique({ where: { id: sessionId } }),
      prisma.question.findUnique({ 
        where: { id: questionId },
        include: { bank: true },
      }),
    ]);

    if (!session) {
      throw new NotFoundError('Session', sessionId);
    }
    if (!question) {
      throw new NotFoundError('Question', questionId);
    }

    // Convert File to Blob
    const audioBlob = new Blob([await audioFile.arrayBuffer()], {
      type: audioFile.type,
    });

    // Upload audio to R2 with timeout
    let audioKey: string;
    let audioUrl: string;
    try {
      audioKey = await Promise.race([
        uploadAudio(audioBlob, audioFile.type),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Upload timeout')), 30000)
        ),
      ]);
      audioUrl = getAudioUrl(audioKey);
    } catch (error) {
      throw new ExternalServiceError('R2', 'Failed to upload audio file');
    }

    // Transcribe with Whisper with timeout
    let transcript: string;
    let wordTimestamps: Array<{ word: string; start: number; end: number }> | undefined;
    try {
      const transcriptionResult = await Promise.race([
        transcribeAudio(audioBlob),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Transcription timeout')), 60000)
        ),
      ]);
      transcript = transcriptionResult.transcript;
      wordTimestamps = transcriptionResult.words;
    } catch (error) {
      throw new ExternalServiceError('OpenAI Whisper', 'Failed to transcribe audio');
    }

    // Validate transcript is not empty
    if (!transcript || transcript.trim().length === 0) {
      throw new ValidationError('Transcript is empty. Please ensure audio contains speech.');
    }

    // Calculate delivery metrics
    const wordCount = countWords(transcript);
    const fillerCount = countFillers(transcript);
    const fillerRate = calculateFillerRate(fillerCount, wordCount);
    const longPauses = wordTimestamps ? detectLongPauses(wordTimestamps) : 0;

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

    // Analyze content with enhanced GPT analysis (includes technical accuracy based on question tags)
    let analysis;
    try {
      // Use question tags for better technical accuracy assessment
      const questionTags = question.tags || [];
      const questionText = question.text;
      
      analysis = await Promise.race([
        analyzeTranscriptEnhanced(
          transcript,
          questionTags,
          'Senior Design Engineer / Design Engineering Leader',
          ['clarity', 'impact statements', 'technical accuracy', 'resilience', 'performance']
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Analysis timeout')), 30000)
        ),
      ]);
    } catch (error) {
      throw new ExternalServiceError('OpenAI GPT', 'Failed to analyze transcript');
    }

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
        // Note: technicalAccuracy and terminologyUsage are available in enhanced analysis
        // but not stored in SessionItem schema yet - can be added in v2
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
        // Enhanced scores from technical analysis
        technicalAccuracy: analysis.technicalAccuracy,
        terminologyUsage: analysis.terminologyUsage,
      },
      tips: analysis.tips,
    });
  } catch (error) {
    const errorResponse = handleApiError(error);
    return NextResponse.json(
      {
        error: errorResponse.message,
        code: errorResponse.code,
        ...(errorResponse.details ? { details: errorResponse.details } : {}),
      },
      { status: errorResponse.statusCode }
    );
  }
}
