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

interface StudyProgress {
  currentStreak: number;
  longestStreak: number;
  dailyGoal: number;
  dailyProgress: number;
  interviewDate: string | null;
  daysUntilInterview: number | null;
  reviewDueCount: number;
  dailyQuota: number | null;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [study, setStudy] = useState<StudyProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [editingDate, setEditingDate] = useState(false);
  const [dateInput, setDateInput] = useState("");

  const fetchDashboardData = useCallback(async () => {
    try {
      const [sessionsRes, banksRes, progressRes] = await Promise.all([
        fetch("/api/sessions"),
        fetch("/api/banks"),
        fetch("/api/user/progress"),
      ]);

      const sessions: RecentSession[] = sessionsRes.ok ? await sessionsRes.json() : [];
      const banks: QuestionBank[] = banksRes.ok ? await banksRes.json() : [];
      const progress: StudyProgress = progressRes.ok ? await progressRes.json() : null;

      setStats({
        totalSessions: sessions.length,
        completedSessions: sessions.filter((s) => s.isCompleted).length,
        totalAnswers: sessions.reduce((sum, s) => sum + (s.itemCount || 0), 0),
        recentSessions: sessions.slice(0, 5),
        banks,
      });
      setStudy(progress);
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const saveGoal = async () => {
    const goal = parseInt(goalInput, 10);
    if (!goal || goal < 1) return;
    await fetch("/api/user/progress", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailyGoal: goal }),
    });
    setEditingGoal(false);
    fetchDashboardData();
  };

