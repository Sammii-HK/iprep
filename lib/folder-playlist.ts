/**
 * Pure helpers for the folder audio playlist (continuous playback, resume, lock-screen metadata).
 * Kept free of React and the DOM so they can be unit tested.
 */

export const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2] as const;

export interface PlaylistTrack {
  bankId: string;
  title: string;
  url: string;
}

export interface BankAudioStatus {
  bankId: string;
  title: string;
  hasAudio: boolean;
  url?: string;
}

export interface SavedProgress {
  bankId: string;
  time: number;
  rate: number;
  savedAt: number;
}

export function nextRate(current: number): number {
  const index = PLAYBACK_RATES.findIndex((r) => r === current);
  return PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length];
}

export function progressKey(folderId: string): string {
  return `iprep:folder-playlist:${folderId}`;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function saveProgress(storage: StorageLike | null, folderId: string, progress: SavedProgress): void {
  if (!storage) return;
  try {
    storage.setItem(progressKey(folderId), JSON.stringify(progress));
  } catch {
    // Private mode or quota: resume is a nicety, never an error.
  }
}

export function loadProgress(storage: StorageLike | null, folderId: string): SavedProgress | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(progressKey(folderId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedProgress>;
    if (
      typeof parsed.bankId !== 'string' ||
      typeof parsed.time !== 'number' ||
      !Number.isFinite(parsed.time) ||
      parsed.time < 0
    ) {
      return null;
    }
    const rate = PLAYBACK_RATES.includes(parsed.rate as (typeof PLAYBACK_RATES)[number])
      ? (parsed.rate as number)
      : 1;
    return { bankId: parsed.bankId, time: parsed.time, rate, savedAt: Number(parsed.savedAt) || 0 };
  } catch {
    return null;
  }
}

export function clearProgress(storage: StorageLike | null, folderId: string): void {
  if (!storage) return;
  try {
    storage.removeItem(progressKey(folderId));
  } catch {
    // ignore
  }
}

/** Split bank statuses into playable tracks (folder order kept) and banks still missing audio. */
export function partitionTracks(statuses: BankAudioStatus[]): {
  tracks: PlaylistTrack[];
  missing: Array<{ bankId: string; title: string }>;
} {
  const tracks: PlaylistTrack[] = [];
  const missing: Array<{ bankId: string; title: string }> = [];
  for (const s of statuses) {
    if (s.hasAudio && s.url) tracks.push({ bankId: s.bankId, title: s.title, url: s.url });
    else missing.push({ bankId: s.bankId, title: s.title });
  }
  return { tracks, missing };
}

/** Where to start: the saved track and time if that track is still in the playlist, else the beginning. */
export function resumeTarget(
  tracks: PlaylistTrack[],
  saved: SavedProgress | null
): { index: number; time: number; rate: number } {
  if (saved) {
    const index = tracks.findIndex((t) => t.bankId === saved.bankId);
    if (index >= 0) return { index, time: saved.time, rate: saved.rate };
  }
  return { index: 0, time: 0, rate: saved?.rate ?? 1 };
}

/** A resume point under 5 seconds is not worth announcing. */
export function hasMeaningfulResume(tracks: PlaylistTrack[], saved: SavedProgress | null): boolean {
  if (!saved) return false;
  const target = resumeTarget(tracks, saved);
  return tracks.some((t) => t.bankId === saved.bankId) && (target.index > 0 || target.time > 5);
}

export function generateHint(missingBankIds: string[]): string {
  return `npx tsx scripts/generate-bank-episodes.ts ${missingBankIds.join(' ')}`;
}

export function buildMediaMetadata(track: PlaylistTrack, folderTitle: string, index: number, total: number) {
  return {
    title: track.title,
    artist: `${folderTitle} (${index + 1} of ${total})`,
    album: 'iPrep',
  };
}

export function clampSeek(current: number, delta: number, duration: number): number {
  const upper = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  return Math.max(0, Math.min(current + delta, upper));
}
