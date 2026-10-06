import { describe, it, expect } from 'vitest';
import {
  buildMediaMetadata,
  clampSeek,
  clearProgress,
  generateHint,
  hasMeaningfulResume,
  loadProgress,
  nextRate,
  partitionTracks,
  progressKey,
  resumeTarget,
  saveProgress,
  type PlaylistTrack,
} from '@/lib/folder-playlist';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const tracks: PlaylistTrack[] = [
  { bankId: 'a', title: 'A', url: '/a.mp3' },
  { bankId: 'b', title: 'B', url: '/b.mp3' },
  { bankId: 'c', title: 'C', url: '/c.mp3' },
];

describe('partitionTracks', () => {
  it('keeps folder order for playable banks and lists banks without audio', () => {
    const { tracks: t, missing } = partitionTracks([
      { bankId: 'a', title: 'A', hasAudio: true, url: '/a.mp3' },
      { bankId: 'b', title: 'B', hasAudio: false },
      { bankId: 'c', title: 'C', hasAudio: true, url: '/c.mp3' },
      { bankId: 'd', title: 'D', hasAudio: true },
    ]);
    expect(t.map((x) => x.bankId)).toEqual(['a', 'c']);
    expect(missing.map((x) => x.bankId)).toEqual(['b', 'd']);
  });
});

describe('progress persistence', () => {
  it('round-trips position and rate per folder', () => {
    const s = memoryStorage();
    saveProgress(s, 'f1', { bankId: 'b', time: 42.5, rate: 1.5, savedAt: 1 });
    expect(loadProgress(s, 'f1')).toEqual({ bankId: 'b', time: 42.5, rate: 1.5, savedAt: 1 });
    expect(loadProgress(s, 'f2')).toBeNull();
    clearProgress(s, 'f1');
    expect(loadProgress(s, 'f1')).toBeNull();
  });

  it('ignores corrupt data and unknown rates', () => {
    const s = memoryStorage();
    s.setItem(progressKey('f'), '{not json');
    expect(loadProgress(s, 'f')).toBeNull();
    s.setItem(progressKey('f'), JSON.stringify({ bankId: 'a', time: -3, rate: 1 }));
    expect(loadProgress(s, 'f')).toBeNull();
    s.setItem(progressKey('f'), JSON.stringify({ bankId: 'a', time: 10, rate: 9 }));
    expect(loadProgress(s, 'f')?.rate).toBe(1);
  });

  it('does not throw when storage is unavailable or full', () => {
    expect(() => saveProgress(null, 'f', { bankId: 'a', time: 1, rate: 1, savedAt: 1 })).not.toThrow();
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    expect(() => saveProgress(throwing, 'f', { bankId: 'a', time: 1, rate: 1, savedAt: 1 })).not.toThrow();
    expect(loadProgress(throwing, 'f')).toBeNull();
  });
});

describe('resume', () => {
  it('resumes the saved track and time when it is still in the playlist', () => {
    expect(resumeTarget(tracks, { bankId: 'c', time: 30, rate: 1.25, savedAt: 1 })).toEqual({
      index: 2,
      time: 30,
      rate: 1.25,
    });
  });

  it('starts from the beginning when the saved bank has gone', () => {
    expect(resumeTarget(tracks, { bankId: 'zzz', time: 30, rate: 1.5, savedAt: 1 })).toEqual({
      index: 0,
      time: 0,
      rate: 1.5,
    });
    expect(resumeTarget(tracks, null)).toEqual({ index: 0, time: 0, rate: 1 });
  });

  it('only offers resume when there is something to resume', () => {
    expect(hasMeaningfulResume(tracks, null)).toBe(false);
    expect(hasMeaningfulResume(tracks, { bankId: 'a', time: 2, rate: 1, savedAt: 1 })).toBe(false);
    expect(hasMeaningfulResume(tracks, { bankId: 'a', time: 20, rate: 1, savedAt: 1 })).toBe(true);
    expect(hasMeaningfulResume(tracks, { bankId: 'b', time: 0, rate: 1, savedAt: 1 })).toBe(true);
  });
});

describe('controls and lock screen', () => {
  it('cycles playback speed and wraps', () => {
    expect(nextRate(1)).toBe(1.25);
    expect(nextRate(2)).toBe(1);
    expect(nextRate(3)).toBe(1);
  });

  it('clamps seeking within the track', () => {
    expect(clampSeek(5, -15, 100)).toBe(0);
    expect(clampSeek(90, 30, 100)).toBe(100);
    expect(clampSeek(10, 30, NaN)).toBe(40);
  });

  it('builds Media Session metadata with position in the folder', () => {
    expect(buildMediaMetadata(tracks[1], 'Personio Interview Prep', 1, 3)).toEqual({
      title: 'B',
      artist: 'Personio Interview Prep (2 of 3)',
      album: 'iPrep',
    });
  });

  it('gives the exact generate command for missing banks', () => {
    expect(generateHint(['x', 'y'])).toBe('npx tsx scripts/generate-bank-episodes.ts x y');
  });
});
