'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface PlaylistBank {
  id: string;
  title: string;
}

interface AudioAvailability {
  bankId: string;
  title: string;
  hasAudio: boolean;
  url?: string;
  transcriptUrl?: string;
  generatedAt?: string;
}

interface FolderPlaylistProps {
  banks: PlaylistBank[];
  folderTitle: string;
  onClose: () => void;
}

export function FolderPlaylist({ banks, folderTitle, onClose }: FolderPlaylistProps) {
  const [audioTracks, setAudioTracks] = useState<AudioAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Fetch audio availability for all banks
  useEffect(() => {
    let cancelled = false;

    async function checkAll() {
      const results: AudioAvailability[] = [];

      // Fetch in parallel, batches of 5 to be polite
      for (let i = 0; i < banks.length; i += 5) {
        const batch = banks.slice(i, i + 5);
        const batchResults = await Promise.all(
          batch.map(async (bank) => {
            try {
              const res = await fetch(`/api/banks/${bank.id}/audio`);
              const data = await res.json();
              return {
                bankId: bank.id,
                title: bank.title,
                hasAudio: data.hasAudio,
                url: data.url,
                transcriptUrl: data.transcriptUrl,
                generatedAt: data.generatedAt,
              };
            } catch {
              return { bankId: bank.id, title: bank.title, hasAudio: false };
            }
          })
        );
        results.push(...batchResults);
      }

      if (!cancelled) {
        setAudioTracks(results.filter((t) => t.hasAudio && t.url));
        setLoading(false);
      }
    }

    checkAll();
    return () => { cancelled = true; };
  }, [banks]);

  const currentTrack = audioTracks[currentIndex];

  const handleTrackEnded = useCallback(() => {
    if (currentIndex < audioTracks.length - 1) {
      setCurrentIndex((i) => i + 1);
    } else {
      // Playlist finished
      setIsPlaying(false);
    }
  }, [currentIndex, audioTracks.length]);

  const handleNext = useCallback(() => {
    if (currentIndex < audioTracks.length - 1) {
      setCurrentIndex((i) => i + 1);
    }
  }, [currentIndex, audioTracks.length]);

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
    }
  }, [currentIndex]);

  const handleStart = () => {
    setIsPlaying(true);
    setCurrentIndex(0);
  };

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }, [isPlaying]);

  const seek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Number(e.target.value);
  }, []);

  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.currentTime + seconds, duration || 0));
  }, [duration]);

  const cycleRate = useCallback(() => {
    const rates = [1, 1.25, 1.5, 1.75, 2];
    const next = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
    setPlaybackRate(next);
    if (audioRef.current) {
      audioRef.current.playbackRate = next;
    }
  }, [playbackRate]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => handleTrackEnded();

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, [handleTrackEnded]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack?.url) return;

    audio.src = currentTrack.url;
    audio.load();
    audio.playbackRate = playbackRate;

    if (isPlaying) {
      const playWhenReady = () => {
        audio.play().catch(() => {});
      };
      if (audio.readyState >= 2) {
        playWhenReady();
      } else {
        audio.addEventListener('canplay', playWhenReady, { once: true });
      }
    }
  }, [currentTrack?.bankId, currentTrack?.url, isPlaying, playbackRate]);

  const formatTime = (s: number) => {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

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

  if (audioTracks.length === 0) {
    return null; // No audio available in this folder
  }

  return (
    <div className="mb-4">
      {/* Player section */}
      {isPlaying && currentTrack ? (
        <div className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 rounded-xl border border-purple-200 dark:border-purple-800 p-4 mb-3">
          <audio ref={audioRef} preload="metadata" />

          {/* Playlist header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-purple-600 dark:text-purple-400">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
              <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
                Playing: {folderTitle}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Track {currentIndex + 1} of {audioTracks.length}
              </span>
            </div>
            <button
              onClick={() => { setIsPlaying(false); onClose(); }}
              className="text-xs px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
            >
              Stop playlist
            </button>
          </div>

          {/* Current track title */}
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2 truncate">
            {currentTrack.title}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handlePrev}
              className="text-slate-600 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors disabled:opacity-30"
              title="Previous track"
              disabled={currentIndex === 0}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="3" y="5" width="3" height="14" />
                <polygon points="21,5 9,12 21,19" />
              </svg>
            </button>

            <button
              onClick={() => skip(-15)}
              className="text-slate-600 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
              title="Back 15s"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
              </svg>
            </button>

            <button
              onClick={togglePlay}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-purple-600 hover:bg-purple-700 text-white transition-colors"
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
              className="text-slate-600 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
              title="Forward 30s"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
              </svg>
            </button>

            <button
              onClick={handleNext}
              className="text-slate-600 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors disabled:opacity-30"
              title="Next track"
              disabled={currentIndex >= audioTracks.length - 1}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="3,5 15,12 3,19" />
                <rect x="18" y="5" width="3" height="14" />
              </svg>
            </button>

            <div className="flex-1 flex items-center gap-2">
              <span className="text-xs text-slate-600 dark:text-slate-400 w-10 text-right tabular-nums">
                {formatTime(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                value={currentTime}
                onChange={seek}
                className="flex-1 h-1.5 accent-purple-600 cursor-pointer"
              />
              <span className="text-xs text-slate-600 dark:text-slate-400 w-10 tabular-nums">
                {formatTime(duration)}
              </span>
            </div>

            <button
              onClick={cycleRate}
              className="text-xs font-medium px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors min-w-[3rem]"
            >
              {playbackRate}x
            </button>
          </div>
        </div>
      ) : null}

      {/* Track list (always visible when playlist active) */}
      {isPlaying && (
        <div className="bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden mb-3">
          <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Playlist
            </span>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {audioTracks.map((track, idx) => (
              <button
                key={track.bankId}
                onClick={() => {
                  setCurrentIndex(idx);
                }}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                  idx === currentIndex
                    ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <span className="w-6 text-center flex-shrink-0">
                  {idx === currentIndex ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="inline text-purple-600 dark:text-purple-400">
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                  ) : (
                    <span className="text-xs text-slate-400">{idx + 1}</span>
                  )}
                </span>
                <span className="text-sm truncate">{track.title}</span>
                {idx < currentIndex && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-auto flex-shrink-0 text-green-500">
                    <polyline points="20,6 9,17 4,12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Play All button (shown when not playing) */}
      {!isPlaying && (
        <button
          onClick={handleStart}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5,3 19,12 5,21" />
          </svg>
          Play all ({audioTracks.length} track{audioTracks.length !== 1 ? 's' : ''})
        </button>
      )}
    </div>
  );
}
