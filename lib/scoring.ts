// Filler word patterns (case-insensitive) - expanded list
// Note: Some patterns use word boundaries, others match standalone to catch variations
const FILLER_PATTERNS = [
  /\buh\b/gi,
  /\bum\b/gi,
  /\buhm\b/gi,
  /\buhh\b/gi,
  /\ber\b/gi, // British "er" - standalone
  /\berm\b/gi, // British "erm" - standalone
  /\ber\s/gi, // "er " (with space after)
  /\berm\s/gi, // "erm " (with space after)
  /\serm\b/gi, // " erm" (with space before)
  /\ser\b/gi, // " er" (with space before)
  /\blike\b/gi,
  /\byou know\b/gi,
  /\bya know\b/gi,
  /\bsort of\b/gi,
  /\bkind of\b/gi,
  /\bkinda\b/gi,
  /\bsorta\b/gi,
  /\bactually\b/gi,
  /\bbasically\b/gi,
  /\bliterally\b/gi,
  /\bso\b/gi, // "so" as filler (context-dependent, but common)
  /\bwell\b/gi, // "well" as filler
  /\bI mean\b/gi,
  /\bI guess\b/gi,
  /\bI think\b/gi, // When used as filler, not actual thinking
  /\byou see\b/gi,
  /\bright\b/gi, // "right?" as filler
  /\bokay\b/gi, // "okay" as filler
  /\bok\b/gi, // "ok" as filler
];

export function countFillers(transcript: string): number {
  if (!transcript || transcript.trim().length === 0) {
    return 0;
  }
  
  // Normalize transcript - lowercase and add spaces around punctuation for better matching
  // This helps catch fillers that might be transcribed with punctuation (e.g., "erm," or "er.")
  const normalized = transcript
    .toLowerCase()
    .replace(/[.,!?;:]/g, ' ') // Replace punctuation with spaces
    .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
    .trim();
  
  let count = 0;
  
  for (const pattern of FILLER_PATTERNS) {
    // Reset regex lastIndex to avoid issues with global regex
    pattern.lastIndex = 0;
    const matches = normalized.match(pattern);
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
      // Count very long pauses (>2s) as multiple pauses
      if (gap > 2000) {
        longPauses += Math.floor((gap - 2000) / 1000);
      }
    }
  }

  return longPauses;
}

/**
 * Detect pauses from transcript when word timestamps aren't available
 * Uses punctuation and natural speech patterns to estimate pauses
 */
export function detectLongPausesFromTranscript(
  transcript: string,
  estimatedDurationSeconds: number
): number {
  if (!transcript || transcript.trim().length === 0) return 0;
  
  const wordCount = countWords(transcript);
  if (wordCount === 0) return 0;
  
  // Estimate pauses based on:
  // 1. Punctuation marks (periods, commas, question marks)
  // 2. Ellipses and dashes (indicate hesitation)
  // 3. Very short transcript relative to duration (suggests many pauses)
  
  const punctuationPauses = (transcript.match(/[.!?]/g) || []).length;
  const hesitationMarkers = (transcript.match(/\.\.\.|--|—/g) || []).length;
  
  // If transcript is very short relative to duration, there are likely many pauses
  const estimatedWPM = wordCount / (estimatedDurationSeconds / 60);
  const pauseFromSlowSpeech = estimatedWPM < 100 ? Math.ceil((100 - estimatedWPM) / 20) : 0;
  
  // Combine indicators
  const estimatedPauses = punctuationPauses + hesitationMarkers + pauseFromSlowSpeech;
  
  return Math.max(0, estimatedPauses);
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
}
