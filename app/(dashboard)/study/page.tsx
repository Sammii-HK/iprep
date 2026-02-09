"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface QuestionBank {
  id: string;
  title: string;
  _count: { questions: number };
}

export default function StudyPage() {
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBanks = useCallback(async () => {
    try {
      const res = await fetch("/api/banks");
      if (res.ok) {
        setBanks(await res.json());
      }
    } catch (error) {
      console.error("Error fetching banks:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBanks();
  }, [fetchBanks]);

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2 text-slate-900 dark:text-slate-100">Study Mode</h1>
        <p className="text-slate-600 dark:text-slate-400 text-lg">
          Flip through flashcards to study terms and concepts. Mark your confidence level for spaced repetition.
        </p>
      </div>

      {banks.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {banks.map((bank) => (
            <Link
              key={bank.id}
              href={`/study/${bank.id}`}
              className="block bg-white dark:bg-slate-800 rounded-lg p-6 border border-slate-200 dark:border-slate-700 hover:shadow-lg transition-shadow"
            >
              <h3 className="font-semibold text-lg text-slate-900 dark:text-slate-100 mb-2">
                {bank.title}
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {bank._count.questions} cards
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-lg p-8 border border-slate-200 dark:border-slate-700 text-center">
          <p className="text-slate-600 dark:text-slate-400 mb-4">
            No question banks yet. Import a CSV to get started.
          </p>
          <Link
            href="/banks"
            className="inline-block px-4 py-2 bg-purple-200 dark:bg-purple-800 hover:bg-purple-300 dark:hover:bg-purple-700 text-purple-800 dark:text-purple-200 rounded-lg transition-colors font-medium"
          >
            Go to Banks
          </Link>
        </div>
      )}
    </div>
  );
}
