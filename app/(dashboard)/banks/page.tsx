'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';

interface QuestionBank {
  id: string;
  title: string;
  createdAt: string;
  _count: {
    questions: number;
  };
}

interface ImportResult {
  filename: string;
  success: boolean;
  bankId?: string;
  title?: string;
  questionCount?: number;
  error?: string;
}

export default function BanksPage() {
  const [banks, setBanks] = useState<QuestionBank[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [importTitle, setImportTitle] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importMode, setImportMode] = useState<'single' | 'bulk'>('single');
  const [importing, setImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [editingBankId, setEditingBankId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [deletingBankId, setDeletingBankId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

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

  // Extract filename without extension for auto-title
  const getFileNameWithoutExt = (filename: string): string => {
    return filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
  };

  const handleFileSelect = (file: File | null) => {
    if (!file) return;
    
    setImportFile(file);
    
    // Auto-populate title from filename if title is empty
    if (!importTitle.trim()) {
      const autoTitle = getFileNameWithoutExt(file.name);
      setImportTitle(autoTitle);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const validFiles = files.filter(
      (file) => file.name.endsWith('.csv') || file.name.endsWith('.json')
    );

    if (validFiles.length === 0) {
      alert('Please drop CSV or JSON files');
      return;
    }

    if (importMode === 'bulk') {
      setImportFiles(validFiles);
      // Auto-populate titles from filenames
      if (validFiles.length > 0 && !importTitle.trim()) {
        // Don't set title for bulk mode - each file gets its own title from filename
      }
    } else {
      // Single file mode
      if (validFiles.length > 0) {
        handleFileSelect(validFiles[0]);
      }
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();

    if (importMode === 'bulk') {
      // Bulk import mode
      if (importFiles.length === 0) {
        alert('Please select at least one file');
        return;
      }

      setImporting(true);
      try {
        const formData = new FormData();
        importFiles.forEach((file) => {
          formData.append('files', file);
        });

        const response = await fetch('/api/banks/bulk-import', {
          method: 'POST',
          body: formData,
        });

        if (response.ok) {
          const data = await response.json();
          const successCount = data.summary.successful;
          const failureCount = data.summary.failed;
          
          let message = `Successfully imported ${successCount} bank(s)!`;
          if (failureCount > 0) {
            message += `\n\n${failureCount} file(s) failed:\n`;
            data.results
              .filter((r: { success: boolean }) => !r.success)
              .forEach((r: ImportResult) => {
                message += `- ${r.filename}: ${r.error}\n`;
              });
          }
          
          alert(message);
          setShowImport(false);
          setImportFiles([]);
          setImportTitle('');
          fetchBanks();
        } else {
          const error = await response.json();
          alert(`Error: ${error.error}`);
        }
      } catch (error) {
        console.error('Error importing:', error);
        alert('Failed to import banks');
      } finally {
        setImporting(false);
      }
    } else {
      // Single file mode
      if (!importFile || !importTitle.trim()) {
        alert('Please provide a title and file');
        return;
      }

      setImporting(true);
      try {
        const formData = new FormData();
        formData.append('title', importTitle.trim());
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
    }
  };

  const handleEditStart = (e: React.MouseEvent, bank: QuestionBank) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingBankId(bank.id);
    setEditingTitle(bank.title);
  };

  const handleEditSave = async (bankId: string) => {
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
        setEditingBankId(null);
        setEditingTitle('');
        fetchBanks();
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
    setEditingBankId(null);
    setEditingTitle('');
  };

  const handleDeleteClick = (e: React.MouseEvent, bankId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDeletingBankId(bankId);
  };

  const handleDeleteConfirm = async (bankId: string) => {
    try {
      const response = await fetch(`/api/banks/${bankId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setDeletingBankId(null);
        fetchBanks();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error deleting bank:', error);
      alert('Failed to delete bank');
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
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 mb-6 border border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">Import Question Bank(s)</h2>
          
          {/* Import Mode Toggle */}
          <div className="mb-4 flex gap-4">
            <button
              type="button"
              onClick={() => {
                setImportMode('single');
                setImportFiles([]);
                setImportFile(null);
                setImportTitle('');
                if (fileInputRef.current) {
                  fileInputRef.current.value = '';
                }
              }}
              className={`px-4 py-2 rounded-lg transition-colors ${
                importMode === 'single'
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100'
              }`}
            >
              Single File
            </button>
            <button
              type="button"
              onClick={() => {
                setImportMode('bulk');
                setImportFile(null);
                setImportTitle('');
                if (fileInputRef.current) {
                  fileInputRef.current.value = '';
                }
              }}
              className={`px-4 py-2 rounded-lg transition-colors ${
                importMode === 'bulk'
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100'
              }`}
            >
              Bulk Import
            </button>
          </div>

          <form onSubmit={handleImport}>
            {importMode === 'single' ? (
              <>
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">Bank Title</label>
                  <input
                    type="text"
                    value={importTitle}
                    onChange={(e) => setImportTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g., Software Engineering Interviews"
                    required
                  />
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    Title is auto-filled from filename, but you can edit it
                  </p>
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">CSV/JSON File</label>
                  
                  {/* Drag and Drop Zone */}
                  <div
                    ref={dropZoneRef}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                      isDragging
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : importFile
                        ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                        : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                    }`}
                  >
                    {importFile ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-center">
                          <svg className="w-12 h-12 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <p className="font-medium text-slate-900 dark:text-slate-100">{importFile.name}</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          {(importFile.size / 1024).toFixed(2)} KB
                        </p>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setImportFile(null);
                            setImportTitle('');
                            if (fileInputRef.current) {
                              fileInputRef.current.value = '';
                            }
                          }}
                          className="text-sm text-red-500 hover:text-red-700 mt-2"
                        >
                          Remove file
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-center">
                          <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                        </div>
                        <p className="text-slate-700 dark:text-slate-300">
                          <span className="font-medium text-blue-600 dark:text-blue-400">Click to upload</span> or drag and drop
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">CSV or JSON files only</p>
                      </div>
                    )}
                  </div>

                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.json"
                    onChange={(e) => handleFileSelect(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                </div>
              </>
            ) : (
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2 text-slate-900 dark:text-slate-100">
                  CSV/JSON Files (Multiple)
                </label>
                
                {/* Drag and Drop Zone for Multiple Files */}
                <div
                  ref={dropZoneRef}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                    isDragging
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : importFiles.length > 0
                      ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                  }`}
                >
                  {importFiles.length > 0 ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-center">
                        <svg className="w-12 h-12 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <p className="font-medium text-slate-900 dark:text-slate-100">
                        {importFiles.length} file(s) selected
                      </p>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {importFiles.map((file, idx) => (
                          <div key={idx} className="text-sm text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded px-2 py-1">
                            {file.name} ({(file.size / 1024).toFixed(2)} KB)
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setImportFiles([]);
                          if (fileInputRef.current) {
                            fileInputRef.current.value = '';
                          }
                        }}
                        className="text-sm text-red-500 hover:text-red-700 mt-2"
                      >
                        Clear all files
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-center">
                        <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                      </div>
                      <p className="text-slate-700 dark:text-slate-300">
                        <span className="font-medium text-blue-600 dark:text-blue-400">Click to upload</span> or drag and drop multiple files
                      </p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">CSV or JSON files only. Each file becomes a separate bank.</p>
                    </div>
                  )}
                </div>

                {/* Hidden file input with multiple support */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.json"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    setImportFiles(files);
                  }}
                  className="hidden"
                />
              </div>
            )}

            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              CSV format: front,back (front = question, back = optional - can be empty)
              {importMode === 'bulk' && ' Each file will be named automatically from its filename.'}
            </p>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={
                  importing ||
                  (importMode === 'single' && (!importFile || !importTitle.trim())) ||
                  (importMode === 'bulk' && importFiles.length === 0)
                }
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing
                  ? importMode === 'bulk'
                    ? `Importing ${importFiles.length} file(s)...`
                    : 'Importing...'
                  : importMode === 'bulk'
                  ? `Import ${importFiles.length} Bank(s)`
                  : 'Import'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowImport(false);
                  setImportTitle('');
                  setImportFile(null);
                  setImportFiles([]);
                  setIsDragging(false);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                }}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
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
        <div className="text-center py-12 text-slate-600 dark:text-slate-400">
          No question banks yet. Import one to get started!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {banks.map((bank) => (
            <div
              key={bank.id}
              className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow border border-slate-200 dark:border-slate-700 relative group"
            >
              {editingBankId === bank.id ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleEditSave(bank.id);
                      } else if (e.key === 'Escape') {
                        handleEditCancel();
                      }
                    }}
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEditSave(bank.id)}
                      className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={handleEditCancel}
                      className="px-3 py-1 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded text-sm hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <Link
                    href={`/banks/${bank.id}`}
                    className="block mb-2"
                  >
                    <h3 className="text-xl font-semibold mb-2 text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                      {bank.title}
                    </h3>
                  </Link>
                  <p className="text-slate-700 dark:text-slate-300 text-sm">
                    {bank._count.questions} questions
                  </p>
                  <p className="text-slate-600 dark:text-slate-400 text-xs mt-2">
                    Created {new Date(bank.createdAt).toLocaleDateString()}
                  </p>
                  <div className="flex gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => handleEditStart(e, bank)}
                      className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 transition-colors"
                      title="Edit bank name"
                    >
                      Edit
                    </button>
                    <button
                      onClick={(e) => handleDeleteClick(e, bank.id)}
                      className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors"
                      title="Delete bank"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingBankId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4 border border-slate-200 dark:border-slate-700">
            <h3 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">Delete Question Bank?</h3>
            <p className="text-slate-700 dark:text-slate-300 mb-6">
              Are you sure you want to delete this question bank? This will also delete all questions, quizzes, and sessions associated with it. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeletingBankId(null)}
                className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteConfirm(deletingBankId)}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
