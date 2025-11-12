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
  onPrevious?: () => void; // Optional - only used in quizzes
  hasNext?: boolean;
  hasPrevious?: boolean; // Optional - only used in quizzes
  currentQuestionNumber?: number; // e.g., 1
  totalQuestions?: number; // e.g., 20
  showHint?: boolean; // Show hint/answer immediately
  dontForget?: string[]; // Points that were forgotten - will be bolded in hint
  onHintShown?: () => void; // Callback when hint is shown (for tracking in quizzes)
}

export function QuestionCard({
  question,
  onNext,
  onPrevious,
  hasNext = false,
  hasPrevious = false,
  currentQuestionNumber,
  totalQuestions,
  showHint = false, // Default to false, can be overridden
  dontForget = [], // Points that were forgotten
  onHintShown,
}: QuestionCardProps) {
  // Store hint state keyed by question ID to automatically reset when question changes
  const [hintStates, setHintStates] = useState<Record<string, boolean>>({});
  
  // Get hint state for current question - use showHint prop if provided, otherwise use stored state
  const showHintState = showHint || (hintStates[question.id] ?? false);
  
  const setShowHint = (show: boolean) => {
    setHintStates((prev) => {
      const newState = {
        ...prev,
        [question.id]: show,
      };
      
      // Track hint usage if showing hint for the first time
      if (show && !prev[question.id] && onHintShown) {
        onHintShown();
      }
      
      return newState;
    });
  };

  /**
   * Highlight parts of the hint that match forgotten points
   * Uses flexible matching to find relevant phrases in the hint
   */
  const highlightForgottenParts = (hintText: string): React.ReactNode => {
    if (!dontForget || dontForget.length === 0) {
      return <span>{hintText}</span>;
    }

    // Create a regex pattern from forgotten points
    // Extract key words/phrases from each forgotten point
    const patterns: string[] = [];
    const importantWords: string[] = [];
    
    dontForget.forEach((point) => {
      // Extract meaningful words (3+ characters, not common words)
      const words = point
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => {
          const cleaned = w.replace(/[^\w]/g, ''); // Remove punctuation
          return cleaned.length >= 3 && !['the', 'and', 'for', 'are', 'but', 'not', 'you', 'was', 'can', 'this', 'that', 'with', 'from', 'have', 'been', 'were', 'when', 'where', 'what', 'which', 'who', 'how', 'why'].includes(cleaned);
        });
      
      // Add individual important words for single-word matching
      importantWords.push(...words);
      
      // Create patterns from 2-3 word phrases
      for (let i = 0; i < words.length; i++) {
        if (i + 1 < words.length) {
          patterns.push(`${words[i]}\\s+${words[i + 1]}`);
        }
        if (i + 2 < words.length) {
          patterns.push(`${words[i]}\\s+${words[i + 1]}\\s+${words[i + 2]}`);
        }
      }
    });

    // Remove duplicates
    const uniquePatterns = [...new Set(patterns)];
    const uniqueWords = [...new Set(importantWords)];

    if (uniquePatterns.length === 0 && uniqueWords.length === 0) {
      return <span>{hintText}</span>;
    }

    // Combine patterns with word boundaries, prioritizing phrases over single words
    let combinedPattern: string;
    if (uniquePatterns.length > 0) {
      combinedPattern = `\\b(${uniquePatterns.join('|')})\\b`;
      if (uniqueWords.length > 0) {
        // Add single words as fallback, but with lower priority
        combinedPattern += `|\\b(${uniqueWords.join('|')})\\b`;
      }
    } else {
      combinedPattern = `\\b(${uniqueWords.join('|')})\\b`;
    }
    
    // Split text and highlight matches
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    const regex = new RegExp(combinedPattern, 'gi');

    // Reset regex lastIndex to avoid issues with global regex
    regex.lastIndex = 0;

    while ((match = regex.exec(hintText)) !== null) {
      // Add text before match
      if (match.index > lastIndex) {
        parts.push(hintText.substring(lastIndex, match.index));
      }
      
      // Add bolded match
      parts.push(
        <strong key={`${match.index}-${match[0]}`} className="font-bold">
          {match[0]}
        </strong>
      );
      
      lastIndex = regex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < hintText.length) {
      parts.push(hintText.substring(lastIndex));
    }

    return parts.length > 1 ? <>{parts}</> : <span>{hintText}</span>;
  };
  
  const difficultyColors = {
    1: 'bg-green-100 text-green-800',
    2: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200',
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
      
      {/* Show/Hide Hint Button - Always available */}
      <div className="mb-4">
        {!showHintState ? (
          <button
            onClick={() => setShowHint(true)}
            className="w-full px-4 py-2 bg-purple-200 dark:bg-purple-800 hover:bg-purple-300 dark:hover:bg-purple-700 text-purple-800 dark:text-purple-200 rounded-lg transition-colors text-sm font-medium"
          >
            Show Hint
          </button>
        ) : (
          <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
            <div className="flex justify-between items-start mb-2">
              <strong className="font-semibold text-slate-900 dark:text-slate-100">Answer/Hint:</strong>
              {!showHint && (
                <button
                  onClick={() => setShowHint(false)}
                  className="px-2 py-1 text-xs bg-purple-200 dark:bg-purple-800 hover:bg-purple-300 dark:hover:bg-purple-700 text-purple-800 dark:text-purple-200 rounded transition-colors"
                >
                  Hide
                </button>
              )}
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
              {question.hint ? (
                highlightForgottenParts(question.hint)
              ) : (
                `Use the question tags as context. Think about the key concepts related to: ${question.tags.join(', ')}. Structure your answer clearly and provide examples.`
              )}
            </p>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {hasPrevious && onPrevious && (
          <button
            onClick={onPrevious}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-slate-100 rounded transition-colors"
          >
            Previous
          </button>
        )}
        {hasNext && (
          <button
            onClick={() => {
              setHintStates((prev) => ({ ...prev, [question.id]: false })); // Hide hint when moving to next question
              onNext?.();
            }}
            className="px-4 py-2 bg-purple-200 dark:bg-purple-800 hover:bg-purple-300 dark:hover:bg-purple-700 text-purple-800 dark:text-purple-200 rounded-lg transition-all font-medium ml-auto"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
