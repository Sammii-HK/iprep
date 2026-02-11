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
    sessionCount: number;
  };
}

interface BankSummaryData {
  bankId: string;
  bankTitle: string;
  totalSessions: number;
  totalQuestions: number;
  aggregatedCommonMistakes: CommonMistake[];
  aggregatedWeakTags: string[];
  aggregatedStrongTags: string[];
  aggregatedRecommendedFocus: string[];
  aggregatedPerformanceByTag: PerformanceByTag;
  averageOverallScore: number | null;
  sessions: Array<{
    id: string;
    title: string;
    completedAt: string | null;
    overallScore: number | null;
    questionCount: number;
  }>;
}

export function BankSummary({ bankId }: { bankId: string }) {
  const [summary, setSummary] = useState<BankSummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSummary() {
      try {
        const response = await fetch(`/api/banks/${bankId}/summary`);
        if (response.ok) {
          const data = await response.json();
          setSummary(data);
        } else {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          console.error('Error fetching bank summary:', errorData);
          // Set summary to null to show error message
          setSummary(null);
        }
      } catch (error) {
        console.error('Error fetching bank summary:', error);
        setSummary(null);
      } finally {
        setLoading(false);
      }
    }

    if (bankId) {
      fetchSummary();
    }
  }, [bankId]);

  if (loading) {
    return <div className="text-slate-600 dark:text-slate-400">Loading summary...</div>;
  }

  if (!summary) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
        <p className="text-slate-600 dark:text-slate-400">
          No completed sessions found for this question bank.
        </p>
      </div>
    );
  }

  if (summary.totalSessions === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
        <p className="text-slate-600 dark:text-slate-400">
          Complete some practice sessions to see your aggregated learning summary.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
          Practice Set Summary: {summary.bankTitle}
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Aggregated insights from {summary.totalSessions} completed session{summary.totalSessions !== 1 ? 's' : ''} ({summary.totalQuestions} total questions)
        </p>
      </div>

      {summary.averageOverallScore !== null && (
        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4">
          <div className="text-sm text-slate-600 dark:text-slate-400">Average Overall Score</div>
          <div className="text-3xl font-bold text-purple-600 dark:text-purple-400">
            {summary.averageOverallScore.toFixed(1)} / 10.0
          </div>
        </div>
      )}

      {summary.aggregatedCommonMistakes.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Common Mistakes Across All Sessions
          </h3>
          <ul className="space-y-2">
            {summary.aggregatedCommonMistakes.map((mistake, idx) => (
              <li key={idx} className="bg-red-50 dark:bg-red-900/20 rounded p-3">
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  {mistake.pattern} ({mistake.frequency}x across sessions)
                </div>
                {mistake.examples.length > 0 && (
                  <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    Examples: {mistake.examples.join(', ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.aggregatedWeakTags.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Areas to Improve (Consistent Across Sessions)
          </h3>
          <div className="flex flex-wrap gap-2">
            {summary.aggregatedWeakTags.map((tag) => (
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

      {summary.aggregatedStrongTags.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Strong Areas (Consistent Across Sessions)
          </h3>
          <div className="flex flex-wrap gap-2">
            {summary.aggregatedStrongTags.map((tag) => (
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

      {summary.aggregatedRecommendedFocus.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Recommended Focus Areas
          </h3>
          <div className="flex flex-wrap gap-2">
            {summary.aggregatedRecommendedFocus.map((tag) => (
              <span
                key={tag}
                className="bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 px-3 py-1 rounded-full text-sm font-medium"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {Object.keys(summary.aggregatedPerformanceByTag).length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Performance by Topic (Averaged Across Sessions)
          </h3>
          <div className="space-y-2">
            {Object.entries(summary.aggregatedPerformanceByTag)
              .sort(([, a], [, b]) => a.avgScore - b.avgScore)
              .map(([tag, data]) => (
                <div key={tag} className="flex items-center justify-between bg-slate-50 dark:bg-slate-700 rounded p-2">
                  <span className="text-slate-900 dark:text-slate-100">{tag}</span>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {data.sessionCount} session{data.sessionCount !== 1 ? 's' : ''}
                    </span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {data.avgScore.toFixed(1)} / 10.0
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {summary.sessions.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Individual Session Scores
          </h3>
          <div className="space-y-2">
            {summary.sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between bg-slate-50 dark:bg-slate-700 rounded p-3"
              >
                <div>
                  <div className="font-medium text-slate-900 dark:text-slate-100">{session.title}</div>
                  <div className="text-sm text-slate-600 dark:text-slate-400">
                    {session.questionCount} questions • {session.completedAt ? new Date(session.completedAt).toLocaleDateString() : 'N/A'}
                  </div>
                </div>
                {session.overallScore !== null && (
                  <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {session.overallScore.toFixed(1)} / 10.0
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

