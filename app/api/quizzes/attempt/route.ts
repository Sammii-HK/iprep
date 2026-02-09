import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleApiError, NotFoundError } from '@/lib/errors';
import { transcribeAudio } from '@/lib/ai';
import { analyzeTranscriptOptimized } from '@/lib/ai-optimized';
import { uploadAudio, getAudioUrl } from '@/lib/r2';
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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const quizId = formData.get('quizId') as string;
    const questionId = formData.get('questionId') as string;
    const answer = formData.get('answer') as string | null; // For written
    const audioFile = formData.get('audio') as File | null; // For spoken
    const hintUsed = formData.get('hintUsed') === 'true'; // Whether hint was shown

    if (!quizId || !questionId) {
      return NextResponse.json(
        { error: 'Missing quizId or questionId' },
        { status: 400 }
      );
    }

    // Verify quiz and question exist
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        bank: {
          include: {
            questions: true,
          },
        },
      },
    });

    if (!quiz) {
      throw new NotFoundError('Quiz', quizId);
    }

    const question = quiz.bank?.questions.find((q: { id: string }) => q.id === questionId);
    if (!question) {
      throw new NotFoundError('Question', questionId);
    }

    let answerText = answer;
    let audioUrl: string | null = null;
    let transcript: string | null = null;
    let score: number | null = null;
    let feedback: string | null = null;

    if (quiz.type === 'SPOKEN') {
      if (!audioFile) {
        return NextResponse.json(
          { error: 'Audio file required for spoken quiz' },
          { status: 400 }
        );
      }

      // Upload audio
      const audioBlob = new Blob([await audioFile.arrayBuffer()], {
        type: audioFile.type,
      });
      const audioKey = await uploadAudio(audioBlob, audioFile.type);
      audioUrl = getAudioUrl(audioKey);

      // Transcribe with context for better accuracy (skip timestamps for faster transcription)
      const { transcript: transcribedText, words: wordTimestamps } =
        await transcribeAudio(
          audioBlob,
          {
            questionText: question.text,
            questionTags: question.tags,
          },
          {
            includeWordTimestamps: false, // Skip timestamps for faster transcription
          }
        );
      transcript = transcribedText;
      answerText = transcribedText;

      // Calculate metrics
      const wordCount = countWords(transcript || '');
      const fillerCount = countFillers(transcript || '');
      const longPauses = wordTimestamps ? detectLongPauses(wordTimestamps) : 0;

      // Use optimized analysis (70% token reduction + caching)
      const questionTags = question.tags || [];
      let analysis;
      try {
        analysis = await analyzeTranscriptOptimized(
          transcript || '',
          question.id, // questionId for caching
          questionTags,
          'Senior Design Engineer / Design Engineering Leader',
          ['clarity', 'impact statements', 'technical accuracy', 'resilience', 'performance'],
          question.text,
          question.hint,
          undefined, // preferences
          {
            wordCount,
            fillerCount,
            fillerRate: calculateFillerRate(fillerCount, wordCount),
            wpm: calculateWPM(wordCount, wordTimestamps ? wordTimestamps[wordTimestamps.length - 1].end : 30),
            longPauses,
          }
        );
      } catch (error) {
        console.error('Error in AI analysis:', error);
        // Fallback analysis
        analysis = {
          questionAnswered: wordCount > 20,
          answerQuality: 2,
          whatWasRight: [
            'Your response was recorded successfully',
            'You provided some content',
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
            'AI analysis temporarily unavailable',
            'Your response was recorded successfully',
            'Review your transcript and practice speaking more clearly',
            'Use the STAR method: Situation, Task, Action, Result',
            'Include specific metrics and outcomes when possible',
          ],
        };
      }
      const confidenceScore = analyzeConfidenceFromTranscript(
        transcript,
        fillerCount,
        wordCount,
        longPauses
      );
      const intonationScore = analyzeIntonationFromTranscript(transcript, wordCount);

      // Calculate score (average of all metrics including technical accuracy)
      score =
        (analysis.starScore +
          analysis.impactScore +
          analysis.clarityScore +
          analysis.technicalAccuracy +
          analysis.terminologyUsage +
          confidenceScore +
          intonationScore) /
        7;

      feedback = JSON.stringify({
        tips: analysis.tips,
        scores: {
          star: analysis.starScore,
          impact: analysis.impactScore,
          clarity: analysis.clarityScore,
          technicalAccuracy: analysis.technicalAccuracy,
          terminologyUsage: analysis.terminologyUsage,
          confidence: confidenceScore,
          intonation: intonationScore,
        },
        questionAnswered: analysis.questionAnswered,
        answerQuality: analysis.answerQuality,
        whatWasRight: analysis.whatWasRight,
        betterWording: analysis.betterWording,
        metrics: {
          words: wordCount,
          wpm: wordTimestamps ? Math.round((wordCount / wordTimestamps[wordTimestamps.length - 1].end) * 60) : 0,
          fillerCount,
          fillerRate: calculateFillerRate(fillerCount, wordCount),
          longPauses,
        },
      });
    } else {
      // Written quiz - analyze text answer
      if (!answerText || answerText.trim().length === 0) {
        return NextResponse.json(
          { error: 'Answer required for written quiz' },
          { status: 400 }
        );
      }

          try {
            // Use optimized analysis for written answers too (70% token reduction + caching)
            const questionTags = question.tags || [];
            const wordCount = countWords(answerText);
            const analysis = await analyzeTranscriptOptimized(
              answerText,
              question.id, // questionId for caching
              questionTags,
              'Senior Design Engineer / Design Engineering Leader',
              ['clarity', 'impact statements', 'technical accuracy', 'resilience', 'performance'],
              question.text,
              question.hint,
              undefined, // preferences
              {
                wordCount,
                fillerCount: countFillers(answerText),
                fillerRate: calculateFillerRate(countFillers(answerText), wordCount),
                wpm: 0, // Not applicable for written
                longPauses: 0, // Not applicable for written
              }
            );
        score =
          (analysis.starScore +
            analysis.impactScore +
            analysis.clarityScore +
            analysis.technicalAccuracy +
            analysis.terminologyUsage) /
          5;
        feedback = JSON.stringify({
          tips: analysis.tips,
          scores: {
            star: analysis.starScore,
            impact: analysis.impactScore,
            clarity: analysis.clarityScore,
            technicalAccuracy: analysis.technicalAccuracy,
            terminologyUsage: analysis.terminologyUsage,
          },
          questionAnswered: analysis.questionAnswered,
          answerQuality: analysis.answerQuality,
          whatWasRight: analysis.whatWasRight,
          betterWording: analysis.betterWording,
          metrics: {
            words: wordCount,
            fillerCount: countFillers(answerText),
            fillerRate: calculateFillerRate(countFillers(answerText), wordCount),
          },
        });
      } catch {
        // If analysis fails, still save the attempt
        score = null;
        feedback = 'Could not analyze answer. Please try again.';
      }
    }

    // Save attempt
    const attempt = await prisma.quizAttempt.create({
      data: {
        quizId,
        questionId,
        answer: answerText,
        audioUrl,
        transcript,
        score: score ? Math.round(score * 20) : null, // Convert 0-5 to 0-100
        feedback,
        hintUsed,
        completedAt: new Date(),
      },
      include: {
        question: true,
      },
    });

    // Parse structured feedback for the response
    let parsedFeedback = null;
    if (attempt.feedback) {
      try {
        parsedFeedback = JSON.parse(attempt.feedback);
      } catch {
        // Legacy format: tips joined by ' | '
        parsedFeedback = { tips: attempt.feedback.split(' | ') };
      }
    }

    return NextResponse.json({
      id: attempt.id,
      answer: attempt.answer,
      audioUrl: attempt.audioUrl,
      transcript: attempt.transcript,
      score: attempt.score,
      feedback: attempt.feedback,
      detailedFeedback: parsedFeedback,
      completedAt: attempt.completedAt,
    });
  } catch (error) {
    const errorResponse = handleApiError(error);
    return NextResponse.json(
      {
        error: errorResponse.message,
        code: errorResponse.code,
      },
      { status: errorResponse.statusCode }
    );
  }
}
