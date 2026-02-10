'use client';

import { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';

interface BankCardProps {
  bank: {
    id: string;
    title: string;
    questionCount: number;
    createdAt: string;
  };
  editMode: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  onDelete: () => void;
  onEdit: (title: string) => void;
  onClick: () => void;
  onLongPress?: () => void;
  onDragStart?: (e: React.PointerEvent) => void;
}

export default function BankCard({
  bank,
  editMode,
  isDragging,
  isDropTarget,
  onDelete,
  onEdit,
  onClick,
  onLongPress,
  onDragStart,
}: BankCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(bank.title);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressRef = useRef(false);
  const startPos = useRef<{ x: number; y: number } | null>(null);

  // Randomize jiggle delay so cards don't animate in sync
  // Use a stable hash of the bank id to derive a deterministic delay
  const [jiggleDelay] = useState(() => {
    let hash = 0;
    for (let i = 0; i < bank.id.length; i++) {
      hash = (hash * 31 + bank.id.charCodeAt(i)) | 0;
    }
    return (Math.abs(hash) % 200) / 1000;
  });

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isEditing) return;

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
    [editMode, isEditing, onLongPress, onDragStart],
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
    if (isLongPressRef.current || isEditing) return;
    if (editMode) return; // In edit mode, taps don't navigate
    onClick();
  }, [editMode, isEditing, onClick]);

  const handleEditSave = useCallback(() => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== bank.title) {
      onEdit(trimmed);
    }
    setIsEditing(false);
    setEditTitle(bank.title);
  }, [editTitle, bank.title, onEdit]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
    setEditTitle(bank.title);
  }, [bank.title]);

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
        bg-white dark:bg-slate-800
        border-slate-200 dark:border-slate-700
        transition-all duration-150
        ${isDragging ? 'opacity-40 scale-95' : ''}
        ${
          isDropTarget
            ? 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-300 dark:ring-blue-600 scale-105'
            : ''
        }
        ${!editMode && !isDragging ? 'hover:shadow-md cursor-pointer' : ''}
        ${editMode ? 'cursor-grab active:cursor-grabbing' : ''}
      `}
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
          aria-label="Delete bank"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="2" y1="2" x2="8" y2="8" />
            <line x1="8" y1="2" x2="2" y2="8" />
          </svg>
        </button>
      )}

      {isEditing ? (
        <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleEditSave();
              if (e.key === 'Escape') handleEditCancel();
            }}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleEditSave}
              className="px-3 py-1 bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200 rounded text-sm hover:bg-purple-300 dark:hover:bg-purple-700 transition-colors"
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
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-1 line-clamp-2">
            {bank.title}
          </h3>
          <p className="text-slate-600 dark:text-slate-400 text-sm">
            {bank.questionCount} question{bank.questionCount !== 1 ? 's' : ''}
          </p>
          <p className="text-slate-500 dark:text-slate-500 text-xs mt-1.5">
            {new Date(bank.createdAt).toLocaleDateString()}
          </p>

          {/* Inline edit button visible on hover when NOT in edit mode */}
          {!editMode && (
            <div className="flex gap-2 mt-3 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                  setEditTitle(bank.title);
                }}
                className="px-3 py-1 bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200 rounded text-sm hover:bg-purple-300 dark:hover:bg-purple-700 transition-colors"
              >
                Edit
              </button>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
