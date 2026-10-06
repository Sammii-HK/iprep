'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  type BankAudioStatus,
  type PlaylistTrack,
  type SavedProgress,
  buildMediaMetadata,
  clampSeek,
  generateHint,
  hasMeaningfulResume,
  loadProgress,
  nextRate,
  partitionTracks,
  resumeTarget,
  saveProgress,
} from '@/lib/folder-playlist';

interface PlaylistBank {
  id: string;
  title: string;
}

interface FolderPlaylistProps {
  banks: PlaylistBank[];
  folderTitle: string;
  /** Used to remember position per folder. */
  folderId?: string;
  onClose: () => void;
}

function getStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const formatTime = (s: number) => {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export function FolderPlaylist({ banks, folderTitle, folderId, onClose }: FolderPlaylistProps) {
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [missing, setMissing] = useState<Array<{ bankId: string; title: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [saved, setSaved] = useState<SavedProgress | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const indexRef = useRef(0);
  const rateRef = useRef(1);
  const tracksRef = useRef<PlaylistTrack[]>([]);
  const lastSaveRef = useRef(0);

  tracksRef.current = tracks;

  // Work out which banks have audio. Folder order is preserved.
  useEffect(() => {
    let cancelled = false;

    async function checkAll() {
      const results: BankAudioStatus[] = [];
      for (let i = 0; i < banks.length; i += 5) {
        const batch = banks.slice(i, i + 5);
        const batchResults = await Promise.all(
          batch.map(async (bank): Promise<BankAudioStatus> => {
            try {
              const res = await fetch(`/api/banks/${bank.id}/audio`);
              const data = await res.json();
              return { bankId: bank.id, title: bank.title, hasAudio: Boolean(data.hasAudio), url: data.url };
            } catch {
              return { bankId: bank.id, title: bank.title, hasAudio: false };
            }
          })
        );
        results.push(...batchResults);
      }
      if (cancelled) return;
      const parts = partitionTracks(results);
      setTracks(parts.tracks);
      setMissing(parts.missing);
      if (folderId) {
        const progress = loadProgress(getStorage(), folderId);
        setSaved(progress);
        if (progress) {
          setPlaybackRate(progress.rate);
          rateRef.current = progress.rate;
        }
      }
      setLoading(false);
    }

    checkAll();
    return () => {
      cancelled = true;
    };
  }, [banks, folderId]);

  /** Load a track into the single persistent audio element. Must run inside a user gesture or an `ended` handler so iOS Safari keeps allowing playback. */
  const loadTrack = useCallback((index: number, startAt = 0) => {
    const audio = audioRef.current;
    const track = tracksRef.current[index];
    if (!audio || !track) return;
    indexRef.current = index;
    setCurrentIndex(index);
    setCurrentTime(startAt);
    audio.src = track.url;
    audio.playbackRate = rateRef.current;
    if (startAt > 0) {
      audio.addEventListener(
        'loadedmetadata',
        () => {
          audio.currentTime = startAt;
        },
        { once: true }
      );
    }
    audio.play().catch(() => setIsPlaying(false));
  }, []);

  const persist = useCallback(
    (force = false) => {
      const audio = audioRef.current;
      const track = tracksRef.current[indexRef.current];
      if (!folderId || !audio || !track) return;
      const now = Date.now();
      if (!force && now - lastSaveRef.current < 2000) return;
      lastSaveRef.current = now;
      saveProgress(getStorage(), folderId, {
        bankId: track.bankId,
        time: audio.currentTime,
        rate: rateRef.current,
        savedAt: now,
      });
    },
    [folderId]
  );

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= tracksRef.current.length) return;
      loadTrack(index);
    },
    [loadTrack]
  );

  const handleNext = useCallback(() => goTo(indexRef.current + 1), [goTo]);
  const handlePrev = useCallback(() => {
    const audio = audioRef.current;
    // Like most players: restart the track first, go back if already near the start.
    if (audio && audio.currentTime > 5) {
      audio.currentTime = 0;
      return;
    }
    goTo(indexRef.current - 1);
  }, [goTo]);

  const start = useCallback(
    (fromBeginning: boolean) => {
      setActive(true);
      const target = fromBeginning ? { index: 0, time: 0 } : resumeTarget(tracksRef.current, saved);
      // The audio element is mounted before the first click because it renders whenever tracks exist.
      loadTrack(target.index, target.time);
    },
    [loadTrack, saved]
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, []);

  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = clampSeek(audio.currentTime, seconds, audio.duration);
  }, []);

  const seek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = Number(e.target.value);
  }, []);

  const cycleRate = useCallback(() => {
    const next = nextRate(rateRef.current);
    rateRef.current = next;
    setPlaybackRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
    persist(true);
  }, [persist]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    persist(true);
    if (audio) audio.pause();
    setActive(false);
    setIsPlaying(false);
    onClose();
  }, [onClose, persist]);

  // Audio element events. Handlers read refs so the listeners never go stale.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      persist();
      if ('mediaSession' in navigator && isFinite(audio.duration) && audio.duration > 0) {
        try {
          navigator.mediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate || 1,
            position: Math.min(audio.currentTime, audio.duration),
          });
        } catch {
          // Some browsers throw on odd values; lock-screen position is optional.
        }
      }
    };
    const onDuration = () => setDuration(audio.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => {
      setIsPlaying(false);
      persist(true);
    };
    const onEnded = () => {
      if (indexRef.current < tracksRef.current.length - 1) {
        loadTrack(indexRef.current + 1);
      } else {
        setIsPlaying(false);
        persist(true);
      }
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, [loading, tracks.length, loadTrack, persist]);

  // Lock-screen / control-centre metadata and buttons.
  useEffect(() => {
    if (!active || !('mediaSession' in navigator)) return;
    const track = tracks[currentIndex];
    if (!track) return;
    const session = navigator.mediaSession;
    if (typeof MediaMetadata !== 'undefined') {
      session.metadata = new MediaMetadata(buildMediaMetadata(track, folderTitle, currentIndex, tracks.length));
    }
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => audioRef.current?.play().catch(() => {})],
      ['pause', () => audioRef.current?.pause()],
      ['previoustrack', handlePrev],
      ['nexttrack', handleNext],
      ['seekbackward', (d) => skip(-(d.seekOffset ?? 15))],
      ['seekforward', (d) => skip(d.seekOffset ?? 30)],
      [
        'seekto',
        (d) => {
          if (audioRef.current && typeof d.seekTime === 'number') audioRef.current.currentTime = d.seekTime;
        },
      ],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Action not supported on this browser.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // ignore
        }
      }
    };
  }, [active, currentIndex, tracks, folderTitle, handleNext, handlePrev, skip]);

  useEffect(() => {
    if (!('mediaSession' in navigator) || !active) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying, active]);

  if (loading) {
    return (
      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 rounded-xl border border-purple-200 dark:border-purple-800 p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="animate-spin w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full" />
          <span className="text-sm text-purple-700 dark:text-purple-300">
            Checking audio for {banks.length} banks...
          </span>
        </div>
      </div>
    );
  }

  const currentTrack = tracks[currentIndex];
  const resumable = hasMeaningfulResume(tracks, saved);
  const resumeTrack = resumable && saved ? tracks.find((t) => t.bankId === saved.bankId) : undefined;

  const missingList =
    missing.length > 0 ? (
      <details className="mt-3 text-sm text-slate-600 dark:text-slate-400">
        <summary className="cursor-pointer select-none">
          {missing.length} bank{missing.length !== 1 ? 's' : ''} without audio
        </summary>
        <ul className="mt-2 space-y-1 pl-4 list-disc">
          {missing.map((m) => (
            <li key={m.bankId}>{m.title}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs">
          Generate with:{' '}
          <code className="break-all rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.5">
            {generateHint(missing.map((m) => m.bankId))}
          </code>
        </p>
      </details>
    ) : null;

  if (tracks.length === 0) {
    return missingList ? <div className="mb-4">{missingList}</div> : null;
  }

  return (
    <div className="mb-4">
      {/* One persistent element so background and lock-screen playback carries on between tracks. */}
      <audio ref={audioRef} preload="metadata" playsInline />

      {active && currentTrack ? (
        <div className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 rounded-xl border border-purple-200 dark:border-purple-800 p-4 mb-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium text-purple-700 dark:text-purple-300 truncate">
                Playing: {folderTitle}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                Track {currentIndex + 1} of {tracks.length}
              </span>
            </div>
            <button
              onClick={stop}
              className="text-xs px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
            >
              Stop playlist
            </button>
          </div>

          <div className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2 truncate">
            {currentTrack.title}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handlePrev}
              className="text-slate-600 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
              title="Previous track"
              aria-label="Previous track"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="3" y="5" width="3" height="14" />
                <polygon points="21,5 9,12 21,19" />
              </svg>
            </button>

            <button
              onClick={() => skip(-15)}
              className="text-xs text-slate-600 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
              title="Back 15 seconds"
              aria-label="Back 15 seconds"
            >
              -15s
            </button>

            <button
              onClick={togglePlay}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-purple-600 hover:bg-purple-700 text-white transition-colors"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5,3 19,12 5,21" />
                </svg>
              )}
            </button>

            <button
              onClick={() => skip(30)}
              className="text-xs text-slate-600 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
              title="Forward 30 seconds"
              aria-label="Forward 30 seconds"
            >
              +30s
            </button>

            <button
              onClick={handleNext}
              className="text-slate-600 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors disabled:opacity-30"
              title="Next track"
              aria-label="Next track"
              disabled={currentIndex >= tracks.length - 1}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="3,5 15,12 3,19" />
                <rect x="18" y="5" width="3" height="14" />
              </svg>
            </button>

            <div className="flex-1 min-w-[10rem] flex items-center gap-2">
              <span className="text-xs text-slate-600 dark:text-slate-400 w-10 text-right tabular-nums">
                {formatTime(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                value={currentTime}
                onChange={seek}
                aria-label="Seek"
                className="flex-1 h-1.5 accent-purple-600 cursor-pointer"
              />
              <span className="text-xs text-slate-600 dark:text-slate-400 w-10 tabular-nums">
                {formatTime(duration)}
              </span>
            </div>

            <button
              onClick={cycleRate}
              aria-label="Playback speed"
              className="text-xs font-medium px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors min-w-[3rem]"
            >
              {playbackRate}x
            </button>
          </div>
        </div>
      ) : null}

      {active && (
        <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden mb-3">
          <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Playlist
            </span>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {tracks.map((track, idx) => (
              <button
                key={track.bankId}
                onClick={() => goTo(idx)}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                  idx === currentIndex
                    ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <span className="w-6 text-center flex-shrink-0 text-xs text-slate-400">
                  {idx === currentIndex ? '>' : idx + 1}
                </span>
                <span className="text-sm truncate">{track.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!active && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => start(false)}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21" />
            </svg>
            {resumable && resumeTrack ? `Resume (${resumeTrack.title})` : `Play folder (${tracks.length} track${tracks.length !== 1 ? 's' : ''})`}
          </button>
          {resumable && (
            <button
              onClick={() => start(true)}
              className="px-3 py-2 rounded-lg text-sm bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
            >
              Start from the beginning
            </button>
          )}
        </div>
      )}

      {missingList}
    </div>
  );
}
