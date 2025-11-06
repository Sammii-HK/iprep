'use client';

import { useState } from 'react';

interface Question {
  id: string;
  text: string;
  hint?: string | null;
  tags: string[];
  difficulty: number;
}

interface QuestionCardProps {
  question: Question;
  onNext?: () => void;
  onPrevious?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
  onRetryWithHint?: () => void;
  currentQuestionNumber?: number; // e.g., 1
  totalQuestions?: number; // e.g., 20
}

export function QuestionCard({
  question,
  onNext,
  onPrevious,
  hasNext = false,
  hasPrevious = false,
  onRetryWithHint,
  currentQuestionNumber,
  totalQuestions,
}: QuestionCardProps) {
  // Store hint state keyed by question ID to automatically reset when question changes
  const [hintStates, setHintStates] = useState<Record<string, boolean>>({});
  
  // Get hint state for current question (defaults to false for new questions)
  const showHint = hintStates[question.id] ?? false;
  
  const setShowHint = (show: boolean) => {
    setHintStates((prev) => ({
      ...prev,
      [question.id]: show,
    }));
  };
  
  const difficultyColors = {
    1: 'bg-green-100 text-green-800',
    2: 'bg-blue-100 text-blue-800',
    3: 'bg-yellow-100 text-yellow-800',
    4: 'bg-orange-100 text-orange-800',
    5: 'bg-red-100 text-red-800',
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
      <div className="mb-4">
        {(currentQuestionNumber !== undefined && totalQuestions !== undefined) && (
          <div className="mb-3">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Question {currentQuestionNumber} of {totalQuestions}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 mb-2">
          <span
            className={`px-2 py-1 rounded text-xs font-semibold ${
              difficultyColors[question.difficulty as keyof typeof difficultyColors] ||
              difficultyColors[3]
            }`}
          >
            Difficulty: {question.difficulty}/5
          </span>
          {question.tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded text-xs"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="text-lg mb-6 text-slate-900 dark:text-slate-100">{question.text}</div>
      
      {onRetryWithHint && (
            <div className="mb-4">
              {!showHint ? (
                <button
                  onClick={() => setShowHint(true)}
                  className="w-full px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition-colors text-sm"
                >
                  Show Hint
                </button>
              ) : (
                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                  <div className="flex justify-between items-start mb-2">
                    <strong className="font-semibold text-slate-900 dark:text-slate-100">Hint:</strong>
                    <button
                      onClick={() => setShowHint(false)}
                      className="px-2 py-1 text-xs bg-purple-200 dark:bg-purple-800 hover:bg-purple-300 dark:hover:bg-purple-700 text-purple-800 dark:text-purple-200 rounded transition-colors"
                    >
                      Hide
                    </button>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {question.hint || `Use the question tags as context. Think about the key concepts related to: ${question.tags.join(', ')}. Structure your answer clearly and provide examples.`}
                  </p>
                </div>
              )}
            </div>
          )}

      <div className="flex gap-2">
        {hasPrevious && (
          <button
            onClick={onPrevious}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-slate-100 rounded transition-colors"
          >
            Previous
          </button>
        )}
        {onRetryWithHint && (
          <button
            onClick={onRetryWithHint}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
          >
            Retry with Hint
          </button>
        )}
        {hasNext && (
          <button
            onClick={() => {
              setShowHint(false); // Hide hint when moving to next question
              onNext?.();
            }}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors ml-auto"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
