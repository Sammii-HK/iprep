'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';

interface TopForgottenPoint {
  point: string;
  totalFrequency: number;
  sessionCount: number;
  tags: string[];
}

interface UserInsights {
  aggregatedWeakTags: string[];
  aggregatedStrongTags: string[];
  topFocusAreas: string[];
  topForgottenPoints?: TopForgottenPoint[] | null;
  totalSessions: number;
  totalQuestions: number;
  lastUpdated: string;
}

export default function LearningPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [insights, setInsights] = useState<UserInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [premiumRequired, setPremiumRequired] = useState(false);

  useEffect(() => {
    async function fetchInsights() {
      try {
        const response = await fetch('/api/learning/insights');
        if (response.ok) {
          const data = await response.json();
          setInsights(data.insights);
        } else {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          console.error('Error fetching insights:', errorData);
          if (response.status === 403) {
            setPremiumRequired(true);
          }
        }
      } catch (error) {
        console.error('Error fetching insights:', error);
      } finally {
        setLoading(false);
      }
    }

    if (user) {
      fetchInsights();
    }
  }, [user]);

  if (loading) {
    return <div className="text-gray-600">Loading insights...</div>;
  }

  if (premiumRequired) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">
          Learning Insights
        </h1>
        <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
          <p className="text-purple-800 dark:text-purple-200 font-medium mb-2">
            Premium Feature
          </p>
          <p className="text-slate-600 dark:text-slate-400 text-sm">
            Learning Insights aggregates your performance across all sessions and quizzes to identify patterns, track progress, and highlight areas for improvement. This feature is coming soon for all users.
          </p>
        </div>
        <div className="mt-4">
          <button
            onClick={() => router.push('/practice')}
            className="px-4 py-2 bg-purple-200 dark:bg-purple-800 hover:bg-purple-300 dark:hover:bg-purple-700 text-purple-800 dark:text-purple-200 rounded-lg transition-colors font-medium"
          >
            Back to Practice
          </button>
        </div>
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">
          Learning Insights
        </h1>
        <p className="text-slate-600 dark:text-slate-400">
          Complete some practice sessions to see your learning insights.
        </p>
      </div>
    );
  }

  // Parse topForgottenPoints if it's a JSON string
  const topForgottenPoints: TopForgottenPoint[] | null = insights.topForgottenPoints
    ? typeof insights.topForgottenPoints === 'string'
      ? JSON.parse(insights.topForgottenPoints)
      : insights.topForgottenPoints
    : null;

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">
          Your Learning Insights
        </h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4">
            <div className="text-sm text-slate-600 dark:text-slate-400">Total Practice Sessions & Quizzes</div>
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {insights.totalSessions}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-500 mt-1">
              Aggregated from all completed sessions and quizzes
            </div>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
            <div className="text-sm text-slate-600 dark:text-slate-400">Total Questions Answered</div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {insights.totalQuestions}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-500 mt-1">
              Across all practice sessions and quizzes
            </div>
          </div>
        </div>
      </div>

      {/* What You Keep Forgetting - Most Important */}
      {topForgottenPoints && topForgottenPoints.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">
            🔑 What You Keep Forgetting
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
            These key points appear across multiple sessions - focus on remembering these:
          </p>
          <div className="space-y-3">
            {topForgottenPoints.map((item, index) => (
              <div
                key={index}
                className="p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600"
              >
                <div className="flex items-start justify-between mb-2">
                  <p className="font-medium text-slate-900 dark:text-slate-100 flex-1">
                    {item.point}
                  </p>
                  <span className="ml-4 px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 rounded text-xs font-semibold whitespace-nowrap">
                    {item.totalFrequency}x across {item.sessionCount} session{item.sessionCount !== 1 ? 's' : ''}
                  </span>
                </div>
                {item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {item.tags.slice(0, 5).map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-xs"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What You Need to Work On Most - Prioritized */}
      {insights.topFocusAreas.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-4">
            🎯 What You Need to Work On Most
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
            Prioritized topics based on your performance across all sessions:
          </p>
          <div className="space-y-2">
            {insights.topFocusAreas.map((tag, index) => (
              <div
                key={tag}
                className="flex items-center gap-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800"
              >
                <span className="flex-shrink-0 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-sm font-bold">
                  {index + 1}
                </span>
                <span className="font-medium text-red-900 dark:text-red-200">{tag}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {insights.aggregatedWeakTags.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-3">
            Areas to Improve
          </h2>
          <div className="flex flex-wrap gap-2">
            {insights.aggregatedWeakTags.map((tag) => (
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

      {insights.aggregatedStrongTags.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-3">
            ✅ Strong Areas
          </h2>
          <div className="flex flex-wrap gap-2">
            {insights.aggregatedStrongTags.map((tag) => (
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
    </div>
  );
}

