'use client';

import { useEffect, useState } from 'react';
import { AudioPlayer } from '@/components/banks/AudioPlayer';

interface AudioMetadata {
  hasAudio: boolean;
  url?: string;
  transcriptUrl?: string;
  fileSizeBytes?: number;
  generatedAt?: string;
}

interface BankWithAudio {
  id: string;
  title: string;
  questionCount: number;
  order: number;
  audio: AudioMetadata | null;
}

interface FolderItem {
  type: 'folder';
  id: string;
  title: string;
  color: string | null;
  order: number;
  banks: BankWithAudio[];
}

interface BankItem {
  type: 'bank';
  id: string;
  title: string;
  order: number;
  questionCount: number;
  createdAt: string;
  audio: AudioMetadata | null;
}

type LibraryItem = BankItem | FolderItem;

export default function AudioLibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'name' | 'audio-status' | 'date'>('name');
  const [filterAudio, setFilterAudio] = useState<'all' | 'with-audio' | 'without-audio'>('all');

  useEffect(() => {
    fetchAudioLibrary();
  }, []);

  const fetchAudioLibrary = async () => {
    try {
      const response = await fetch('/api/audio/library');
      if (response.ok) {
        const data = await response.json();
        setItems(data.items);
      }
    } catch (error) {
      console.error('Error fetching audio library:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return 'Unknown';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return 'Unknown';
    }
  };

  const hasAudio = (item: LibraryItem): boolean => {
    if (item.type === 'bank') {
      return !!item.audio?.hasAudio;
    } else {
      return item.banks.some((b) => b.audio?.hasAudio);
    }
  };

  const audioCount = (item: LibraryItem): number => {
    if (item.type === 'bank') {
      return item.audio?.hasAudio ? 1 : 0;
    } else {
      return item.banks.filter((b) => b.audio?.hasAudio).length;
    }
  };

  const sortItems = (itemsToSort: LibraryItem[]): LibraryItem[] => {
    return [...itemsToSort].sort((a, b) => {
      if (sortBy === 'audio-status') {
        const aAudio = hasAudio(a) ? 1 : 0;
        const bAudio = hasAudio(b) ? 1 : 0;
        return bAudio - aAudio;
      } else if (sortBy === 'date') {
        const aDate = a.type === 'bank' ? new Date(a.createdAt).getTime() : 0;
        const bDate = b.type === 'bank' ? new Date(b.createdAt).getTime() : 0;
        return bDate - aDate;
      } else {
        return a.title.localeCompare(b.title);
      }
    });
  };

  const filterItems = (itemsToFilter: LibraryItem[]): LibraryItem[] => {
    if (filterAudio === 'all') return itemsToFilter;

    return itemsToFilter.filter((item) => {
      if (filterAudio === 'with-audio') {
        return hasAudio(item);
      } else {
        return !hasAudio(item);
      }
    });
  };

  const displayItems = filterItems(sortItems(items));

  return (
    <div className="px-4 py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Audio Study Sessions</h1>
        <p className="text-slate-600 dark:text-slate-400">
          All your study sessions organized by bank and folder
        </p>
      </div>

      {/* Controls */}
      <div className="flex gap-4 mb-6 flex-wrap">
        <div className="flex gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Sort:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm"
          >
            <option value="name">Name</option>
            <option value="audio-status">Audio Status</option>
            <option value="date">Date Created</option>
          </select>
        </div>

        <div className="flex gap-2">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Filter:</label>
          <select
            value={filterAudio}
            onChange={(e) => setFilterAudio(e.target.value as typeof filterAudio)}
            className="px-3 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm"
          >
            <option value="all">All</option>
            <option value="with-audio">With Audio</option>
            <option value="without-audio">Without Audio</option>
          </select>
        </div>
      </div>

      {/* Main Content */}
      {loading ? (
        <div className="text-center py-12">Loading audio library...</div>
      ) : displayItems.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-slate-600 dark:text-slate-400">No items found</p>
        </div>
      ) : (
        <div className="space-y-6">
          {displayItems.map((item) => (
            <div key={item.id}>
              {item.type === 'folder' ? (
                <div>
                  {/* Folder Header */}
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className="w-4 h-4 rounded"
                      style={{
                        backgroundColor: item.color || '#94a3b8',
                      }}
                    />
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                      {item.title}
                    </h2>
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {audioCount(item)}/{item.banks.length} with audio
                    </span>
                  </div>

                  {/* Banks in Folder */}
                  <div className="grid grid-cols-1 gap-4 ml-6">
                    {item.banks.map((bank) => (
                      <AudioLibraryCard
                        key={bank.id}
                        bank={bank}
                        formatFileSize={formatFileSize}
                        formatDate={formatDate}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                // Top-level Bank
                <AudioLibraryCard
                  bank={item}
                  formatFileSize={formatFileSize}
                  formatDate={formatDate}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface AudioLibraryCardProps {
  bank: BankWithAudio;
  formatFileSize: (bytes: number) => string;
  formatDate: (date: string | undefined) => string;
}

function AudioLibraryCard({ bank, formatFileSize, formatDate }: AudioLibraryCardProps) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">{bank.title}</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {bank.questionCount} question{bank.questionCount !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {bank.audio?.hasAudio ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
              </svg>
              Ready
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 100-2 1 1 0 000 2zm6 0a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              No audio
            </span>
          )}
        </div>
      </div>

      {bank.audio?.hasAudio ? (
        <div className="space-y-3">
          <AudioPlayer bankId={bank.id} bankTitle={bank.title} />
          <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
            {bank.audio.fileSizeBytes && (
              <p>File size: {formatFileSize(bank.audio.fileSizeBytes)}</p>
            )}
            {bank.audio.generatedAt && (
              <p>Generated: {formatDate(bank.audio.generatedAt)}</p>
            )}
            {bank.audio.transcriptUrl && (
              <p>
                <a
                  href={bank.audio.transcriptUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-600 dark:text-purple-400 hover:underline"
                >
                  View transcript
                </a>
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Audio will appear here once generated
        </p>
      )}
    </div>
  );
}
