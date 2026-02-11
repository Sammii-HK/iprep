'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface FrequentlyForgottenPoint {
  point: string;
  frequency: number;
  questions: string[];
  tags: string[];
}

interface FrequentlyMisusedTerm {
  incorrectTerm: string;
  correctTerm: string;
  frequency: number;
  questions: string[];
  tags: string[];
  examples: string[];
}

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
  frequentlyForgottenPoints?: FrequentlyForgottenPoint[];
  frequentlyMisusedTerms?: FrequentlyMisusedTerm[];
  weakTags: string[];
  strongTags: string[];
  recommendedFocus: string[];
  performanceByTag: PerformanceByTag;
  overallScore: number | null;
}

export function LearningSummary({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [summary, setSummary] = useState<LearningSummaryData | null>(null);
  const [bankId, setBankId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingSession, setCreatingSession] = useState(false);

  useEffect(() => {
    async function fetchSummary() {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/summary`);
        if (response.ok) {
          const data = await response.json();
          if (process.env.NODE_ENV === 'development') {
            console.log('Summary data received:', data);
          }
          setSummary(data.summary);
          setBankId(data.bankId);
        } else {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          console.error('Failed to fetch summary:', errorData);
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
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
        <div className="text-slate-600 dark:text-slate-400">Loading summary...</div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6">
        <p className="text-slate-600 dark:text-slate-400">
          Summary not available. Please complete the session first.
        </p>
      </div>
    );
  }

  // Calculate what needs most review
  const performanceByTag = summary.performanceByTag || {};
  const needsReview = Object.entries(performanceByTag)
    .filter(([, data]) => data && typeof data === 'object' && 'avgScore' in data && data.avgScore < 7)
    .sort(([, a], [, b]) => {
      // Sort by score (lowest first), then by count (more questions = higher priority)
      const aData = a as { avgScore: number; count: number };
      const bData = b as { avgScore: number; count: number };
      if (Math.abs(aData.avgScore - bData.avgScore) > 0.2) {
        return aData.avgScore - bData.avgScore;
      }
      return bData.count - aData.count;
    })
    .slice(0, 5);

  const handlePracticeWeakTopics = async () => {
    if (!summary) {
      alert('Summary data not loaded yet. Please wait...');
      return;
    }

    if (!bankId) {
      alert('Unable to create practice session: Question bank not found. Please try again or create a session manually.');
      console.error('bankId is null when trying to practice weak topics');
      return;
    }

    const weakTags = summary.weakTags.length > 0 
      ? summary.weakTags 
      : needsReview.map(([tag]) => tag);

    if (weakTags.length === 0) {
      alert('No weak topics identified. Great job!');
      return;
    }

    setCreatingSession(true);
    try {
      if (process.env.NODE_ENV === 'development') {
        console.log('Creating practice session with:', { bankId, filterTags: weakTags });
      }
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: `Practice: ${weakTags.slice(0, 3).join(', ')}${weakTags.length > 3 ? '...' : ''}`,
          bankId: bankId,
          filterTags: weakTags,
        }),
      });

      if (response.ok) {
        const session = await response.json();
        if (process.env.NODE_ENV === 'development') {
          console.log('Session created successfully:', session);
        }
        router.push(`/practice/session/${session.id}`);
      } else {
        const error = await response.json();
        console.error('Failed to create session:', error);
        alert(error.error || 'Failed to create practice session. ' + (error.details || ''));
      }
    } catch (error) {
      console.error('Error creating session:', error);
      alert('Failed to create practice session: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setCreatingSession(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg shadow p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Session Summary</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Analysis based on answers from this practice session only
        </p>
      </div>

      {summary.overallScore !== null && (
        <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Overall Score</div>
          <div className="text-3xl font-bold text-purple-600 dark:text-purple-400 mb-2">
            {summary.overallScore.toFixed(1)} / 10.0
          </div>
          {summary.overallScore < 7 && (needsReview.length > 0 || summary.weakTags.length > 0) && (
            <p className="text-sm text-purple-700 dark:text-purple-300">
              Focus on the topics below to improve your overall performance
            </p>
          )}
          {summary.overallScore < 7 && needsReview.length === 0 && summary.weakTags.length === 0 && (
            <p className="text-sm text-purple-700 dark:text-purple-300">
              Great job! Keep practicing to maintain your performance.
            </p>
          )}
        </div>
      )}

      {/* What to Review Next - Most Prominent */}
      {(needsReview.length > 0 || summary.weakTags.length > 0) && (
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-5 border-2 border-amber-200 dark:border-amber-800">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-lg font-bold text-amber-900 dark:text-amber-100">
              What to Review Next
            </h3>
            {bankId ? (
              <button
                onClick={handlePracticeWeakTopics}
                disabled={creatingSession}
                className="px-4 py-2 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 text-amber-800 dark:text-amber-200 rounded-lg text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                Practice Weak Topics
              </button>
            ) : (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Complete the session to practice weak topics
              </p>
            )}
          </div>
          {needsReview.length > 0 ? (
            <>
              <p className="text-sm text-amber-800 dark:text-amber-200 mb-4">
                These topics need the most attention based on your performance:
              </p>
              <div className="space-y-3">
                {needsReview.map(([tag, data], idx) => {
                  const reviewData = data as { avgScore: number; count: number };
                  return (
                  <div key={tag} className="bg-white dark:bg-slate-700 rounded-lg p-3 border border-amber-200 dark:border-amber-700">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">
                        {idx + 1}. {tag}
                      </span>
                      <span className={`text-sm font-medium ${
                        reviewData.avgScore < 5
                          ? 'text-red-600 dark:text-red-400'
                          : reviewData.avgScore < 6
                          ? 'text-orange-600 dark:text-orange-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}>
                        {reviewData.avgScore.toFixed(1)} / 10.0
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {reviewData.count} question{reviewData.count !== 1 ? 's' : ''} •
                      {reviewData.avgScore < 5 && ' Needs significant review'}
                      {reviewData.avgScore >= 5 && reviewData.avgScore < 6 && ' Needs practice'}
                      {reviewData.avgScore >= 6 && reviewData.avgScore < 7 && ' Could improve'}
                    </div>
                  </div>
                  );
                })}
              </div>
            </>
          ) : summary.weakTags.length > 0 ? (
            <p className="text-sm text-amber-800 dark:text-amber-200 mb-4">
              Focus on these weak areas: {summary.weakTags.join(', ')}
            </p>
          ) : null}
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

      {/* Frequently Forgotten Key Points */}
      {summary.frequentlyForgottenPoints && summary.frequentlyForgottenPoints.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
            🔑 Consistently Forgotten Key Points
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            These are key points you forgot to include multiple times. Focus on remembering these!
          </p>
          <ul className="space-y-3">
            {summary.frequentlyForgottenPoints.map((point, idx) => (
              <li key={idx} className="bg-amber-50 dark:bg-amber-900/30 rounded-lg p-4 border border-amber-200 dark:border-amber-800">
                <div className="flex items-start justify-between mb-2">
                  <div className="font-medium text-amber-900 dark:text-amber-100 flex-1">
                    {point.point}
                  </div>
                  <span className="text-xs bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 px-2 py-1 rounded ml-2">
                    {point.frequency}x
                  </span>
                </div>
                {point.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {point.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="text-xs bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Frequently Misused Terminology/Nomenclature */}
      {summary.frequentlyMisusedTerms && summary.frequentlyMisusedTerms.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
            📝 Frequently Misused Terminology
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            Terms you keep using incorrectly. Practice using the correct terminology!
          </p>
          <ul className="space-y-3">
            {summary.frequentlyMisusedTerms.map((term, idx) => (
              <li key={idx} className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="font-medium text-blue-900 dark:text-blue-100 mb-1">
                      <span className="line-through text-red-600 dark:text-red-400">{term.incorrectTerm}</span>
                      {' → '}
                      <span className="font-bold text-green-600 dark:text-green-400">{term.correctTerm}</span>
                    </div>
                    {term.examples.length > 0 && (
                      <div className="text-sm text-blue-700 dark:text-blue-300 mt-2 italic">
                        Example: {term.examples[0]}
                      </div>
                    )}
                  </div>
                  <span className="text-xs bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 px-2 py-1 rounded ml-2">
                    {term.frequency}x
                  </span>
                </div>
                {term.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {term.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Common Mistakes - Actionable */}
      {summary.commonMistakes.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
            Common Patterns to Watch
          </h3>
          <ul className="space-y-3">
            {summary.commonMistakes.map((mistake, idx) => (
              <li key={idx} className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 border border-red-200 dark:border-red-800">
                <div className="flex items-start justify-between mb-2">
                  <div className="font-medium text-red-900 dark:text-red-100">
                    {mistake.pattern}
                  </div>
                  <span className="text-xs bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200 px-2 py-1 rounded">
                    {mistake.frequency}x
                  </span>
                </div>
                {mistake.examples.length > 0 && (
                  <div className="text-sm text-red-700 dark:text-red-300 mt-2">
                    <span className="font-medium">Examples:</span> {mistake.examples.slice(0, 2).join(', ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Strong Areas - Positive Reinforcement */}
      {summary.strongTags.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Strong Areas ✨
          </h3>
          <div className="flex flex-wrap gap-2">
            {summary.strongTags.map((tag) => (
              <span
                key={tag}
                className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 px-3 py-1 rounded-full text-sm font-medium"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Performance by Topic - Full Breakdown */}
      {Object.keys(performanceByTag).length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
            Performance by Topic
          </h3>
          <div className="space-y-2">
            {Object.entries(performanceByTag)
              .filter(([, data]) => data && typeof data === 'object' && 'avgScore' in data)
              .sort(([, a], [, b]) => {
                const aData = a as { avgScore: number };
                const bData = b as { avgScore: number };
                return aData.avgScore - bData.avgScore;
              })
              .map(([tag, data]) => {
                const typedData = data as { avgScore: number; count: number };
                const isWeak = typedData.avgScore < 3;
                const isStrong = typedData.avgScore >= 4;
                return (
                  <div 
                    key={tag} 
                    className={`flex items-center justify-between rounded-lg p-3 ${
                      isWeak 
                        ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800' 
                        : isStrong
                        ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800'
                        : 'bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600'
                    }`}
                  >
                    <div className="flex-1">
                      <span className={`font-medium ${
                        isWeak 
                          ? 'text-red-900 dark:text-red-100' 
                          : isStrong
                          ? 'text-green-900 dark:text-green-100'
                          : 'text-gray-900 dark:text-gray-100'
                      }`}>
                        {tag}
                      </span>
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                        {typedData.count} question{typedData.count !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-24 bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${
                            isWeak 
                              ? 'bg-red-500' 
                              : isStrong
                              ? 'bg-green-500'
                              : 'bg-purple-500'
                          }`}
                          style={{ width: `${(typedData.avgScore / 10) * 100}%` }}
                        />
                      </div>
                      <span className={`font-semibold w-16 text-right ${
                        isWeak 
                          ? 'text-red-600 dark:text-red-400' 
                          : isStrong
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-gray-900 dark:text-gray-100'
                      }`}>
                        {typedData.avgScore.toFixed(1)} / 10.0
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
    </div>
  );
}

