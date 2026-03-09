"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface ReviewItem {
  questionId: string;
  questionText: string;
  questionHint: string | null;
  tags: string[];
  difficulty: number;
  bankTitle: string;
  lastScore: number | null;
  daysOverdue: number;
}

export default function ReviewPage() {
  const [queue, setQueue] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [mode, setMode] = useState<"list" | "flashcard">("list");

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/study/review?limit=50");
      if (res.ok) {
        const data = await res.json();
        setQueue(data.queue);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  const current = queue[currentIndex];

  const next = () => {
    setRevealed(false);
    if (currentIndex < queue.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      setCurrentIndex(0);
    }
  };

  const scoreColor = (score: number | null) => {
    if (score === null) return "text-slate-400 dark:text-slate-500";
    if (score >= 7) return "text-green-600 dark:text-green-400";
    if (score >= 5) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
  };

  const difficultyLabel = (d: number) =>
    ["", "Easy", "Easy-Med", "Medium", "Med-Hard", "Hard"][d] ?? "?";

  if (loading) {
    return (
      <div className="px-4 py-6 text-center text-slate-600 dark:text-slate-400">
        Loading review queue...
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="px-4 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Review Queue</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">Spaced repetition — revisit what needs work</p>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-12 text-center">
          <div className="text-5xl mb-4">✓</div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">All caught up!</h2>
          <p className="text-slate-600 dark:text-slate-400 mb-6">
            No questions are due for review. Keep practising to build your review queue.
          </p>
          <Link
            href="/practice"
            className="inline-block px-5 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
          >
            Start Practising
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Review Queue</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-1">
            {queue.length} question{queue.length !== 1 ? "s" : ""} due for review
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setMode("list")}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              mode === "list"
                ? "bg-purple-600 text-white"
                : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
            }`}
          >
            List
          </button>
          <button
            onClick={() => { setMode("flashcard"); setCurrentIndex(0); setRevealed(false); }}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              mode === "flashcard"
                ? "bg-purple-600 text-white"
                : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300"
            }`}
          >
            Flashcard
          </button>
        </div>
      </div>

      {/* ── Flashcard mode ───────────────────────────────────── */}
      {mode === "flashcard" && current && (
        <div className="max-w-2xl mx-auto">
          <div className="text-sm text-slate-500 dark:text-slate-400 mb-3 text-center">
            {currentIndex + 1} / {queue.length}
          </div>

          {/* Card */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-8 min-h-64 flex flex-col">
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <span className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 rounded">
                {current.bankTitle}
              </span>
              <span className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded">
                {difficultyLabel(current.difficulty)}
              </span>
              {current.lastScore !== null && (
                <span className={`text-xs font-medium ${scoreColor(current.lastScore)}`}>
                  Last: {current.lastScore}/10
                </span>
              )}
              {current.daysOverdue > 0 && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  {current.daysOverdue}d overdue
                </span>
              )}
            </div>

            <p className="text-lg font-medium text-slate-900 dark:text-slate-100 leading-relaxed flex-1">
              {current.questionText}
            </p>

            {current.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-4">
                {current.tags.map((tag) => (
                  <span key={tag} className="text-xs px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Reveal hint */}
            {current.questionHint && (
              <div className="mt-6">
                {revealed ? (
                  <div className="bg-slate-50 dark:bg-slate-700/50 rounded-lg p-4 border border-slate-200 dark:border-slate-600">
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                      Key Points
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">
                      {current.questionHint}
                    </p>
                  </div>
                ) : (
                  <button
                    onClick={() => setRevealed(true)}
                    className="w-full py-2 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500 transition-colors"
                  >
                    Reveal answer
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-4">
            <Link
              href={`/practice`}
              className="flex-1 py-2.5 text-center bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
            >
              Practise this question
            </Link>
            <button
              onClick={next}
              className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors text-sm font-medium"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ── List mode ────────────────────────────────────────── */}
      {mode === "list" && (
        <div className="space-y-3">
          {queue.map((item) => (
            <div
              key={item.questionId}
              className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 leading-snug">
                    {item.questionText}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">{item.bankTitle}</span>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{difficultyLabel(item.difficulty)}</span>
                    {item.lastScore !== null && (
                      <>
                        <span className="text-xs text-slate-400">·</span>
                        <span className={`text-xs font-medium ${scoreColor(item.lastScore)}`}>
                          Last score: {item.lastScore}/10
                        </span>
                      </>
                    )}
                    {item.daysOverdue > 0 && (
                      <>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                          {item.daysOverdue}d overdue
                        </span>
                      </>
                    )}
                  </div>
                  {item.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {item.tags.map((tag) => (
                        <span key={tag} className="text-xs px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <Link
                  href="/practice"
                  className="shrink-0 px-3 py-1.5 text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-lg hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors"
                >
                  Practise
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
