'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface FolderBank {
  id: string;
  title: string;
  questionCount: number;
  order: number;
}

interface FolderViewProps {
  folder: {
    id: string;
    title: string;
    color: string | null;
    banks: FolderBank[];
  };
  onClose: () => void;
  onRemoveBank: (bankId: string) => void;
  onBankClick: (bankId: string) => void;
  onRename: (title: string) => void;
}

export default function FolderView({
  folder,
  onClose,
  onRemoveBank,
  onBankClick,
  onRename,
}: FolderViewProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(folder.title);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleRenameSave = useCallback(() => {
    const trimmed = renameTitle.trim();
    if (trimmed && trimmed !== folder.title) {
      onRename(trimmed);
    }
    setIsRenaming(false);
  }, [renameTitle, folder.title, onRename]);

  const handleRenameCancel = useCallback(() => {
    setIsRenaming(false);
    setRenameTitle(folder.title);
  }, [folder.title]);

  const handleRemoveConfirm = useCallback(
    (bankId: string) => {
      onRemoveBank(bankId);
      setRemovingId(null);
    },
    [onRemoveBank],
  );

  const folderAccent = folder.color || '#8b5cf6';

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Slide-up panel */}
      <motion.div
        initial={{ y: '100%', opacity: 0.5 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] bg-white dark:bg-slate-900 rounded-t-2xl shadow-2xl flex flex-col"
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
        </div>

        {/* Header */}
        <div className="px-5 pb-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Folder icon */}
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: folderAccent + '30' }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke={folderAccent}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
            </div>

            {isRenaming ? (
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <input
                  type="text"
                  value={renameTitle}
                  onChange={(e) => setRenameTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameSave();
                    if (e.key === 'Escape') handleRenameCancel();
                  }}
                  className="flex-1 min-w-0 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-base focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  autoFocus
                />
                <button
                  onClick={handleRenameSave}
                  className="px-2 py-1 bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200 rounded text-sm hover:bg-purple-300 dark:hover:bg-purple-700 transition-colors flex-shrink-0"
                >
                  Save
                </button>
                <button
                  onClick={handleRenameCancel}
                  className="px-2 py-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded text-sm hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors flex-shrink-0"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <h2
                className="text-lg font-semibold text-slate-900 dark:text-slate-100 truncate cursor-pointer"
                onDoubleClick={() => {
                  setIsRenaming(true);
                  setRenameTitle(folder.title);
                }}
                title="Double-click to rename"
              >
                {folder.title}
              </h2>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
            {!isRenaming && (
              <button
                onClick={() => {
                  setIsRenaming(true);
                  setRenameTitle(folder.title);
                }}
                className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
                title="Rename folder"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              aria-label="Close folder"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Bank count subtitle */}
        <div className="px-5 py-2 text-sm text-slate-500 dark:text-slate-400">
          {folder.banks.length} bank{folder.banks.length !== 1 ? 's' : ''}
        </div>

        {/* Bank list */}
        <div className="flex-1 overflow-y-auto px-5 pb-6">
          {folder.banks.length === 0 ? (
            <div className="text-center py-8 text-slate-500 dark:text-slate-400">
              <p className="text-sm">This folder is empty.</p>
              <p className="text-xs mt-1">
                Drag a bank onto this folder to add it.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <AnimatePresence mode="popLayout">
                {folder.banks.map((bank) => (
                  <motion.div
                    key={bank.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.2 }}
                    className="relative group bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => onBankClick(bank.id)}
                  >
                    {/* Remove from folder button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRemovingId(bank.id);
                      }}
                      className="absolute -top-1.5 -right-1.5 z-10 w-5 h-5 rounded-full bg-slate-400 dark:bg-slate-500 text-white flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                      title="Remove from folder"
                    >
                      <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="2" y1="2" x2="8" y2="8" />
                        <line x1="8" y1="2" x2="2" y2="8" />
                      </svg>
                    </button>

                    <h4 className="text-sm font-medium text-slate-900 dark:text-slate-100 line-clamp-2">
                      {bank.title}
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {bank.questionCount} question{bank.questionCount !== 1 ? 's' : ''}
                    </p>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </motion.div>

      {/* Remove confirmation dialog */}
      <AnimatePresence>
        {removingId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-60 flex items-center justify-center"
          >
            <div className="absolute inset-0 bg-black/30" onClick={() => setRemovingId(null)} />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-white dark:bg-slate-800 rounded-xl shadow-xl p-5 max-w-sm w-full mx-4 border border-slate-200 dark:border-slate-700"
            >
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Remove from folder?
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                The bank will be moved back to the top level. It will not be deleted.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setRemovingId(null)}
                  className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg text-sm hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleRemoveConfirm(removingId)}
                  className="px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-sm hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                >
                  Remove
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatePresence>
  );
}
