'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';

import BankCard from './BankCard';
import FolderCard from './FolderCard';
import FolderView from './FolderView';
import { useBankDragDrop, type DropResult } from '@/hooks/useBankDragDrop';

// ----- Types -----

export interface BankItem {
  type: 'bank';
  id: string;
  title: string;
  order: number;
  questionCount: number;
  createdAt: string;
}

export interface FolderItem {
  type: 'folder';
  id: string;
  title: string;
  color: string | null;
  order: number;
  banks: Array<{
    id: string;
    title: string;
    questionCount: number;
    order: number;
  }>;
}

export type GridItem = BankItem | FolderItem;

interface BankGridProps {
  initialItems: GridItem[];
}

// ----- Component -----

export default function BankGrid({ initialItems }: BankGridProps) {
  const router = useRouter();
  const [items, setItems] = useState<GridItem[]>(initialItems);
  const [editMode, setEditMode] = useState(false);
  const [openFolder, setOpenFolder] = useState<FolderItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<{ id: string; type: 'bank' | 'folder' } | null>(null);
  const [folderNamePrompt, setFolderNamePrompt] = useState<{ bankId1: string; bankId2: string } | null>(null);
  const [folderName, setFolderName] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);

  // Refresh from server
  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/banks?includeFolders=true');
      if (res.ok) {
        const data = await res.json();
        setItems(data.items);
      }
    } catch (err) {
      console.error('Failed to fetch items:', err);
    }
  }, []);

  // Sync when initialItems changes (e.g. after import)
  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  // ------ Drop handler ------

  const handleDrop = useCallback(
    (result: NonNullable<DropResult>) => {
      switch (result.kind) {
        case 'bank-on-bank': {
          // Prompt for folder name, then create folder
          setFolderNamePrompt({ bankId1: result.dragId, bankId2: result.targetId });
          setFolderName('New Folder');
          break;
        }
        case 'bank-on-folder': {
          // Add bank to folder via API
          (async () => {
            try {
              const res = await fetch(`/api/folders/${result.folderId}/banks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bankId: result.bankId }),
              });
              if (res.ok) {
                await fetchItems();
              } else {
                const err = await res.json();
                alert(`Error: ${err.error}`);
              }
            } catch (err) {
              console.error('Failed to add bank to folder:', err);
            }
          })();
          break;
        }
        case 'reorder': {
          // Simple reorder -- swap order values
          const dragIdx = items.findIndex((it) => it.id === result.dragItem.id);
          const targetIdx = items.findIndex((it) => it.id === result.targetItem.id);
          if (dragIdx === -1 || targetIdx === -1) return;

          const newItems = [...items];
          const [moved] = newItems.splice(dragIdx, 1);
          newItems.splice(targetIdx, 0, moved);

          // Reassign order values
          const reordered = newItems.map((item, i) => ({ ...item, order: i }));
          setItems(reordered);

          // Persist
          (async () => {
            try {
              await fetch('/api/banks/reorder', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  items: reordered.map((it) => ({
                    id: it.id,
                    type: it.type,
                    order: it.order,
                  })),
                }),
              });
            } catch (err) {
              console.error('Failed to reorder:', err);
              await fetchItems(); // rollback
            }
          })();
          break;
        }
      }
    },
    [items, fetchItems],
  );

  const {
    dragItem,
    overlay,
    dropTarget,
    startDrag,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    registerTarget,
    isDragging,
  } = useBankDragDrop({ onDrop: handleDrop });

  // ------ Create folder from two banks ------

  const handleCreateFolder = useCallback(async () => {
    if (!folderNamePrompt) return;
    const name = folderName.trim() || 'New Folder';

    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: name,
          bankIds: [folderNamePrompt.bankId1, folderNamePrompt.bankId2],
        }),
      });

      if (res.ok) {
        await fetchItems();
      } else {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      }
    } catch (err) {
      console.error('Failed to create folder:', err);
    } finally {
      setFolderNamePrompt(null);
      setFolderName('');
    }
  }, [folderNamePrompt, folderName, fetchItems]);

  // ------ Delete bank or folder ------

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingItem) return;

    try {
      const url =
        deletingItem.type === 'bank'
          ? `/api/banks/${deletingItem.id}`
          : `/api/folders/${deletingItem.id}`;

      const res = await fetch(url, { method: 'DELETE' });
      if (res.ok) {
        await fetchItems();
      } else {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      }
    } catch (err) {
      console.error('Failed to delete:', err);
    } finally {
      setDeletingItem(null);
    }
  }, [deletingItem, fetchItems]);

  // ------ Edit bank title ------

  const handleEditBank = useCallback(
    async (bankId: string, title: string) => {
      try {
        const res = await fetch(`/api/banks/${bankId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        });
        if (res.ok) {
          await fetchItems();
        } else {
          const err = await res.json();
          alert(`Error: ${err.error}`);
        }
      } catch (err) {
        console.error('Failed to edit bank:', err);
      }
    },
    [fetchItems],
  );

  // ------ Rename folder ------

  const handleRenameFolder = useCallback(
    async (folderId: string, title: string) => {
      try {
        const res = await fetch(`/api/folders/${folderId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        });
        if (res.ok) {
          await fetchItems();
          // Update the open folder view if it's the same folder
          if (openFolder && openFolder.id === folderId) {
            setOpenFolder((prev) => (prev ? { ...prev, title } : null));
          }
        } else {
          const err = await res.json();
          alert(`Error: ${err.error}`);
        }
      } catch (err) {
        console.error('Failed to rename folder:', err);
      }
    },
    [fetchItems, openFolder],
  );

  // ------ Remove bank from folder ------

  const handleRemoveBankFromFolder = useCallback(
    async (folderId: string, bankId: string) => {
      try {
        const res = await fetch(`/api/folders/${folderId}/banks/${bankId}`, {
          method: 'DELETE',
        });
        if (res.ok) {
          await fetchItems();
          // Update open folder view
          if (openFolder && openFolder.id === folderId) {
            setOpenFolder((prev) =>
              prev
                ? { ...prev, banks: prev.banks.filter((b) => b.id !== bankId) }
                : null,
            );
          }
        } else {
          const err = await res.json();
          alert(`Error: ${err.error}`);
        }
      } catch (err) {
        console.error('Failed to remove bank from folder:', err);
      }
    },
    [fetchItems, openFolder],
  );

  // ------ Enter edit mode via long press ------

  const enterEditMode = useCallback(() => {
    setEditMode(true);
  }, []);

  // ------ Navigate to bank ------

  const navigateToBank = useCallback(
    (bankId: string) => {
      router.push(`/banks/${bankId}`);
    },
    [router],
  );

  // ------ Render ------

  const sortedItems = [...items].sort((a, b) => a.order - b.order);

  return (
    <>
      {/* Edit mode bar */}
      <AnimatePresence>
        {editMode && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex items-center justify-between bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl px-4 py-2.5 mb-4"
          >
            <span className="text-sm text-purple-700 dark:text-purple-300 font-medium">
              Edit mode -- drag to reorder, tap X to delete
            </span>
            <button
              onClick={() => setEditMode(false)}
              className="px-4 py-1.5 bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200 rounded-lg text-sm font-medium hover:bg-purple-300 dark:hover:bg-purple-700 transition-colors"
            >
              Done
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {items.length === 0 ? (
        <div className="text-center py-12 text-slate-600 dark:text-slate-400">
          No question banks yet. Import one to get started!
        </div>
      ) : (
        <div
          ref={gridRef}
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
          style={{ touchAction: isDragging ? 'none' : 'auto' }}
        >
          <LayoutGroup>
            {sortedItems.map((item) => {
              if (item.type === 'bank') {
                return (
                  <div
                    key={item.id}
                    className="group"
                    ref={(el) => registerTarget(item.id, 'bank', el)}
                  >
                    <BankCard
                      bank={{
                        id: item.id,
                        title: item.title,
                        questionCount: item.questionCount,
                        createdAt: item.createdAt,
                      }}
                      editMode={editMode}
                      isDragging={dragItem?.id === item.id}
                      isDropTarget={dropTarget?.id === item.id}
                      onDelete={() => setDeletingItem({ id: item.id, type: 'bank' })}
                      onEdit={(title) => handleEditBank(item.id, title)}
                      onClick={() => navigateToBank(item.id)}
                      onLongPress={enterEditMode}
                      onDragStart={(e) => startDrag({ id: item.id, type: 'bank' }, e)}
                    />
                  </div>
                );
              }

              // Folder
              return (
                <div
                  key={item.id}
                  className="group"
                  ref={(el) => registerTarget(item.id, 'folder', el)}
                >
                  <FolderCard
                    folder={{
                      id: item.id,
                      title: item.title,
                      color: item.color,
                      banks: item.banks,
                    }}
                    editMode={editMode}
                    isDragging={dragItem?.id === item.id}
                    isDropTarget={dropTarget?.id === item.id}
                    onDelete={() => setDeletingItem({ id: item.id, type: 'folder' })}
                    onRename={(title) => handleRenameFolder(item.id, title)}
                    onClick={() => setOpenFolder(item)}
                    onLongPress={enterEditMode}
                    onDragStart={(e) => startDrag({ id: item.id, type: 'folder' }, e)}
                  />
                </div>
              );
            })}
          </LayoutGroup>
        </div>
      )}

      {/* Drag overlay -- semi-transparent clone that follows the pointer */}
      {isDragging && overlay && dragItem && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: overlay.x - 60,
            top: overlay.y - 40,
          }}
        >
          <div className="w-[120px] h-[80px] rounded-xl bg-purple-200 dark:bg-purple-800 border-2 border-purple-400 dark:border-purple-600 opacity-70 shadow-xl flex items-center justify-center">
            <span className="text-xs text-purple-800 dark:text-purple-200 font-medium truncate px-2">
              {(() => {
                const found = items.find((it) => it.id === dragItem.id);
                return found ? found.title : '';
              })()}
            </span>
          </div>
        </div>
      )}

      {/* Folder open view */}
      <AnimatePresence>
        {openFolder && (
          <FolderView
            key={openFolder.id}
            folder={openFolder}
            onClose={() => setOpenFolder(null)}
            onRemoveBank={(bankId) => handleRemoveBankFromFolder(openFolder.id, bankId)}
            onBankClick={(bankId) => {
              setOpenFolder(null);
              navigateToBank(bankId);
            }}
            onRename={(title) => handleRenameFolder(openFolder.id, title)}
          />
        )}
      </AnimatePresence>

      {/* Delete confirmation modal */}
      <AnimatePresence>
        {deletingItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-slate-800 rounded-xl shadow-xl p-6 max-w-md w-full mx-4 border border-slate-200 dark:border-slate-700"
            >
              <h3 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">
                Delete {deletingItem.type === 'bank' ? 'Question Bank' : 'Folder'}?
              </h3>
              <p className="text-slate-700 dark:text-slate-300 mb-6">
                {deletingItem.type === 'bank'
                  ? 'This will delete the bank and all its questions, quizzes, and sessions. This cannot be undone.'
                  : 'This will delete the folder. The banks inside will not be deleted and will appear at the top level.'}
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setDeletingItem(null)}
                  className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  className="px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Folder name prompt (when dropping bank on bank) */}
      <AnimatePresence>
        {folderNamePrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-slate-800 rounded-xl shadow-xl p-6 max-w-md w-full mx-4 border border-slate-200 dark:border-slate-700"
            >
              <h3 className="text-xl font-semibold mb-2 text-slate-900 dark:text-slate-100">
                Create Folder
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                Both banks will be placed inside the new folder.
              </p>
              <input
                type="text"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                  if (e.key === 'Escape') {
                    setFolderNamePrompt(null);
                    setFolderName('');
                  }
                }}
                placeholder="Folder name"
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 mb-4 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                autoFocus
              />
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setFolderNamePrompt(null);
                    setFolderName('');
                  }}
                  className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateFolder}
                  className="px-4 py-2 bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200 rounded-lg hover:bg-purple-300 dark:hover:bg-purple-700 transition-colors"
                >
                  Create Folder
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
