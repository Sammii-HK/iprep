'use client';

import { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';

interface FolderBank {
  id: string;
  title: string;
  questionCount: number;
  order: number;
}

interface FolderCardProps {
  folder: {
    id: string;
    title: string;
    color: string | null;
    banks: FolderBank[];
  };
  editMode: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  onDelete: () => void;
  onRename: (title: string) => void;
  onClick: () => void;
  onLongPress?: () => void;
  onDragStart?: (e: React.PointerEvent) => void;
}

export default function FolderCard({
  folder,
  editMode,
  isDragging,
  isDropTarget,
  onDelete,
  onRename,
  onClick,
  onLongPress,
  onDragStart,
}: FolderCardProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(folder.title);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const startPos = useRef<{ x: number; y: number } | null>(null);

  // Deterministic jiggle delay from folder id so cards don't animate in sync
  const [jiggleDelay] = useState(() => {
    let hash = 0;
    for (let i = 0; i < folder.id.length; i++) {
      hash = (hash * 31 + folder.id.charCodeAt(i)) | 0;
    }
    return (Math.abs(hash) % 200) / 1000;
  });

  const previewBanks = folder.banks.slice(0, 4);
  const totalQuestions = folder.banks.reduce((sum, b) => sum + b.questionCount, 0);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isRenaming) return;

      isLongPressRef.current = false;
      startPos.current = { x: e.clientX, y: e.clientY };

      if (!editMode && onLongPress) {
        longPressTimer.current = setTimeout(() => {
          isLongPressRef.current = true;
          onLongPress();
        }, 500);
      }

      if (editMode && onDragStart) {
        onDragStart(e);
      }
    },
    [editMode, isRenaming, onLongPress, onDragStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startPos.current) return;
      const dx = e.clientX - startPos.current.x;
      const dy = e.clientY - startPos.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > 10) {
        clearLongPress();
      }
    },
    [clearLongPress],
  );

  const handlePointerUp = useCallback(() => {
    clearLongPress();
  }, [clearLongPress]);

  const handleClick = useCallback(() => {
    if (isLongPressRef.current || isRenaming) return;
    if (editMode) return;
    onClick();
  }, [editMode, isRenaming, onClick]);

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

  const folderBg = folder.color
    ? { backgroundColor: folder.color + '20' }
    : undefined;

  return (
    <motion.div
      layout
      animate={
        editMode && !isDragging
          ? { rotate: [0, -1, 1, -1, 0] }
          : { rotate: 0 }
      }
      transition={
        editMode && !isDragging
          ? {
              duration: 0.3,
              repeat: Infinity,
              repeatDelay: 0.1,
              delay: jiggleDelay,
            }
          : { duration: 0.2 }
      }
      className={`
        relative rounded-xl border p-4 shadow-sm select-none
        bg-slate-100 dark:bg-slate-800
        border-slate-200 dark:border-slate-700
        transition-all duration-150
        ${isDragging ? 'opacity-40 scale-95' : ''}
        ${
          isDropTarget
            ? 'border-purple-500 dark:border-purple-400 ring-2 ring-purple-300 dark:ring-purple-600 shadow-lg shadow-purple-200 dark:shadow-purple-900/40 scale-105'
            : ''
        }
        ${!editMode && !isDragging ? 'hover:shadow-md cursor-pointer' : ''}
        ${editMode ? 'cursor-grab active:cursor-grabbing' : ''}
      `}
      style={folderBg}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onClick={handleClick}
    >
      {/* Delete badge */}
      {editMode && !isDragging && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute -top-2 -right-2 z-10 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center text-xs font-bold shadow-md hover:bg-red-600 transition-colors"
          aria-label="Delete folder"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="2" y1="2" x2="8" y2="8" />
            <line x1="8" y1="2" x2="2" y2="8" />
          </svg>
        </button>
      )}

      {/* 2x2 mini bank preview grid */}
      <div className="grid grid-cols-2 gap-1.5 mb-3">
        {[0, 1, 2, 3].map((i) => {
          const preview = previewBanks[i];
          return (
            <div
              key={i}
              className={`
                aspect-square rounded-lg flex items-center justify-center p-1.5 text-center
                ${
                  preview
                    ? 'bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600'
                    : 'bg-slate-200/50 dark:bg-slate-700/50'
                }
              `}
            >
              {preview && (
                <span className="text-[10px] leading-tight text-slate-600 dark:text-slate-400 line-clamp-3">
                  {preview.title}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Folder title and count */}
      {isRenaming ? (
        <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSave();
              if (e.key === 'Escape') handleRenameCancel();
            }}
            className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            autoFocus
          />
          <div className="flex gap-1">
            <button
              onClick={handleRenameSave}
              className="px-2 py-0.5 bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200 rounded text-xs hover:bg-purple-300 dark:hover:bg-purple-700 transition-colors"
            >
              Save
            </button>
            <button
              onClick={handleRenameCancel}
              className="px-2 py-0.5 bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-300 rounded text-xs hover:bg-slate-300 dark:hover:bg-slate-500 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <h3
            className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsRenaming(true);
              setRenameTitle(folder.title);
            }}
          >
            {folder.title}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {folder.banks.length} bank{folder.banks.length !== 1 ? 's' : ''}
            {' -- '}
            {totalQuestions} question{totalQuestions !== 1 ? 's' : ''}
          </p>
        </div>
      )}
    </motion.div>
  );
}
