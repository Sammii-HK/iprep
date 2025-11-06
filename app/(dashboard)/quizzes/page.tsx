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
  const [maxQuestions, setMaxQuestions] = useState<number>(0); // 0 means "all"

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
      alert('Please select a question bank. Quizzes must be built from a CSV question bank.');
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
          maxQuestions: maxQuestions > 0 ? maxQuestions : undefined, // undefined means "all"
        }),
      });

      if (response.ok) {
        const quiz = await response.json();
        // Store maxQuestions for this quiz in localStorage (store even if 0/all to distinguish from undefined)
        localStorage.setItem(`quiz_${quiz.id}_maxQuestions`, (maxQuestions || 0).toString());
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
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 mb-6 border border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">Create New Quiz</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">Quiz Title</label>
              <input
                type="text"
                value={quizTitle}
                onChange={(e) => setQuizTitle(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400"
                placeholder="e.g., Technical Interview Quiz"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">Description (Optional)</label>
              <textarea
                value={quizDescription}
                onChange={(e) => setQuizDescription(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400"
                rows={3}
                placeholder="Describe the quiz..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">Quiz Type</label>
              <select
                value={quizType}
                onChange={(e) => setQuizType(e.target.value as 'SPOKEN' | 'WRITTEN')}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
              >
                <option value="SPOKEN">Spoken (Voice Recording)</option>
                <option value="WRITTEN">Written (Text Answer)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">
                Question Bank <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedBankId}
                onChange={(e) => {
                  const bankId = e.target.value;
                  setSelectedBankId(bankId);
                  // Auto-populate title and maxQuestions from selected bank
                  if (bankId) {
                    const selectedBank = banks.find(b => b.id === bankId);
                    if (selectedBank) {
                      setQuizTitle(selectedBank.title);
                      setMaxQuestions(selectedBank._count.questions); // Default to all questions
                    }
                  } else {
                    setQuizTitle('');
                    setMaxQuestions(0);
                  }
                }}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                required
              >
                <option value="">Select a question bank...</option>
                {banks.map((bank) => (
                  <option key={bank.id} value={bank.id}>
                    {bank.title} ({bank._count.questions} questions)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">
                Max Questions
              </label>
              <input
                type="number"
                value={maxQuestions || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setMaxQuestions(value === '' ? 0 : parseInt(value) || 0);
                }}
                min="1"
                max={selectedBankId ? banks.find(b => b.id === selectedBankId)?._count.questions || 50 : 50}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                placeholder="All"
              />
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                {selectedBankId ? (
                  <>Leave empty or set to {banks.find(b => b.id === selectedBankId)?._count.questions || 0} to use all questions</>
                ) : (
                  <>Limit number of questions (leave empty for all)</>
                )}
              </p>
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
                  setMaxQuestions(0);
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
        <div className="text-center py-12 text-slate-600 dark:text-slate-400">
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
                <p className="text-slate-700 dark:text-slate-300 text-sm mb-3">{quiz.description}</p>
              )}
              <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
                <span>
                  {quiz.bank?._count.questions || 0} questions
                </span>
                <span>{quiz._count.attempts} attempts</span>
              </div>
              <p className="text-slate-600 dark:text-slate-400 text-xs mt-2">
                Created {new Date(quiz.createdAt).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
