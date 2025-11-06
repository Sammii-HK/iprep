'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { MicRecorder } from '@/components/MicRecorder';
import { LiveCaption } from '@/components/LiveCaption';
import { QuestionCard } from '@/components/QuestionCard';
import { Scorecard } from '@/components/Scorecard';

interface Question {
  id: string;
  text: string;
  hint?: string | null;
  tags: string[];
  difficulty: number;
}

interface SessionItem {
  id: string;
  questionId?: string;
  audioUrl: string | null;
  transcript: string | null;
  metrics: {
    words: number | null;
    wpm: number | null;
    fillerCount: number | null;
    fillerRate: number | null;
    longPauses: number | null;
  };
  scores: {
    confidence: number | null;
    intonation: number | null;
    star: number | null;
    impact: number | null;
    clarity: number | null;
  };
  tips: string[];
  questionAnswered?: boolean | null;
  answerQuality?: number | null;
  whatWasRight?: string[];
  whatWasWrong?: string[];
  betterWording?: string[];
}

export default function PracticeSessionPage() {
  const params = useParams();
  const sessionId = params.id as string;

  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scorecard, setScorecard] = useState<SessionItem | null>(null);
  const [sessionItems, setSessionItems] = useState<SessionItem[]>([]);

  const fetchSessionData = useCallback(async () => {
    try {
      // Get maxQuestions from localStorage if set during creation
      const storedMaxQuestions = localStorage.getItem(`session_${sessionId}_maxQuestions`);
      const maxQuestions = storedMaxQuestions ? parseInt(storedMaxQuestions, 10) : undefined;
      
      // Build URL with maxQuestions query param if it exists
      const url = maxQuestions && maxQuestions > 0 
        ? `/api/sessions/${sessionId}?maxQuestions=${maxQuestions}`
        : `/api/sessions/${sessionId}`;
      
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        // Limit questions on frontend if maxQuestions is set
        let questions = data.questions || [];
        if (maxQuestions && maxQuestions > 0 && questions.length > maxQuestions) {
          questions = questions.slice(0, maxQuestions);
        }
        setQuestions(questions);
        setSessionItems(data.items || []);
      }
    } catch (error) {
      console.error('Error fetching session:', error);
    }
  }, [sessionId]);

  useEffect(() => {
    if (sessionId) {
      fetchSessionData();
    }
  }, [sessionId, fetchSessionData]);

  const handleRecordingComplete = async (blob: Blob) => {
    if (questions.length === 0) return;

    setLoading(true);
    try {
      const currentQuestion = questions[currentQuestionIndex];
      // Load coaching preferences from localStorage
      const savedPreferences = localStorage.getItem('coachingPreferences');
      let preferences: unknown = null;
      if (savedPreferences) {
        try {
          preferences = JSON.parse(savedPreferences);
        } catch {
          // Ignore parse errors
        }
      }

      const formData = new FormData();
      formData.append('audio', blob, 'recording.webm');
      formData.append('sessionId', sessionId);
      formData.append('questionId', currentQuestion.id);
      if (preferences) {
        formData.append('preferences', JSON.stringify(preferences));
      }

      const response = await fetch('/api/practice', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        setScorecard({
          id: result.id,
          audioUrl: result.audioUrl,
          transcript: result.transcript,
          metrics: result.metrics,
          scores: result.scores,
          tips: result.tips,
          questionAnswered: result.questionAnswered,
          answerQuality: result.answerQuality,
          whatWasRight: result.whatWasRight,
          whatWasWrong: result.whatWasWrong,
          betterWording: result.betterWording,
        });
        fetchSessionData(); // Refresh to get new session item
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error processing recording:', error);
      alert('Failed to process recording');
    } finally {
      setLoading(false);
    }
  };

  const currentQuestion = questions[currentQuestionIndex];

  return (
    <div className="px-4 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Question */}
        <div className="lg:col-span-1">
          {currentQuestion ? (
            <QuestionCard
              question={currentQuestion}
              onNext={() => {
                if (currentQuestionIndex < questions.length - 1) {
                  setCurrentQuestionIndex(currentQuestionIndex + 1);
                  setScorecard(null);
                  // Reset question visibility when moving to next
                }
              }}
              onPrevious={() => {
                if (currentQuestionIndex > 0) {
                  setCurrentQuestionIndex(currentQuestionIndex - 1);
                  setScorecard(null);
                  // Reset question visibility when going back
                }
              }}
              hasNext={currentQuestionIndex < questions.length - 1}
              hasPrevious={currentQuestionIndex > 0}
              onRetryWithHint={() => {
                // TODO: Implement retry with hint
                alert('Retry with hint feature coming soon!');
              }}
            />
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
              <p className="text-slate-600 dark:text-slate-400">No questions available for this session.</p>
            </div>
          )}
        </div>

        {/* Center Column - Recorder */}
        <div className="lg:col-span-1 flex flex-col items-center gap-6">
          <MicRecorder
            onRecordingComplete={handleRecordingComplete}
            onStart={() => setIsRecording(true)}
            onStop={() => setIsRecording(false)}
          />
          {/* Only show LiveCaption when recording - consolidate into one box */}
          {isRecording && <LiveCaption isRecording={isRecording} />}
          {loading && (
            <div className="text-center py-4">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <p className="mt-2 text-slate-700 dark:text-slate-300">Processing...</p>
            </div>
          )}
        </div>

        {/* Right Column - Scorecard */}
        <div className="lg:col-span-1">
          {scorecard ? (
          <Scorecard
            metrics={scorecard.metrics}
            scores={scorecard.scores}
            tips={scorecard.tips}
            audioUrl={scorecard.audioUrl}
            questionAnswered={scorecard.questionAnswered}
            answerQuality={scorecard.answerQuality}
            whatWasRight={scorecard.whatWasRight}
            whatWasWrong={scorecard.whatWasWrong}
            betterWording={scorecard.betterWording}
          />
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
              <p className="text-slate-600 dark:text-slate-400 text-center">
                Record an answer to see your scorecard here.
              </p>
            </div>
          )}

          {/* Previous Attempts - Only show attempts for current question */}
          {currentQuestion && (() => {
            const currentQuestionAttempts = sessionItems.filter(
              item => item.questionId === currentQuestion.id
            );
            return currentQuestionAttempts.length > 0 ? (
              <div className="mt-6 bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
                <h3 className="font-semibold mb-3 text-slate-900 dark:text-slate-100">
                  Previous Attempts for This Question ({currentQuestionAttempts.length})
                </h3>
                <div className="space-y-2">
                  {currentQuestionAttempts.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      className="p-3 bg-slate-50 dark:bg-slate-700 rounded cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600"
                      onClick={() => setScorecard(item)}
                    >
                      <p className="text-sm text-slate-700 dark:text-slate-300">
                        {item.transcript?.substring(0, 50)}...
                      </p>
                      <div className="flex gap-2 mt-1">
                        <span className="text-xs text-slate-600 dark:text-slate-400">
                          WPM: {item.metrics.wpm}
                        </span>
                        <span className="text-xs text-slate-600 dark:text-slate-400">
                          Confidence: {item.scores.confidence}/5
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null;
          })()}
        </div>
      </div>
    </div>
  );
}
