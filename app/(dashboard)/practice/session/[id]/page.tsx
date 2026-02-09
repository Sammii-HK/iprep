'use client';

import { useEffect, useState, useCallback, useRef, useLayoutEffect } from 'react';
import { useParams } from 'next/navigation';
import { MicRecorder } from '@/components/MicRecorder';
import { LiveCaption } from '@/components/LiveCaption';
import { QuestionCard } from '@/components/QuestionCard';
import { Scorecard } from '@/components/Scorecard';
import { LearningSummary } from '@/components/LearningSummary';
import { useRouter } from 'next/navigation';

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
    technicalAccuracy?: number | null;
    terminologyUsage?: number | null;
    conciseness?: number | null;
    pacing?: number | null;
    emphasis?: number | null;
    engagement?: number | null;
  };
  tips: string[];
  questionAnswered?: boolean | null;
  answerQuality?: number | null;
  whatWasRight?: string[];
  whatWasWrong?: string[];
  betterWording?: string[];
  dontForget?: string[];
  repeatedWords?: Array<{ word: string; count: number; percentage: number }>;
  hasExcessiveRepetition?: boolean;
}

export default function PracticeSessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scorecard, setScorecard] = useState<SessionItem | null>(null);
  const [previousScorecard, setPreviousScorecard] = useState<SessionItem | null>(null);
  const [sessionItems, setSessionItems] = useState<SessionItem[]>([]);
  const [isCompleting, setIsCompleting] = useState(false);
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false); // Show answer/hint after recording
  const [timeLimit, setTimeLimit] = useState<number | null>(null); // Recording time limit in seconds
  const [isInitialLoad, setIsInitialLoad] = useState(true); // Track if this is the first load
  const prevQuestionIndexRef = useRef<number>(0);

  const fetchSessionData = useCallback(async () => {
    if (!sessionId) {
      console.error('No session ID provided');
      return;
    }

    try {
      setLoading(true);
      // Get maxQuestions from localStorage if set during creation
      const storedMaxQuestions = localStorage.getItem(`session_${sessionId}_maxQuestions`);
      const maxQuestions = storedMaxQuestions ? parseInt(storedMaxQuestions, 10) : undefined;
      
      // Build URL with maxQuestions query param if it exists
      const url = maxQuestions && maxQuestions > 0 
        ? `/api/sessions/${sessionId}?maxQuestions=${maxQuestions}`
        : `/api/sessions/${sessionId}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        // Handle different error cases
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        
        if (response.status === 404) {
          // Session not found - might have been deleted
          console.error('Session not found:', sessionId);
          alert('Session not found. It may have been deleted. Redirecting to practice page.');
          router.push('/practice');
          return;
        }
        
        if (response.status === 403) {
          // Access denied
          console.error('Access denied to session:', sessionId);
          alert('You do not have access to this session. Redirecting to practice page.');
          router.push('/practice');
          return;
        }
        
        // Other errors
        console.error('Error fetching session:', errorData);
        alert(`Failed to load session: ${errorData.error || 'Unknown error'}. Redirecting to practice page.`);
        router.push('/practice');
        return;
      }

      const data = await response.json();
      
      // Validate we got valid data
      if (!data || !Array.isArray(data.questions)) {
        console.error('Invalid session data received:', data);
        alert('Invalid session data. Please try again.');
        return;
      }

      // Limit questions on frontend if maxQuestions is set
      let questions = data.questions || [];
      if (maxQuestions && maxQuestions > 0 && questions.length > maxQuestions) {
        questions = questions.slice(0, maxQuestions);
      }
      
      // Ensure we have at least one question
      if (questions.length === 0) {
        console.error('Session has no questions');
        alert('This session has no questions. Redirecting to practice page.');
        router.push('/practice');
        return;
      }
      
      // Only update questions on initial load to prevent reordering during session
      if (isInitialLoad) {
        setQuestions(questions);

        // Restore question index from sessionStorage if available (page refresh)
        const savedIndex = sessionStorage.getItem(`session_${sessionId}_questionIndex`);
        const restoredIndex = savedIndex !== null ? parseInt(savedIndex, 10) : null;

        const resumeIndex = restoredIndex !== null && restoredIndex >= 0 && restoredIndex < questions.length
          ? restoredIndex
          : data.firstUnansweredIndex !== undefined && data.firstUnansweredIndex < questions.length
          ? data.firstUnansweredIndex
          : 0;
        setCurrentQuestionIndex(resumeIndex);

        // Restore last scorecard from sessionStorage
        const savedScorecard = sessionStorage.getItem(`session_${sessionId}_scorecard`);
        if (savedScorecard) {
          try {
            setScorecard(JSON.parse(savedScorecard));
          } catch {
            // Ignore parse errors
          }
        }

        setIsInitialLoad(false);
      }
      
      // Always update session items to get latest attempts
      setSessionItems(data.items || []);
      
      // Check if session is already completed
      if (data.isCompleted) {
        setSessionCompleted(true);
      }
    } catch (error) {
      console.error('Error fetching session:', error);
      // Network error or other exception
      alert('Failed to load session. Please check your connection and try again.');
      // Don't redirect on network errors - let user retry
    } finally {
      setLoading(false);
    }
  }, [sessionId, isInitialLoad, router]);

  useEffect(() => {
    // Always load session from URL parameter - never create new
    if (sessionId && sessionId.trim() !== '') {
      fetchSessionData();
    } else {
      console.error('Invalid session ID in URL');
      alert('Invalid session ID. Redirecting to practice page.');
      router.push('/practice');
    }
  }, [sessionId]); // Only depend on sessionId, not fetchSessionData to avoid re-runs

  // Persist question index to sessionStorage on change
  useEffect(() => {
    if (!isInitialLoad && sessionId) {
      sessionStorage.setItem(`session_${sessionId}_questionIndex`, currentQuestionIndex.toString());
    }
  }, [currentQuestionIndex, sessionId, isInitialLoad]);

  // Persist scorecard to sessionStorage on change
  useEffect(() => {
    if (sessionId && scorecard) {
      sessionStorage.setItem(`session_${sessionId}_scorecard`, JSON.stringify(scorecard));
    }
  }, [scorecard, sessionId]);

  // Reset scorecard and answer visibility when question changes
  useLayoutEffect(() => {
    if (prevQuestionIndexRef.current !== currentQuestionIndex) {
      prevQuestionIndexRef.current = currentQuestionIndex;
      setScorecard(null); // Hide scorecard when moving to new question
      setShowAnswer(false); // Hide answer when moving to new question
      // Don't auto-restore previous attempts - user must click to view them
    }
  }, [currentQuestionIndex, questions]);

  const handleRecordingComplete = async (blob: Blob) => {
    if (questions.length === 0) return;

    const currentQuestion = questions[currentQuestionIndex];
    if (!currentQuestion) {
      alert('Invalid question. Please refresh the page.');
      return;
    }

    setLoading(true);
    try {
      // Load coaching preferences from localStorage (user-global + session preset)
      const savedPreferences = localStorage.getItem('coachingPreferences');
      let preferences: Record<string, unknown> = {};
      if (savedPreferences) {
        try {
          preferences = JSON.parse(savedPreferences);
        } catch {
          // Ignore parse errors
        }
      }

      // Merge session preset preferences (override user defaults with preset-specific settings)
      const sessionPreset = localStorage.getItem(`session_${sessionId}_preset`);
      if (sessionPreset) {
        try {
          const { PRACTICE_PRESETS } = await import('@/lib/coaching-config');
          const presetConfig = PRACTICE_PRESETS[sessionPreset as keyof typeof PRACTICE_PRESETS];
          if (presetConfig?.preferences) {
            preferences = { ...preferences, ...presetConfig.preferences };
          }
        } catch {
          // Ignore import errors
        }
      }

      const formData = new FormData();
      formData.append('audio', blob, 'recording.webm');
      formData.append('sessionId', sessionId);
      formData.append('questionId', currentQuestion.id);
      if (preferences && Object.keys(preferences).length > 0) {
        formData.append('preferences', JSON.stringify(preferences));
      }

      const response = await fetch('/api/practice', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        
        // Answer is already shown from onStop callback, but ensure it stays visible
        // The transcript confirms the recording was processed
        if (result.transcript) {
          setShowAnswer(true);
        }
        
        // Capture previous attempt for comparison (latest attempt for this question before the new one)
        const previousAttempts = sessionItems
          .filter(item => item.questionId === currentQuestion.id)
          .sort((a, b) => (b.id > a.id ? 1 : -1)); // Most recent first by ID
        setPreviousScorecard(previousAttempts.length > 0 ? previousAttempts[0] : null);

        // Set scorecard with full analysis - this will update dontForget and bold highlighting
        setScorecard({
          id: result.id,
          questionId: currentQuestion.id,
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
          dontForget: result.dontForget,
          repeatedWords: result.repeatedWords,
          hasExcessiveRepetition: result.hasExcessiveRepetition,
        });
        
        // Add the new session item to the local state without re-fetching questions
        // This prevents question reordering during the session
        setSessionItems(prev => [
          {
            id: result.id,
            questionId: currentQuestion.id,
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
            dontForget: result.dontForget,
            repeatedWords: result.repeatedWords,
            hasExcessiveRepetition: result.hasExcessiveRepetition,
          },
          ...prev,
        ]);
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

  const handleFinishSession = async () => {
    if (sessionItems.length === 0) {
      alert('Please answer at least one question before finishing the session.');
      return;
    }

    setIsCompleting(true);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/complete`, {
        method: 'POST',
      });

      if (response.ok) {
        setSessionCompleted(true);
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error completing session:', error);
      alert('Failed to complete session');
    } finally {
      setIsCompleting(false);
    }
  };

  const currentQuestion = questions[currentQuestionIndex];
  const isLastQuestion = currentQuestionIndex === questions.length - 1;

	// Show learning summary if session is completed
  if (sessionCompleted) {
    return (
      <div className="px-4 py-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <h1 className="text-3xl font-bold mb-2 text-slate-900 dark:text-slate-100">Session Complete!</h1>
            <p className="text-slate-600 dark:text-slate-400">Here&apos;s your learning summary</p>
          </div>
          <LearningSummary sessionId={sessionId} />
          <div className="mt-6 flex gap-4 flex-wrap">
            <button
              onClick={() => {
                // Reset session state and allow practicing again
                setSessionCompleted(false);
                setCurrentQuestionIndex(0);
                setScorecard(null);
                setSessionItems([]);
                // Scroll to top
                window.scrollTo(0, 0);
              }}
              className="px-6 py-3 bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 text-green-800 dark:text-green-200 rounded-lg transition-all font-semibold"
            >
              Practice Again
            </button>
            <button
              onClick={() => router.push('/practice')}
              className="px-6 py-3 bg-purple-200 dark:bg-purple-800 hover:bg-purple-300 dark:hover:bg-purple-700 text-purple-800 dark:text-purple-200 rounded-lg transition-all font-semibold"
            >
              Back to Practice Sessions
            </button>
            <button
              onClick={() => router.push('/learning')}
              className="px-6 py-3 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
            >
              View All Learning Insights
            </button>
            <button
              onClick={async () => {
                try {
                  const res = await fetch(`/api/reports?sessionId=${sessionId}`);
                  if (res.ok) {
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `iprep-report.pdf`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } else {
                    alert('Failed to generate report');
                  }
                } catch {
                  alert('Failed to download report');
                }
              }}
              className="px-6 py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-sm"
            >
              Download PDF Report
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show loading state while fetching session
  if (loading && questions.length === 0) {
    return (
      <div className="px-4 py-6">
        <div className="max-w-4xl mx-auto text-center py-12">
          <div className="text-slate-600 dark:text-slate-400">Loading session...</div>
        </div>
      </div>
    );
  }

  // Show error if no questions loaded
  if (!loading && questions.length === 0) {
    return (
      <div className="px-4 py-6">
        <div className="max-w-4xl mx-auto text-center py-12">
          <div className="text-slate-600 dark:text-slate-400 mb-4">Session not found or has no questions.</div>
          <button
            onClick={() => router.push('/practice')}
            className="px-6 py-3 bg-purple-200 dark:bg-purple-800 hover:bg-purple-300 dark:hover:bg-purple-700 text-purple-800 dark:text-purple-200 rounded-lg transition-all font-medium"
          >
            Back to Practice Sessions
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Question */}
        <div className="lg:col-span-1">
          {currentQuestion ? (
            <div className="space-y-4">
              <QuestionCard
                question={currentQuestion}
                currentQuestionNumber={currentQuestionIndex + 1}
                totalQuestions={questions.length}
                showHint={showAnswer} // Show hint/answer after recording
                dontForget={scorecard?.dontForget || []} // Pass forgotten points to highlight in hint
                onNext={() => {
                  if (currentQuestionIndex < questions.length - 1) {
                    setCurrentQuestionIndex(currentQuestionIndex + 1);
                    setScorecard(null);
                    setShowAnswer(false); // Hide answer when moving to next
                  }
                }}
                hasNext={currentQuestionIndex < questions.length - 1}
              />
              {/* Finish Session Button - Show on last question */}
              {isLastQuestion && (
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
                  <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                    {sessionItems.length > 0
                      ? "You&apos;ve answered questions in this session. Finish to see your learning summary."
                      : 'Answer at least one question, then finish the session to see your learning summary.'}
                  </p>
                  <button
                    onClick={handleFinishSession}
                    disabled={isCompleting || sessionItems.length === 0}
                    className="w-full px-6 py-3 bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 text-green-800 dark:text-green-200 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                  >
                    Finish Session & View Summary
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
              <p className="text-slate-600 dark:text-slate-400">No questions available for this session.</p>
            </div>
          )}
        </div>

        {/* Center Column - Recorder */}
        <div className="lg:col-span-1 flex flex-col items-center gap-6">
          {/* Timer selector */}
          {!isRecording && (
            <div className="flex flex-wrap gap-1.5 justify-center">
              {[
                { label: 'No limit', value: null },
                { label: '30s', value: 30 },
                { label: '1m', value: 60 },
                { label: '90s', value: 90 },
                { label: '2m', value: 120 },
                { label: '5m', value: 300 },
              ].map((option) => (
                <button
                  key={option.label}
                  onClick={() => setTimeLimit(option.value)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    timeLimit === option.value
                      ? 'bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          <MicRecorder
            onRecordingComplete={handleRecordingComplete}
            onStart={() => setIsRecording(true)}
            onStop={() => {
              setIsRecording(false);
              // Show answer immediately when recording stops
              setShowAnswer(true);
            }}
            disabled={loading || !currentQuestion || (sessionItems.some(item => item.questionId === currentQuestion.id))}
            timeLimit={timeLimit}
          />
          {/* Only show LiveCaption when recording - consolidate into one box */}
          {isRecording && <LiveCaption isRecording={isRecording} />}
        </div>

        {/* Right Column - Scorecard */}
        <div className="lg:col-span-1">
          {loading ? (
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
              <div className="flex flex-col items-center justify-center py-12">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mb-4"></div>
                <p className="text-slate-700 dark:text-slate-300 font-medium">Processing your answer...</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Analyzing speech patterns and content</p>
              </div>
            </div>
          ) : scorecard ? (
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
            dontForget={scorecard.dontForget}
            repeatedWords={scorecard.repeatedWords}
            hasExcessiveRepetition={scorecard.hasExcessiveRepetition}
            transcript={scorecard.transcript}
            onReanalyze={async (correctedTranscript: string) => {
              const currentQuestion = questions[currentQuestionIndex];
              if (!currentQuestion) return;
              try {
                const res = await fetch('/api/practice/reanalyze', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    sessionItemId: scorecard.id,
                    transcript: correctedTranscript,
                    sessionId,
                    questionId: currentQuestion.id,
                  }),
                });
                if (res.ok) {
                  const result = await res.json();
                  setScorecard({
                    id: result.id || scorecard.id,
                    questionId: currentQuestion.id,
                    audioUrl: scorecard.audioUrl,
                    transcript: correctedTranscript,
                    metrics: result.metrics,
                    scores: result.scores,
                    tips: result.tips,
                    questionAnswered: result.questionAnswered,
                    answerQuality: result.answerQuality,
                    whatWasRight: result.whatWasRight,
                    whatWasWrong: result.whatWasWrong || [],
                    betterWording: result.betterWording,
                    dontForget: result.dontForget,
                    repeatedWords: result.repeatedWords,
                    hasExcessiveRepetition: result.hasExcessiveRepetition,
                  });
                } else {
                  const err = await res.json();
                  alert(`Re-analysis failed: ${err.error || 'Unknown error'}`);
                }
              } catch (error) {
                console.error('Re-analysis error:', error);
                alert('Re-analysis failed. Please try again.');
              }
            }}
            questionTags={questions[currentQuestionIndex]?.tags}
            previousScores={previousScorecard?.scores}
            previousMetrics={previousScorecard?.metrics}
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
