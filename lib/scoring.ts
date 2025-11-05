// Filler word patterns (case-insensitive)
const FILLER_PATTERNS = [
  /\buh\b/gi,
  /\bum\b/gi,
  /\blike\b/gi,
  /\byou know\b/gi,
  /\bsort of\b/gi,
  /\bkind of\b/gi,
];

export function countFillers(transcript: string): number {
  let count = 0;
  for (const pattern of FILLER_PATTERNS) {
    const matches = transcript.match(pattern);
    if (matches) {
      count += matches.length;
    }
  }
  return count;
}

export function calculateWPM(words: number, durationSeconds: number): number {
  if (durationSeconds === 0) return 0;
  return Math.round((words / durationSeconds) * 60);
}

export function calculateFillerRate(
  fillerCount: number,
  wordCount: number
): number {
  if (wordCount === 0) return 0;
  return parseFloat(((fillerCount / wordCount) * 100).toFixed(2));
}

export function detectLongPauses(
  words: Array<{ word: string; start: number; end: number }>,
  thresholdMs: number = 800
): number {
  if (!words || words.length < 2) return 0;

  let longPauses = 0;
  for (let i = 1; i < words.length; i++) {
    const gap = (words[i].start - words[i - 1].end) * 1000; // Convert to ms
    if (gap > thresholdMs) {
      longPauses++;
    }
  }

  return longPauses;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
}
