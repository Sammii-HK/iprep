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
  detectLongPausesFromTranscript,
} from '@/lib/scoring';
import {
  analyzeConfidenceFromTranscript,
  analyzeIntonationFromTranscript,
} from '@/lib/audio-analysis';
import { handleApiError, RateLimitError, ValidationError, NotFoundError, ExternalServiceError } from '@/lib/errors';
import { validateAudioFile, validateId } from '@/lib/validation';
import { getConfig } from '@/lib/config';
import { CoachingPreferences } from '@/lib/coaching-config';

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
    
    // Get coaching preferences from request (optional)
    const preferencesJson = formData.get('preferences') as string | null;
    let preferences: Partial<CoachingPreferences> | undefined;
    if (preferencesJson) {
      try {
        preferences = JSON.parse(preferencesJson);
      } catch {
        // Ignore invalid JSON
      }
    }

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

    // Optimize: Start transcription first (critical), then start upload in parallel
    // We'll wait for upload only when we need to save
    let transcript: string;
    let wordTimestamps: Array<{ word: string; start: number; end: number }> | undefined;
    const audioKey: string | null = null;
    let audioUrl: string | null = null;
    
    // Start transcription (critical path - must complete)
    try {
      console.log('Starting audio transcription...', {
        audioSize: audioBlob.size,
        audioType: audioFile.type,
      });
      
      const transcriptionResult = await Promise.race([
        transcribeAudio(audioBlob, {
          questionText: question.text,
          questionTags: question.tags,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Transcription timeout after 60s')), 60000)
        ),
      ]);
      transcript = transcriptionResult.transcript;
      wordTimestamps = transcriptionResult.words;
      
      console.log('Transcription completed', {
        transcriptLength: transcript.length,
        wordCount: countWords(transcript),
        hasWordTimestamps: !!wordTimestamps && wordTimestamps.length > 0,
      });
    } catch (error) {
      console.error('Transcription failed:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        audioSize: audioBlob.size,
      });
      throw new ExternalServiceError('OpenAI Whisper', `Failed to transcribe audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Start audio upload in background (non-blocking)
    // We'll await it only when we need to save the audioUrl
    const uploadPromise = Promise.race([
      uploadAudio(audioBlob, audioFile.type),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Upload timeout')), 30000))
    ]).then((key) => {
      audioUrl = getAudioUrl(key);
    }).catch((error) => {
      // Log but don't fail - transcription and analysis are more important
      console.error('Failed to upload audio to R2 (non-critical):', error);
      audioUrl = null;
    });

    // Validate transcript is not empty
    if (!transcript || transcript.trim().length === 0) {
      throw new ValidationError('Transcript is empty. Please ensure audio contains speech.');
    }

    // Calculate delivery metrics
    const wordCount = countWords(transcript);
    const fillerCount = countFillers(transcript);
    const fillerRate = calculateFillerRate(fillerCount, wordCount);
    
    // Estimate duration from timestamps or use default
    const duration =
      wordTimestamps && wordTimestamps.length > 0
        ? wordTimestamps[wordTimestamps.length - 1].end
        : Math.max(30, wordCount / 2); // Rough estimate: 2 words per second
    
    // Detect long pauses - use timestamps if available, otherwise estimate from transcript
    const longPauses = wordTimestamps && wordTimestamps.length > 0
      ? detectLongPauses(wordTimestamps)
      : detectLongPausesFromTranscript(transcript, duration);

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
      
      // Load coaching preferences from request (could be from user session in future)
      // For now, use defaults or get from localStorage on client side
      // In a real app, you'd get this from the user's session/database
      
      console.log('Starting AI analysis...', {
        transcriptLength: transcript.length,
        wordCount: countWords(transcript),
        questionTags,
        hasQuestionText: !!question.text,
        hasQuestionHint: !!question.hint,
      });
      
      analysis = await Promise.race([
        analyzeTranscriptEnhanced(
          transcript,
          questionTags,
          undefined, // role - will use from preferences
          undefined, // priorities - will use from preferences
          question.text,
          question.hint,
          preferences
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Analysis timeout after 30s')), 30000)
        ),
      ]);
      
      console.log('AI analysis completed successfully', {
        questionAnswered: analysis.questionAnswered,
        answerQuality: analysis.answerQuality,
        tipsCount: analysis.tips.length,
      });
    } catch (error) {
      console.error('Error in AI analysis:', error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        transcriptLength: transcript.length,
        transcriptPreview: transcript.substring(0, 200),
      });
      
      // Don't throw - return fallback analysis instead
      const wordCount = countWords(transcript);
      analysis = {
        questionAnswered: wordCount > 20,
        answerQuality: 2,
        whatWasRight: [
          'Your response was recorded successfully',
          'You provided some content',
        ],
        whatWasWrong: [
          `AI analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}. Please check server logs.`,
          'Unable to verify if question was fully answered',
        ],
        betterWording: [
          'Try speaking for 2-3 minutes with clear structure',
          'Use the STAR method: Situation, Task, Action, Result',
          'Include specific metrics and examples',
        ],
        starScore: 2,
        impactScore: 2,
        clarityScore: 2,
        technicalAccuracy: 2,
        terminologyUsage: 2,
        tips: [
          `AI analysis error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'Your response was recorded successfully',
          'Review your transcript and practice speaking more clearly',
          'Use the STAR method: Situation, Task, Action, Result',
          'Include specific metrics and outcomes when possible',
        ],
      };
    }

    // Wait for audio upload to complete (or fail) before saving
    await uploadPromise;
    
    // Save SessionItem
    const sessionItem = await prisma.sessionItem.create({
      data: {
        sessionId,
        questionId,
        audioUrl: audioUrl || null,
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
        technicalAccuracy: analysis.technicalAccuracy,
        terminologyUsage: analysis.terminologyUsage,
        questionAnswered: analysis.questionAnswered,
        answerQuality: analysis.answerQuality,
        whatWasRight: analysis.whatWasRight,
        whatWasWrong: analysis.whatWasWrong,
        betterWording: analysis.betterWording,
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
        // Enhanced scores from technical analysis
        technicalAccuracy: analysis.technicalAccuracy,
        terminologyUsage: analysis.terminologyUsage,
      },
      tips: analysis.tips,
      questionAnswered: analysis.questionAnswered,
      answerQuality: analysis.answerQuality,
      whatWasRight: analysis.whatWasRight,
      whatWasWrong: analysis.whatWasWrong,
      betterWording: analysis.betterWording,
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
