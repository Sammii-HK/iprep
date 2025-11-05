'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Question {
  id: string;
  text: string;
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

  useEffect(() => {
    if (bankId) {
      fetchBank();
    }
  }, [bankId]);

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

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  if (!bank) {
    return <div className="text-center py-12">Bank not found</div>;
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <Link
          href="/banks"
          className="text-blue-500 hover:underline mb-4 inline-block"
        >
          ← Back to Banks
        </Link>
        <h1 className="text-3xl font-bold">{bank.title}</h1>
        <p className="text-gray-600 mt-2">
          {bank.questions.length} questions
        </p>
      </div>

      <div className="space-y-4">
        {bank.questions.map((question) => (
          <div
            key={question.id}
            className="bg-white rounded-lg shadow-md p-6"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-semibold">
                  Difficulty: {question.difficulty}/5
                </span>
                {question.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <p className="text-lg">{question.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
