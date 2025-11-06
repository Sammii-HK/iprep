'use client';

import { useEffect, useState } from 'react';

interface CommonMistake {
  pattern: string;
  frequency: number;
  examples: string[];
}

interface PerformanceByTag {
  [tag: string]: {
    avgScore: number;
    count: number;
    questions: string[];
  };
}

interface LearningSummaryData {
  commonMistakes: CommonMistake[];
  weakTags: string[];
  strongTags: string[];
  recommendedFocus: string[];
  performanceByTag: PerformanceByTag;
  overallScore: number | null;
}

export function LearningSummary({ sessionId }: { sessionId: string }) {
  const [summary, setSummary] = useState<LearningSummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSummary() {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/summary`);
        if (response.ok) {
          const data = await response.json();
          setSummary(data.summary);
        }
      } catch (error) {
        console.error('Error fetching summary:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchSummary();
  }, [sessionId]);

  if (loading) {
    return <div className="text-gray-600">Loading summary...</div>;
  }

  if (!summary) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Session Summary</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Analysis based on answers from this practice session only
        </p>
      </div>

      {summary.overallScore !== null && (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">Overall Score</div>
          <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">
            {summary.overallScore.toFixed(1)} / 5.0
          </div>
        </div>
      )}

      {summary.commonMistakes.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Common Mistakes
          </h3>
          <ul className="space-y-2">
            {summary.commonMistakes.map((mistake, idx) => (
              <li key={idx} className="bg-red-50 dark:bg-red-900/20 rounded p-3">
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {mistake.pattern} ({mistake.frequency}x)
                </div>
                {mistake.examples.length > 0 && (
                  <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Examples: {mistake.examples.join(', ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.weakTags.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Areas to Improve
          </h3>
          <div className="flex flex-wrap gap-2">
            {summary.weakTags.map((tag) => (
              <span
                key={tag}
                className="bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 px-3 py-1 rounded-full text-sm"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {summary.strongTags.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Strong Areas
          </h3>
          <div className="flex flex-wrap gap-2">
            {summary.strongTags.map((tag) => (
              <span
                key={tag}
                className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 px-3 py-1 rounded-full text-sm"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {summary.recommendedFocus.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Recommended Focus Areas
          </h3>
          <div className="flex flex-wrap gap-2">
            {summary.recommendedFocus.map((tag) => (
              <span
                key={tag}
                className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 px-3 py-1 rounded-full text-sm font-medium"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {Object.keys(summary.performanceByTag).length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Performance by Topic
          </h3>
          <div className="space-y-2">
            {Object.entries(summary.performanceByTag)
              .sort(([, a], [, b]) => a.avgScore - b.avgScore)
              .map(([tag, data]) => (
                <div key={tag} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 rounded p-2">
                  <span className="text-gray-900 dark:text-gray-100">{tag}</span>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {data.count} questions
                    </span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {data.avgScore.toFixed(1)} / 5.0
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

