'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface QuestionBank {
  id: string;
  title: string;
  createdAt: string;
  _count: {
    questions: number;
  };
}

export default function BanksPage() {
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [importTitle, setImportTitle] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    fetchBanks();
  }, []);

  const fetchBanks = async () => {
    try {
      const response = await fetch('/api/banks');
      if (response.ok) {
        const data = await response.json();
        setBanks(data);
      }
    } catch (error) {
      console.error('Error fetching banks:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFile || !importTitle.trim()) {
      alert('Please provide a title and file');
      return;
    }

    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('title', importTitle);
      formData.append('file', importFile);

      const response = await fetch('/api/banks/import', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        alert(`Successfully imported ${data.questionCount} questions!`);
        setShowImport(false);
        setImportTitle('');
        setImportFile(null);
        fetchBanks();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error importing:', error);
      alert('Failed to import bank');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="px-4 py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Question Banks</h1>
        <button
          onClick={() => setShowImport(!showImport)}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
        >
          Import Bank
        </button>
      </div>

      {showImport && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Import Question Bank</h2>
          <form onSubmit={handleImport}>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Bank Title</label>
              <input
                type="text"
                value={importTitle}
                onChange={(e) => setImportTitle(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder="e.g., Software Engineering Interviews"
                required
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">CSV/JSON File</label>
              <input
                type="file"
                accept=".csv,.json"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                required
              />
              <p className="text-sm text-gray-500 mt-1">
                CSV format: text,tags,difficulty (tags comma-separated)
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={importing}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                {importing ? 'Importing...' : 'Import'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowImport(false);
                  setImportTitle('');
                  setImportFile(null);
                }}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12">Loading...</div>
      ) : banks.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No question banks yet. Import one to get started!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {banks.map((bank) => (
            <Link
              key={bank.id}
              href={`/banks/${bank.id}`}
              className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow"
            >
              <h3 className="text-xl font-semibold mb-2">{bank.title}</h3>
              <p className="text-gray-600 text-sm">
                {bank._count.questions} questions
              </p>
              <p className="text-gray-400 text-xs mt-2">
                Created {new Date(bank.createdAt).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
