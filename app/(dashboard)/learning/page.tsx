'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';

interface UserInsights {
  aggregatedWeakTags: string[];
  aggregatedStrongTags: string[];
  topFocusAreas: string[];
  totalSessions: number;
  totalQuestions: number;
  lastUpdated: string;
}

export default function LearningPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [insights, setInsights] = useState<UserInsights | null>(null);
  const [loading, setLoading] = useState(true);

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
            // Premium required - but don't redirect, just show message
            console.log('Premium access required for learning insights');
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

  if (!insights) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          Learning Insights
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Complete some practice sessions to see your learning insights.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          Your Learning Insights
        </h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4">
            <div className="text-sm text-gray-600 dark:text-gray-400">Total Sessions</div>
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400 dark:text-purple-400">
              {insights.totalSessions}
            </div>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
            <div className="text-sm text-gray-600 dark:text-gray-400">Total Questions</div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {insights.totalQuestions}
            </div>
          </div>
        </div>
      </div>

      {insights.aggregatedWeakTags.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">
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
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">
            Strong Areas
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

      {insights.topFocusAreas.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">
            Top Focus Areas
          </h2>
          <div className="flex flex-wrap gap-2">
            {insights.topFocusAreas.map((tag) => (
              <span
                key={tag}
                className="bg-purple-100 dark:bg-purple-900/30 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200 dark:text-purple-300 px-3 py-1 rounded-full text-sm font-medium"
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

