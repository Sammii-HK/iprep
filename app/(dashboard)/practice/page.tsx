'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface QuestionBank {
  id: string;
  title: string;
  _count: {
    questions: number;
  };
}

interface Session {
  id: string;
  title: string;
  createdAt: string;
}

export default function PracticePage() {
  const router = useRouter();
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewSession, setShowNewSession] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [maxQuestions, setMaxQuestions] = useState<number>(0); // 0 means "all"

  useEffect(() => {
    fetchData();
  }, []);  

  const fetchData = async () => {
    try {
      const [banksRes, sessionsRes] = await Promise.all([
        fetch('/api/banks'),
        fetch('/api/sessions'),
      ]);

      if (banksRes.ok) {
        const banksData = await banksRes.json();
        setBanks(banksData);
      }

      if (sessionsRes.ok) {
        const sessionsData = await sessionsRes.json();
        setSessions(sessionsData);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const createSession = async () => {
    if (!newSessionTitle.trim()) {
      alert('Please enter a session title');
      return;
    }

    if (!selectedBankId) {
      alert('Please select a question bank');
      return;
    }

    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: newSessionTitle,
          bankId: selectedBankId,
          maxQuestions: maxQuestions > 0 ? maxQuestions : undefined,
        }),
      });

      if (response.ok) {
        const session = await response.json();
        // Store maxQuestions for this session in localStorage (store even if 0/all to distinguish from undefined)
        localStorage.setItem(`session_${session.id}_maxQuestions`, (maxQuestions || 0).toString());
        router.push(`/practice/session/${session.id}`);
      } else {
        alert('Failed to create session');
      }
    } catch (error) {
      console.error('Error creating session:', error);
      alert('Failed to create session');
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Practice</h1>
        <p className="text-slate-600 dark:text-slate-400 text-lg">
          Free-form practice sessions where you can retry questions, view previous attempts, and improve through repetition. Perfect for learning and skill development.
        </p>
      </div>

      {showNewSession ? (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 mb-6 border border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">Create New Session</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">Session Title</label>
              <input
                type="text"
                value={newSessionTitle}
                onChange={(e) => setNewSessionTitle(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400"
                placeholder="e.g., Technical Interview Practice"
              />
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
                      setNewSessionTitle(selectedBank.title);
                      setMaxQuestions(selectedBank._count.questions); // Default to all questions
                    }
                  } else {
                    setNewSessionTitle('');
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
                onClick={createSession}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                Start Session
              </button>
              <button
                onClick={() => {
                  setShowNewSession(false);
                  setNewSessionTitle('');
                  setSelectedBankId('');
                  setMaxQuestions(0);
                }}
                className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-6">
          <button
            onClick={() => setShowNewSession(true)}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            New Practice Session
          </button>
          <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <p className="text-sm text-slate-700 dark:text-slate-300">
              <strong className="font-semibold">Practice Mode:</strong> Retry questions multiple times, view all your previous attempts, and navigate freely between questions. Great for learning and improvement.
            </p>
          </div>
        </div>
      )}

      {sessions.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">Recent Sessions</h2>
          <div className="space-y-2">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-4 hover:shadow-lg transition-shadow cursor-pointer border border-slate-200 dark:border-slate-700"
                onClick={() => router.push(`/practice/session/${session.id}`)}
              >
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">{session.title}</h3>
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  {new Date(session.createdAt).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