  const saveDate = async () => {
    await fetch("/api/user/progress", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interviewDate: dateInput || null }),
    });
    setEditingDate(false);
    fetchDashboardData();
  };

  if (loading) {
    return (
      <div className="px-4 py-6">
        <div className="text-center py-12 text-slate-600 dark:text-slate-400">
          Loading dashboard...
        </div>
      </div>
    );
  }

  const goalPct = study
    ? Math.min(100, Math.round((study.dailyProgress / study.dailyGoal) * 100))
    : 0;
  const goalMet = goalPct >= 100;

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

      {/* ── Study Hub ─────────────────────────────────────────── */}
      {study && (
        <div className="mb-8 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Study Hub
            </h2>
            {study.reviewDueCount > 0 && (
              <Link
                href="/review"
                className="text-sm font-medium px-3 py-1.5 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
              >
                {study.reviewDueCount} due for review
              </Link>
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Streak */}
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {study.currentStreak}
                <span className="text-lg ml-1">🔥</span>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                day streak
              </div>
              {study.longestStreak > 0 && (
                <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                  best: {study.longestStreak}
                </div>
              )}
            </div>

            {/* Daily goal */}
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4">
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {study.dailyProgress}
                </span>
                <span className="text-slate-400 dark:text-slate-500 text-sm">
                  / {study.dailyGoal}
                </span>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                today&apos;s goal
              </div>
              <div className="mt-2 h-1.5 bg-slate-200 dark:bg-slate-600 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    goalMet
                      ? "bg-green-500"
                      : "bg-purple-500"
                  }`}
                  style={{ width: `${goalPct}%` }}
                />
              </div>
              {editingGoal ? (
                <div className="flex gap-1 mt-2">
                  <input
                    type="number"
                    value={goalInput}
                    onChange={(e) => setGoalInput(e.target.value)}
                    className="w-16 text-xs border border-slate-300 dark:border-slate-600 rounded px-1 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    placeholder={String(study.dailyGoal)}
                    onKeyDown={(e) => e.key === "Enter" && saveGoal()}
                  />
                  <button onClick={saveGoal} className="text-xs text-purple-600 dark:text-purple-400">save</button>
                  <button onClick={() => setEditingGoal(false)} className="text-xs text-slate-400">cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => { setGoalInput(String(study.dailyGoal)); setEditingGoal(true); }}
                  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 mt-1"
                >
                  set goal
                </button>
              )}
            </div>

            {/* Interview countdown */}
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4">
              {study.daysUntilInterview !== null ? (
                <>
                  <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                    {study.daysUntilInterview}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    days to interview
                  </div>
                  {study.dailyQuota !== null && (
                    <div className="text-xs text-amber-600 dark:text-amber-400 mt-1 font-medium">
                      ~{study.dailyQuota} Qs/day needed
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="text-slate-400 dark:text-slate-500 text-sm">No date set</div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">interview date</div>
                </>
              )}
              {editingDate ? (
                <div className="flex flex-col gap-1 mt-2">
                  <input
                    type="date"
                    value={dateInput}
                    onChange={(e) => setDateInput(e.target.value)}
                    className="text-xs border border-slate-300 dark:border-slate-600 rounded px-1 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                  <div className="flex gap-1">
                    <button onClick={saveDate} className="text-xs text-purple-600 dark:text-purple-400">save</button>
                    <button onClick={() => setEditingDate(false)} className="text-xs text-slate-400">cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setDateInput(study.interviewDate ? study.interviewDate.split("T")[0] : "");
                    setEditingDate(true);
                  }}
                  className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 mt-1"
                >
                  {study.interviewDate ? "change date" : "set date"}
                </button>
              )}
            </div>

            {/* SRS review */}
            <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4">
              <div className={`text-2xl font-bold ${study.reviewDueCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>
                {study.reviewDueCount}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                due for review
              </div>
              {study.reviewDueCount > 0 ? (
                <Link
                  href="/review"
                  className="mt-2 block text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline"
                >
                  Review now
                </Link>
              ) : (
                <div className="text-xs text-green-600 dark:text-green-400 mt-1">All caught up!</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Quick Start ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <Link
          href="/practice"
          className="p-4 bg-purple-50 dark:bg-purple-900/20 border-2 border-purple-200 dark:border-purple-800 rounded-lg hover:bg-purple-100 dark:hover:bg-purple-900/30 transition-colors"
        >
          <div className="text-sm font-semibold text-purple-800 dark:text-purple-200">Practice</div>
          <div className="text-xs text-purple-600 dark:text-purple-400 mt-1">Record answers</div>
        </Link>
        <Link
          href="/review"
          className="p-4 bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-200 dark:border-amber-800 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
        >
          <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">Review Queue</div>
          <div className="text-xs text-amber-600 dark:text-amber-400 mt-1">Spaced repetition</div>
        </Link>
        <Link
          href="/quizzes"
          className="p-4 bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
        >
          <div className="text-sm font-semibold text-blue-800 dark:text-blue-200">Quizzes</div>
          <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">Test knowledge</div>
        </Link>
        <Link
          href="/banks"
          className="p-4 bg-green-50 dark:bg-green-900/20 border-2 border-green-200 dark:border-green-800 rounded-lg hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
        >
          <div className="text-sm font-semibold text-green-800 dark:text-green-200">Banks</div>
          <div className="text-xs text-green-600 dark:text-green-400 mt-1">Manage questions</div>
        </Link>
        <Link
          href="/analytics"
          className="p-4 bg-slate-50 dark:bg-slate-700/50 border-2 border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">Analytics</div>
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">View progress</div>
        </Link>
      </div>

      {/* ── Stats Overview ────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {stats?.totalSessions || 0}
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-400">Sessions</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {stats?.completedSessions || 0}
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-400">Completed</div>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {stats?.totalAnswers || 0}
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-400">Answers</div>
        </div>
      </div>

      {/* ── Recent Sessions ───────────────────────────────────── */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Recent Sessions
          </h2>
          <Link href="/practice" className="text-sm text-purple-600 dark:text-purple-400 hover:underline">
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

      {/* ── Question Banks ────────────────────────────────────── */}
      {stats?.banks && stats.banks.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              Your Question Banks
            </h2>
            <Link href="/banks" className="text-sm text-purple-600 dark:text-purple-400 hover:underline">
              Manage
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {stats.banks.slice(0, 6).map((bank) => (
              <div
                key={bank.id}
                className="bg-white dark:bg-slate-800 rounded-lg p-4 border border-slate-200 dark:border-slate-700"
              >
                <div className="font-medium text-slate-900 dark:text-slate-100">{bank.title}</div>
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
