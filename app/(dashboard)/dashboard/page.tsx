"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface RecentSession {
  id: string;
  title: string;
  createdAt: string;
  isCompleted: boolean;
  completedAt: string | null;
  itemCount: number;
  bankId: string | null;
}

interface QuestionBank {
  id: string;
  title: string;
  _count: { questions: number };
}

interface DashboardStats {
  totalSessions: number;
  completedSessions: number;
  totalAnswers: number;
  recentSessions: RecentSession[];
  banks: QuestionBank[];
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboardData = useCallback(async () => {
    try {
      const [sessionsRes, banksRes] = await Promise.all([
        fetch("/api/sessions"),
        fetch("/api/banks"),
      ]);

      const sessions: RecentSession[] = sessionsRes.ok
        ? await sessionsRes.json()
        : [];
      const banks: QuestionBank[] = banksRes.ok ? await banksRes.json() : [];

      setStats({
        totalSessions: sessions.length,
        completedSessions: sessions.filter((s) => s.isCompleted).length,
        totalAnswers: sessions.reduce((sum, s) => sum + (s.itemCount || 0), 0),
        recentSessions: sessions.slice(0, 5),
        banks,
      });
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  if (loading) {
    return (
      <div className="px-4 py-6">
        <div className="text-center py-12 text-slate-600 dark:text-slate-400">
          Loading dashboard...
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
          Dashboard
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mt-1">
          Your practice overview and quick actions
        </p>
      </div>

      {/* Quick Start */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Link
          href="/practice"
          className="p-4 bg-purple-50 dark:bg-purple-900/20 border-2 border-purple-200 dark:border-purple-800 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
        >
          <div className="text-sm font-semibold text-purple-800 dark:text-purple-200">
            Practice
          </div>
          <div className="text-xs text-purple-600 dark:text-purple-400 mt-1">
            Start a practice session
          </div>
        </Link>
        <Link
          href="/quizzes"
          className="p-4 bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
        >
          <div className="text-sm font-semibold text-blue-800 dark:text-blue-200">
            Quizzes
          </div>
          <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
            Test your knowledge
          </div>
        </Link>
        <Link
          href="/banks"
          className="p-4 bg-green-50 dark:bg-green-900/20 border-2 border-green-200 dark:border-green-800 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
        >
          <div className="text-sm font-semibold text-green-800 dark:text-green-200">
            Question Banks
          </div>
          <div className="text-xs text-green-600 dark:text-green-400 mt-1">
            Manage your questions
          </div>
        </Link>
        <Link
          href="/analytics"
          className="p-4 bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
        >
          <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">
            Analytics
          </div>
          <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            View your progress
          </div>
        </Link>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {stats?.totalSessions || 0}
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-400">
            Sessions
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {stats?.completedSessions || 0}
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-400">
            Completed
          </div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {stats?.totalAnswers || 0}
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-400">
            Answers
          </div>
        </div>
      </div>

      {/* Recent Sessions */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Recent Sessions
          </h2>
          <Link
            href="/practice"
            className="text-sm text-purple-600 dark:text-purple-400 hover:underline"
          >
            View all
          </Link>
        </div>
        {stats?.recentSessions && stats.recentSessions.length > 0 ? (
          <div className="space-y-2">
            {stats.recentSessions.map((session) => (
              <Link
                key={session.id}
                href={`/practice/session/${session.id}`}
                className="block bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-900 dark:text-slate-100">
                      {session.title}
                    </div>
                    <div className="text-sm text-slate-600 dark:text-slate-400">
                      {new Date(session.createdAt).toLocaleDateString()} &middot;{" "}
                      {session.itemCount} {session.itemCount === 1 ? "answer" : "answers"}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      session.isCompleted
                        ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300"
                        : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300"
                    }`}
                  >
                    {session.isCompleted ? "Completed" : "In Progress"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="bg-white dark:bg-slate-800 rounded-lg p-8 border border-slate-200 dark:border-slate-700 text-center">
            <p className="text-slate-600 dark:text-slate-400 mb-4">
              No sessions yet. Start practicing to see your progress here.
            </p>
            <Link
              href="/practice"
              className="inline-block px-4 py-2 bg-purple-200 dark:bg-purple-800 hover:bg-purple-300 dark:hover:bg-purple-700 text-purple-800 dark:text-purple-200 rounded-lg transition-colors font-medium"
            >
              Start Practicing
            </Link>
          </div>
        )}
      </div>

      {/* Question Banks */}
      {stats?.banks && stats.banks.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              Your Question Banks
            </h2>
            <Link
              href="/banks"
              className="text-sm text-purple-600 dark:text-purple-400 hover:underline"
            >
              Manage
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {stats.banks.slice(0, 6).map((bank) => (
              <div
                key={bank.id}
                className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700"
              >
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  {bank.title}
                </div>
                <div className="text-sm text-slate-600 dark:text-slate-400">
                  {bank._count.questions} questions
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
