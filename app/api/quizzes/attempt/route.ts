import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { handleApiError, NotFoundError } from '@/lib/errors';
import { transcribeAudio, analyzeTranscriptEnhanced } from '@/lib/ai';
import { uploadAudio, getAudioUrl } from '@/lib/r2';
import {
  countWords,
  countFillers,
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

      // Transcribe
      const { transcript: transcribedText, words: wordTimestamps } =
        await transcribeAudio(audioBlob);
      transcript = transcribedText;
      answerText = transcribedText;

      // Calculate metrics
      const wordCount = countWords(transcript);
      const fillerCount = countFillers(transcript);
      const longPauses = wordTimestamps ? detectLongPauses(wordTimestamps) : 0;

      // Use enhanced analysis with technical accuracy (same as practice)
      const questionTags = question.tags || [];
      const analysis = await analyzeTranscriptEnhanced(
        transcript,
        questionTags,
        'Senior Design Engineer / Design Engineering Leader',
        ['clarity', 'impact statements', 'technical accuracy', 'resilience', 'performance']
      );
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

      feedback = analysis.tips.join(' | ');
    } else {
      // Written quiz - analyze text answer
      if (!answerText || answerText.trim().length === 0) {
        return NextResponse.json(
          { error: 'Answer required for written quiz' },
          { status: 400 }
        );
      }

      try {
        // Use enhanced analysis for written answers too
        const questionTags = question.tags || [];
        const analysis = await analyzeTranscriptEnhanced(
          answerText,
          questionTags,
          'Senior Design Engineer / Design Engineering Leader',
          ['clarity', 'impact statements', 'technical accuracy', 'resilience', 'performance']
        );
        score =
          (analysis.starScore +
            analysis.impactScore +
            analysis.clarityScore +
            analysis.technicalAccuracy +
            analysis.terminologyUsage) /
          5;
        feedback = analysis.tips.join(' | ');
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
        completedAt: new Date(),
      },
      include: {
        question: true,
      },
    });

    return NextResponse.json({
      id: attempt.id,
      answer: attempt.answer,
      audioUrl: attempt.audioUrl,
      transcript: attempt.transcript,
      score: attempt.score,
      feedback: attempt.feedback,
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
