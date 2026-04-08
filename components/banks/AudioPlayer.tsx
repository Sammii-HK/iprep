'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface AudioPlayerProps {
  bankId: string;
  bankTitle?: string;
  autoPlay?: boolean;
  autoPlayNonce?: number;
  onEnded?: () => void;
  onNextTrack?: () => void;
  onPrevTrack?: () => void;
  showTrackControls?: boolean;
}

interface AudioInfo {
  hasAudio: boolean;
  url?: string;
  transcriptUrl?: string;
  generatedAt?: string;
}

export function AudioPlayer({ bankId, bankTitle, autoPlay, autoPlayNonce, onEnded, onNextTrack, onPrevTrack, showTrackControls }: AudioPlayerProps) {
  const [info, setInfo] = useState<AudioInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    fetch(`/api/banks/${bankId}/audio`)
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo({ hasAudio: false }))
      .finally(() => setLoading(false));
  }, [bankId]);

  // Set up Media Session API for lock screen controls
  const updateMediaSession = useCallback(() => {
    if (!('mediaSession' in navigator) || !info?.url) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: bankTitle || 'Study Session',
      artist: 'iPrep',
      album: 'Audio Study Sessions',
    });

    navigator.mediaSession.setActionHandler('play', () => {
      audioRef.current?.play();
      setPlaying(true);
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      audioRef.current?.pause();
      setPlaying(false);
    });
    navigator.mediaSession.setActionHandler('seekbackward', () => {
      if (audioRef.current) {
        audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 15);
      }
    });
    navigator.mediaSession.setActionHandler('seekforward', () => {
      if (audioRef.current) {
        audioRef.current.currentTime = Math.min(
          audioRef.current.duration,
          audioRef.current.currentTime + 30
        );
      }
    });
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (audioRef.current && details.seekTime !== undefined) {
        audioRef.current.currentTime = details.seekTime;
      }
    });

    // Wire lock screen prev/next to playlist controls
    navigator.mediaSession.setActionHandler('previoustrack', onPrevTrack || null);
    navigator.mediaSession.setActionHandler('nexttrack', onNextTrack || null);
  }, [info, bankTitle, onPrevTrack, onNextTrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      // Update media session position state for lock screen progress bar
      if ('mediaSession' in navigator && isFinite(audio.duration)) {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: audio.currentTime,
        });
      }
    };
    const onDurationChange = () => setDuration(audio.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEndedHandler = () => {
      setPlaying(false);
      onEnded?.();
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEndedHandler);

    updateMediaSession();

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEndedHandler);
    };
  }, [info, updateMediaSession, onEnded]);

  // Auto-play when audio is ready and autoPlay is set
  useEffect(() => {
    if (!autoPlay || !info?.hasAudio || !audioRef.current) return;

    const audio = audioRef.current;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const attemptPlay = () => {
      if (cancelled) return;
      attempts += 1;
      audio.play().catch(() => {
        // Some browsers fail transiently between source swap and readiness.
        // Retry a few times to keep playlist transitions continuous.
        if (attempts < 12 && !cancelled) {
          retryTimer = setTimeout(attemptPlay, 200);
        }
      });
    };

    const onReady = () => {
      attemptPlay();
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('loadedmetadata', onReady);
    };

    if (audio.readyState >= 2) {
      attemptPlay();
    } else {
      audio.addEventListener('canplay', onReady);
      audio.addEventListener('loadedmetadata', onReady);
      // Best-effort kick in case readiness events were missed.
      setTimeout(attemptPlay, 100);
    }

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('loadedmetadata', onReady);
    };
  }, [autoPlay, autoPlayNonce, info?.hasAudio, info?.url, bankId]);

  if (loading || !info?.hasAudio) return null;

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Number(e.target.value);
  };

  const skip = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.currentTime + seconds, duration));
  };

  const cycleRate = () => {
    const rates = [1, 1.25, 1.5, 1.75, 2];
    const next = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
    setPlaybackRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const formatTime = (s: number) => {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 rounded-xl border border-purple-200 dark:border-purple-800 p-4 mb-6">
      <audio ref={audioRef} src={info.url} preload="metadata" autoPlay={!!autoPlay} />

      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
          Audio Study Session
        </span>
        {info.generatedAt && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Generated {new Date(info.generatedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Previous track */}
        {showTrackControls && (
          <button
            onClick={onPrevTrack}
            className="text-slate-600 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors disabled:opacity-30"
            title="Previous track"
            disabled={!onPrevTrack}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <rect x="3" y="5" width="3" height="14" />
              <polygon points="21,5 9,12 21,19" />
            </svg>
          </button>
        )}

        {/* Skip back */}
        <button
          onClick={() => skip(-15)}
          className="text-slate-600 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          title="Back 15s"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
          </svg>
        </button>

        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-purple-600 hover:bg-purple-700 text-white transition-colors"
        >
          {playing ? (
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

        {/* Skip forward */}
        <button
          onClick={() => skip(30)}
          className="text-slate-600 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
          title="Forward 30s"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
          </svg>
        </button>

        {/* Next track */}
        {showTrackControls && (
          <button
            onClick={onNextTrack}
            className="text-slate-600 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors disabled:opacity-30"
            title="Next track"
            disabled={!onNextTrack}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="3,5 15,12 3,19" />
              <rect x="18" y="5" width="3" height="14" />
            </svg>
          </button>
        )}

        {/* Progress bar */}
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

        {/* Speed */}
        <button
          onClick={cycleRate}
          className="text-xs font-medium px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors min-w-[3rem]"
        >
          {playbackRate}x
        </button>
      </div>
    </div>
  );
}
