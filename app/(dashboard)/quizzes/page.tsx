'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Quiz {
  id: string;
  title: string;
  description: string | null;
  type: 'SPOKEN' | 'WRITTEN';
  bankId: string | null;
  createdAt: string;
  bank?: {
    _count: {
      questions: number;
    };
  };
  _count: {
    attempts: number;
  };
}

interface QuestionBank {
  id: string;
  title: string;
  _count: {
    questions: number;
  };
}

export default function QuizzesPage() {
  const router = useRouter();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateQuiz, setShowCreateQuiz] = useState(false);
  const [quizTitle, setQuizTitle] = useState('');
  const [quizDescription, setQuizDescription] = useState('');
  const [quizType, setQuizType] = useState<'SPOKEN' | 'WRITTEN'>('SPOKEN');
  const [selectedBankId, setSelectedBankId] = useState<string>('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [quizzesRes, banksRes] = await Promise.all([
        fetch('/api/quizzes'),
        fetch('/api/banks'),
      ]);

      if (quizzesRes.ok) {
        const quizzesData = await quizzesRes.json();
        setQuizzes(quizzesData);
      }

      if (banksRes.ok) {
        const banksData = await banksRes.json();
        setBanks(banksData);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const createQuiz = async () => {
    if (!quizTitle.trim()) {
      alert('Please enter a quiz title');
      return;
    }

    if (!selectedBankId) {
      alert('Please select a question bank');
      return;
    }

    try {
      const response = await fetch('/api/quizzes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: quizTitle,
          description: quizDescription,
          type: quizType,
          bankId: selectedBankId,
        }),
      });

      if (response.ok) {
        const quiz = await response.json();
        router.push(`/quizzes/${quiz.id}`);
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error creating quiz:', error);
      alert('Failed to create quiz');
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <div className="px-4 py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Quizzes</h1>
        <button
          onClick={() => setShowCreateQuiz(!showCreateQuiz)}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          Create Quiz
        </button>
      </div>

      {showCreateQuiz && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Create New Quiz</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Quiz Title</label>
              <input
                type="text"
                value={quizTitle}
                onChange={(e) => setQuizTitle(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder="e.g., Technical Interview Quiz"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Description (Optional)</label>
              <textarea
                value={quizDescription}
                onChange={(e) => setQuizDescription(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                rows={3}
                placeholder="Describe the quiz..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Quiz Type</label>
              <select
                value={quizType}
                onChange={(e) => setQuizType(e.target.value as 'SPOKEN' | 'WRITTEN')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="SPOKEN">Spoken (Voice Recording)</option>
                <option value="WRITTEN">Written (Text Answer)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Question Bank</label>
              <select
                value={selectedBankId}
                onChange={(e) => setSelectedBankId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="">Select a question bank...</option>
                {banks.map((bank) => (
                  <option key={bank.id} value={bank.id}>
                    {bank.title} ({bank._count.questions} questions)
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={createQuiz}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                Create Quiz
              </button>
              <button
                onClick={() => {
                  setShowCreateQuiz(false);
                  setQuizTitle('');
                  setQuizDescription('');
                  setSelectedBankId('');
                }}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {quizzes.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No quizzes yet. Create one to get started!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {quizzes.map((quiz) => (
            <Link
              key={quiz.id}
              href={`/quizzes/${quiz.id}`}
              className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-xl font-semibold">{quiz.title}</h3>
                <span
                  className={`px-2 py-1 rounded text-xs font-semibold ${
                    quiz.type === 'SPOKEN'
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-green-100 text-green-800'
                  }`}
                >
                  {quiz.type}
                </span>
              </div>
              {quiz.description && (
                <p className="text-gray-600 text-sm mb-3">{quiz.description}</p>
              )}
              <div className="flex items-center gap-4 text-sm text-gray-500">
                <span>
                  {quiz.bank?._count.questions || 0} questions
                </span>
                <span>{quiz._count.attempts} attempts</span>
              </div>
              <p className="text-gray-400 text-xs mt-2">
                Created {new Date(quiz.createdAt).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
