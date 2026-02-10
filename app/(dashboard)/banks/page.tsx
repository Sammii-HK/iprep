'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { QUESTION_BANK_TEMPLATES } from '@/lib/templates';
import BankGrid, { type GridItem } from '@/components/banks/BankGrid';

interface ImportResult {
  filename: string;
  success: boolean;
  bankId?: string;
  title?: string;
  questionCount?: number;
  error?: string;
}

export default function BanksPage() {
  const [gridItems, setGridItems] = useState<GridItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [importTitle, setImportTitle] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importMode, setImportMode] = useState<'single' | 'bulk'>('single');
  const [importing, setImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [importingTemplateId, setImportingTemplateId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const fetchItems = useCallback(async () => {
    try {
      const response = await fetch('/api/banks?includeFolders=true');
      if (response.ok) {
        const data = await response.json();
        setGridItems(data.items);
      }
    } catch (error) {
      console.error('Error fetching items:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleImportTemplate = async (templateId: string) => {
    setImportingTemplateId(templateId);
    try {
      const response = await fetch('/api/banks/import-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId }),
      });

      if (response.ok) {
        const data = await response.json();
        alert(`Imported "${data.title}" with ${data.questionCount} questions!`);
        fetchItems();
      } else {
        const error = await response.json();
        alert(`Error: ${error.error}`);
      }
    } catch (error) {
      console.error('Error importing template:', error);
      alert('Failed to import template');
    } finally {
      setImportingTemplateId(null);
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
          fetchItems();
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
          fetchItems();
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

  return (
    <div className="px-4 py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Question Banks</h1>
        <button
          onClick={() => setShowImport(!showImport)}
          className="px-4 py-2 bg-purple-200 dark:bg-purple-800 hover:bg-purple-300 dark:hover:bg-purple-700 text-purple-800 dark:text-purple-200 rounded-lg transition-all font-medium"
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
                  ? 'bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200'
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
                  ? 'bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200'
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
                    className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
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
                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
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
                          <span className="font-medium text-purple-600 dark:text-purple-400 dark:text-purple-400">Click to upload</span> or drag and drop
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
                      ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
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
                        <span className="font-medium text-purple-600 dark:text-purple-400 dark:text-purple-400">Click to upload</span> or drag and drop multiple files
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
                className="px-4 py-2 bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200 rounded-lg hover:bg-purple-300 dark:hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importMode === 'bulk'
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

      {/* Starter Templates */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-3">Starter Templates</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          Get started quickly with pre-built question banks.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {QUESTION_BANK_TEMPLATES.map((template) => (
            <div
              key={template.id}
              className="bg-white dark:bg-slate-800 rounded-lg p-5 border border-slate-200 dark:border-slate-700"
            >
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
                {template.title}
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                {template.description}
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {template.questions.length} questions
                </span>
                <button
                  onClick={() => handleImportTemplate(template.id)}
                  disabled={importingTemplateId === template.id}
                  className="px-3 py-1.5 bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200 rounded-lg text-sm font-medium hover:bg-purple-300 dark:hover:bg-purple-700 transition-colors disabled:opacity-50"
                >
                  {importingTemplateId === template.id ? 'Importing...' : 'Add to My Banks'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bank Grid with folders */}
      {loading ? (
        <div className="text-center py-12">Loading...</div>
      ) : (
        <BankGrid initialItems={gridItems} />
      )}
    </div>
  );
}
