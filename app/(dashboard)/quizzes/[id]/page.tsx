'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { MicRecorder } from '@/components/MicRecorder';
import { QuestionCard } from '@/components/QuestionCard';
import { Scorecard } from '@/components/Scorecard';

interface Question {
  id: string;
  text: string;
  tags: string[];
  difficulty: number;
}

interface Quiz {
  id: string;
  title: string;
  type: 'SPOKEN' | 'WRITTEN';
  questions: Question[];
}

export default function QuizPage() {
  const params = useParams();
  const quizId = params.id as string;

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [writtenAnswer, setWrittenAnswer] = useState('');
  const [scorecard, setScorecard] = useState<any>(null);
  const [completedQuestions, setCompletedQuestions] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (quizId) {
      fetchQuiz();
    }
  }, [quizId]);

  const fetchQuiz = async () => {
    try {
      const response = await fetch(`/api/quizzes/${quizId}`);
      if (response.ok) {
        const data = await response.json();
        setQuiz(data);
      }
    } catch (error) {
      console.error('Error fetching quiz:', error);
    }
  };

  const handleRecordingComplete = async (blob: Blob) => {
    if (!quiz || quiz.type !== 'SPOKEN') return;

    setLoading(true);
    try {
      const currentQuestion = quiz.questions[currentQuestionIndex];
      const formData = new FormData();
      formData.append('audio', blob, 'recording.webm');
      formData.append('quizId', quizId);
      formData.append('questionId', currentQuestion.id);

      const response = await fetch('/api/quizzes/attempt', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        setScorecard({
          answer: result.transcript || result.answer,
          audioUrl: result.audioUrl,
          score: result.score,
          feedback: result.feedback?.split(' | ') || [],
        });
        setCompletedQuestions(new Set([...completedQuestions, currentQuestion.id]));
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

  const handleWrittenSubmit = async () => {
    if (!quiz || quiz.type !== 'WRITTEN' || !writtenAnswer.trim()) {
      alert('Please enter an answer');
      return;
    }

    setLoading(true);
    try {
      const currentQuestion = quiz.questions[currentQuestionIndex];
      const formData = new FormData();
      formData.append('answer', writtenAnswer);
      formData.append('quizId', quizId);
      formData.append('questionId', currentQuestion.id);

      const response = await fetch('/api/quizzes/attempt', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        setScorecard({
          answer: result.answer,
          score: result.score,
          feedback: result.feedback?.split(' | ') || [],
        });
        setCompletedQuestions(new Set([...completedQuestions, currentQuestion.id]));
        setWrittenAnswer('');
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error submitting answer:', error);
      alert('Failed to submit answer');
    } finally {
      setLoading(false);
    }
  };

  if (!quiz) {
    return <div className="text-center py-12">Loading...</div>;
  }

  const currentQuestion = quiz.questions[currentQuestionIndex];
  const progress = (completedQuestions.size / quiz.questions.length) * 100;

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">{quiz.title}</h1>
        <div className="flex items-center gap-4">
          <div className="flex-1 bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-sm text-gray-600">
            {completedQuestions.size} / {quiz.questions.length} completed
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Question */}
        <div className="lg:col-span-1">
          {currentQuestion ? (
            <QuestionCard
              question={currentQuestion}
              onNext={() => {
                if (currentQuestionIndex < quiz.questions.length - 1) {
                  setCurrentQuestionIndex(currentQuestionIndex + 1);
                  setScorecard(null);
                  setWrittenAnswer('');
                }
              }}
              onPrevious={() => {
                if (currentQuestionIndex > 0) {
                  setCurrentQuestionIndex(currentQuestionIndex - 1);
                  setScorecard(null);
                  setWrittenAnswer('');
                }
              }}
              hasNext={currentQuestionIndex < quiz.questions.length - 1}
              hasPrevious={currentQuestionIndex > 0}
            />
          ) : (
            <div className="bg-white rounded-lg shadow-md p-6">
              <p className="text-gray-500">No questions available.</p>
            </div>
          )}
        </div>

        {/* Center Column - Answer Input */}
        <div className="lg:col-span-1 flex flex-col items-center gap-6">
          {quiz.type === 'SPOKEN' ? (
            <>
              <MicRecorder
                onRecordingComplete={handleRecordingComplete}
                onStart={() => setIsRecording(true)}
                onStop={() => setIsRecording(false)}
              />
              {loading && (
                <div className="text-center py-4">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                  <p className="mt-2 text-gray-600">Processing...</p>
                </div>
              )}
            </>
          ) : (
            <div className="w-full">
              <label className="block text-sm font-medium mb-2">Your Answer</label>
              <textarea
                value={writtenAnswer}
                onChange={(e) => setWrittenAnswer(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg min-h-[200px]"
                placeholder="Type your answer here..."
              />
              <button
                onClick={handleWrittenSubmit}
                disabled={loading || !writtenAnswer.trim()}
                className="mt-4 w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Submitting...' : 'Submit Answer'}
              </button>
            </div>
          )}
        </div>

        {/* Right Column - Scorecard */}
        <div className="lg:col-span-1">
          {scorecard ? (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold mb-4">Results</h2>
              {scorecard.score !== null && (
                <div className="mb-4">
                  <div className="text-4xl font-bold text-blue-600 mb-2">
                    {scorecard.score}/100
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{ width: `${scorecard.score}%` }}
                    />
                  </div>
                </div>
              )}
              {scorecard.answer && (
                <div className="mb-4">
                  <h3 className="font-semibold mb-2">Your Answer:</h3>
                  <p className="text-gray-700">{scorecard.answer}</p>
                </div>
              )}
              {scorecard.feedback && scorecard.feedback.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-2">Feedback:</h3>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    {scorecard.feedback.map((tip: string, index: number) => (
                      <li key={index} className="text-gray-700">
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {scorecard.audioUrl && (
                <div className="mt-4">
                  <audio controls className="w-full">
                    <source src={scorecard.audioUrl} type="audio/webm" />
                  </audio>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-md p-6">
              <p className="text-gray-500 text-center">
                {quiz.type === 'SPOKEN'
                  ? 'Record an answer to see your results here.'
                  : 'Submit an answer to see your results here.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
