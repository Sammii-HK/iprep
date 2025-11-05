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

    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: newSessionTitle,
          bankId: selectedBankId || undefined,
        }),
      });

      if (response.ok) {
        const session = await response.json();
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
      <h1 className="text-3xl font-bold mb-6">Practice</h1>

      {showNewSession ? (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Create New Session</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Session Title</label>
              <input
                type="text"
                value={newSessionTitle}
                onChange={(e) => setNewSessionTitle(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder="e.g., Technical Interview Practice"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Question Bank (Optional)</label>
              <select
                value={selectedBankId}
                onChange={(e) => setSelectedBankId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="">None</option>
                {banks.map((bank) => (
                  <option key={bank.id} value={bank.id}>
                    {bank.title} ({bank._count.questions} questions)
                  </option>
                ))}
              </select>
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
                }}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowNewSession(true)}
          className="mb-6 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          New Practice Session
        </button>
      )}

      {sessions.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Recent Sessions</h2>
          <div className="space-y-2">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="bg-white rounded-lg shadow-md p-4 hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => router.push(`/practice/session/${session.id}`)}
              >
                <h3 className="font-semibold">{session.title}</h3>
                <p className="text-sm text-gray-500">
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
