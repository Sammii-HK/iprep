'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Question {
  id: string;
  text: string;
  hint?: string | null;
  tags: string[];
  difficulty: number;
}

interface Bank {
  id: string;
  title: string;
  questions: Question[];
}

export default function BankDetailPage() {
  const params = useParams();
  const bankId = params.id as string;
  const [bank, setBank] = useState<Bank | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchBank = async () => {
    try {
      const response = await fetch(`/api/banks/${bankId}`);
      if (response.ok) {
        const data = await response.json();
        setBank(data);
      }
    } catch (error) {
      console.error('Error fetching bank:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (bankId) {
      fetchBank();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankId]);

  if (loading) {
    return <div className="text-center py-12 text-slate-900 dark:text-slate-100">Loading...</div>;
  }

  if (!bank) {
    return <div className="text-center py-12 text-slate-900 dark:text-slate-100">Bank not found</div>;
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <Link
          href="/banks"
          className="text-blue-500 dark:text-blue-400 hover:underline mb-4 inline-block"
        >
          ← Back to Banks
        </Link>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">{bank.title}</h1>
        <p className="text-slate-700 dark:text-slate-300 mt-2">
          {bank.questions.length} questions
        </p>
      </div>

      <div className="space-y-4">
        {bank.questions.map((question) => (
          <div
            key={question.id}
            className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 border border-slate-200 dark:border-slate-700"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded text-xs font-semibold">
                  Difficulty: {question.difficulty}/5
                </span>
                {question.tags.length > 0 && question.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <p className="text-lg text-slate-900 dark:text-slate-100 mb-3">{question.text}</p>
            {question.hint && (
              <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  <strong className="font-semibold text-slate-900 dark:text-slate-100">Answer/Hint:</strong>{' '}
                  <span className="whitespace-pre-wrap">{question.hint}</span>
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
