'use client';

import { useEffect, useState, useCallback } from 'react';
import { TrendChart } from '@/components/TrendChart';
import { NotificationSettings } from '@/components/NotificationSettings';

interface AnalyticsData {
  avgWPM: number;
  avgFillerRate: number;
  avgConfidence: number;
  avgIntonation: number;
  avgStar: number;
  avgImpact: number;
  avgClarity: number;
  weakestTags: string[];
  trends: {
    wpm: Array<{ date: string; value: number }>;
    fillerRate: Array<{ date: string; value: number }>;
  };
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(30);

  const fetchAnalytics = useCallback(async () => {
    try {
      const response = await fetch(`/api/analytics/summary?range=${range}`);
      if (response.ok) {
        const analyticsData = await response.json();
        setData(analyticsData);
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  if (!data) {
    return <div className="text-center py-12">No analytics data available</div>;
  }

  return (
    <div className="px-4 py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Analytics</h1>
        <select
          value={range}
          onChange={(e) => setRange(parseInt(e.target.value))}
          className="px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {/* Notification Settings */}
      <div className="mb-6">
        <NotificationSettings />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
          <div className="text-sm text-slate-600 dark:text-slate-400 mb-1">Avg WPM</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{data.avgWPM}</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
          <div className="text-sm text-slate-600 dark:text-slate-400 mb-1">Filler Rate</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{data.avgFillerRate.toFixed(1)}%</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
          <div className="text-sm text-slate-600 dark:text-slate-400 mb-1">Avg Confidence</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{data.avgConfidence.toFixed(1)}/10</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
          <div className="text-sm text-slate-600 dark:text-slate-400 mb-1">Avg Intonation</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{data.avgIntonation.toFixed(1)}/10</div>
        </div>
      </div>

      {/* Content Scores */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
          <div className="text-sm text-slate-600 dark:text-slate-400 mb-1">Avg STAR</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{data.avgStar.toFixed(1)}/10</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
          <div className="text-sm text-slate-600 dark:text-slate-400 mb-1">Avg Impact</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{data.avgImpact.toFixed(1)}/10</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
          <div className="text-sm text-slate-600 dark:text-slate-400 mb-1">Avg Clarity</div>
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{data.avgClarity.toFixed(1)}/10</div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold mb-4 text-slate-900 dark:text-slate-100">WPM Trend</h3>
          <TrendChart data={data.trends.wpm} label="WPM" color="#3b82f6" />
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold mb-4 text-slate-900 dark:text-slate-100">Filler Rate Trend</h3>
          <TrendChart data={data.trends.fillerRate} label="Filler Rate %" color="#ef4444" />
        </div>
      </div>

      {/* Weakness Tags */}
      {data.weakestTags.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold mb-4 text-slate-900 dark:text-slate-100">Areas for Improvement</h3>
          <div className="flex flex-wrap gap-2">
            {data.weakestTags.map((tag) => (
              <span
                key={tag}
                className="px-3 py-1 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 rounded-full text-sm"
              >
                {tag}
              </span>
            ))}
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-4">
            Focus on practicing questions with these tags to improve your overall performance.
          </p>
        </div>
      )}
    </div>
  );
}
