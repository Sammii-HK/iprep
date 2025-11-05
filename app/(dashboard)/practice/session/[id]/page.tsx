'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { MicRecorder } from '@/components/MicRecorder';
import { LiveCaption } from '@/components/LiveCaption';
import { QuestionCard } from '@/components/QuestionCard';
import { Scorecard } from '@/components/Scorecard';

interface Question {
  id: string;
  text: string;
  tags: string[];
  difficulty: number;
}

interface SessionItem {
  id: string;
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

  useEffect(() => {
    if (sessionId) {
      fetchSessionData();
    }
  }, [sessionId]);

  const fetchSessionData = async () => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}`);
      if (response.ok) {
        const data = await response.json();
        setQuestions(data.questions || []);
        setSessionItems(data.items || []);
      }
    } catch (error) {
      console.error('Error fetching session:', error);
    }
  };

  const handleRecordingComplete = async (blob: Blob) => {
    if (questions.length === 0) return;

    setLoading(true);
    try {
      const currentQuestion = questions[currentQuestionIndex];
      const formData = new FormData();
      formData.append('audio', blob, 'recording.webm');
      formData.append('sessionId', sessionId);
      formData.append('questionId', currentQuestion.id);

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
                }
              }}
              onPrevious={() => {
                if (currentQuestionIndex > 0) {
                  setCurrentQuestionIndex(currentQuestionIndex - 1);
                  setScorecard(null);
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
            <div className="bg-white rounded-lg shadow-md p-6">
              <p className="text-gray-500">No questions available for this session.</p>
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
          <LiveCaption isRecording={isRecording} />
          {loading && (
            <div className="text-center py-4">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <p className="mt-2 text-gray-600">Processing...</p>
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
            />
          ) : (
            <div className="bg-white rounded-lg shadow-md p-6">
              <p className="text-gray-500 text-center">
                Record an answer to see your scorecard here.
              </p>
            </div>
          )}

          {/* Previous Attempts */}
          {sessionItems.length > 0 && (
            <div className="mt-6 bg-white rounded-lg shadow-md p-6">
              <h3 className="font-semibold mb-3">Previous Attempts</h3>
              <div className="space-y-2">
                {sessionItems.slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    className="p-3 bg-gray-50 rounded cursor-pointer hover:bg-gray-100"
                    onClick={() => setScorecard(item)}
                  >
                    <p className="text-sm text-gray-600">
                      {item.transcript?.substring(0, 50)}...
                    </p>
                    <div className="flex gap-2 mt-1">
                      <span className="text-xs text-gray-500">
                        WPM: {item.metrics.wpm}
                      </span>
                      <span className="text-xs text-gray-500">
                        Confidence: {item.scores.confidence}/5
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
