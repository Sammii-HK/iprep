'use client';

interface Question {
  id: string;
  text: string;
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
}

export function QuestionCard({
  question,
  onNext,
  onPrevious,
  hasNext = false,
  hasPrevious = false,
  onRetryWithHint,
}: QuestionCardProps) {
  const difficultyColors = {
    1: 'bg-green-100 text-green-800',
    2: 'bg-blue-100 text-blue-800',
    3: 'bg-yellow-100 text-yellow-800',
    4: 'bg-orange-100 text-orange-800',
    5: 'bg-red-100 text-red-800',
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="mb-4">
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
              className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="text-lg mb-6">{question.text}</div>

      <div className="flex gap-2">
        {hasPrevious && (
          <button
            onClick={onPrevious}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded transition-colors"
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
            onClick={onNext}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors ml-auto"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
