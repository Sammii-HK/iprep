'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { BankSummary } from '@/components/BankSummary';

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
  const [isEditing, setIsEditing] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const router = useRouter();

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

  const handleEditStart = () => {
    if (bank) {
      setIsEditing(true);
      setEditingTitle(bank.title);
    }
  };

  const handleEditSave = async () => {
    if (!editingTitle.trim()) {
      alert('Title cannot be empty');
      return;
    }

    try {
      const response = await fetch(`/api/banks/${bankId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: editingTitle.trim() }),
      });

      if (response.ok) {
        setIsEditing(false);
        fetchBank();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error updating bank:', error);
      alert('Failed to update bank');
    }
  };

  const handleEditCancel = () => {
    setIsEditing(false);
    setEditingTitle('');
  };

  const handleDelete = async () => {
    try {
      const response = await fetch(`/api/banks/${bankId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        router.push('/banks');
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error deleting bank:', error);
      alert('Failed to delete bank');
    }
  };

  const handleStartPractice = async () => {
    if (!bank) return;

    setIsCreatingSession(true);
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: bank.title,
          bankId: bank.id,
        }),
      });

      if (response.ok) {
        const session = await response.json();
        router.push(`/practice/session/${session.id}`);
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to create practice session');
      }
    } catch (error) {
      console.error('Error creating session:', error);
      alert('Failed to create practice session');
    } finally {
      setIsCreatingSession(false);
    }
  };

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
          className="text-purple-500 dark:text-purple-400 hover:underline mb-4 inline-block"
        >
          ← Back to Banks
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex-1">
            {isEditing ? (
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleEditSave();
                    } else if (e.key === 'Escape') {
                      handleEditCancel();
                    }
                  }}
                  className="text-3xl font-bold px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  autoFocus
                />
                <button
                  onClick={handleEditSave}
                  className="px-4 py-2 bg-purple-200 dark:bg-purple-800 text-white rounded-lg hover:bg-purple-300 dark:hover:bg-purple-700 transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={handleEditCancel}
                  className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">{bank.title}</h1>
                <p className="text-slate-700 dark:text-slate-300 mt-2">
                  {bank.questions.length} questions
                </p>
              </>
            )}
          </div>
          {!isEditing && (
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleStartPractice}
                disabled={isCreatingSession}
                className="px-6 py-2 bg-purple-200 dark:bg-purple-800 text-white rounded-lg hover:bg-purple-300 dark:hover:bg-purple-700 disabled:bg-purple-300 dark:bg-purple-700 transition-colors font-semibold"
              >
                {isCreatingSession ? 'Creating...' : '🎤 Start Practice'}
              </button>
              <button
                onClick={() => setShowSummary(!showSummary)}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
              >
                {showSummary ? 'Hide' : 'View'} Practice Summary
              </button>
              <button
                onClick={handleEditStart}
                className="px-4 py-2 bg-slate-500 text-white rounded-lg hover:bg-slate-600 transition-colors"
              >
                Edit Name
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                Delete Bank
              </button>
            </div>
          )}
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4 border border-slate-200 dark:border-slate-700">
            <h3 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">Delete Question Bank?</h3>
            <p className="text-slate-700 dark:text-slate-300 mb-6">
              Are you sure you want to delete this question bank? This will also delete all questions, quizzes, and sessions associated with it. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showSummary && (
        <div className="mb-6">
          <BankSummary bankId={bankId} />
        </div>
      )}

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
                    className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-xs"
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
