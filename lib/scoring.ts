// Always-filler patterns (no context needed - these are always fillers)
const ALWAYS_FILLER_PATTERNS = [
  /\buh\b/gi,
  /\bum\b/gi,
  /\buhm\b/gi,
  /\buhh\b/gi,
  /\berm\b/gi,
  /\byou know\b/gi,
  /\bya know\b/gi,
  /\by'know\b/gi,
  /\bkinda\b/gi,
  /\bsorta\b/gi,
  /\bI mean\b/gi,
  /\bI guess\b/gi,
  /\byou see\b/gi,
];

/**
 * Context-aware filler word detection.
 * Only counts words as fillers when used in filler contexts,
 * not when they're part of legitimate speech.
 */
export function countFillers(transcript: string): number {
  if (!transcript || transcript.trim().length === 0) {
    return 0;
  }

  const normalized = transcript
    .replace(/\s+/g, ' ')
    .trim();
  const lower = normalized.toLowerCase();

  let count = 0;
  const counted = new Set<number>(); // Track positions to avoid double-counting

  // 1. Count always-filler patterns
  for (const pattern of ALWAYS_FILLER_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(lower)) !== null) {
      if (!counted.has(match.index)) {
        counted.add(match.index);
        count++;
      }
    }
  }

  // 2. "er" - only count standalone "er" not inside words like "better", "her", "never"
  // Match "er" only when preceded by space/start and followed by space/punctuation/end
  const erPattern = /(?:^|\s)(er)(?:\s|[,\.!?;:]|$)/gi;
  erPattern.lastIndex = 0;
  let match;
  while ((match = erPattern.exec(lower)) !== null) {
    const pos = match.index + match[0].indexOf('er');
    if (!counted.has(pos)) {
      counted.add(pos);
      count++;
    }
  }

  // 3. "like" - only as filler, not in comparisons or descriptions
  // Filler: "I was like, um", "it's like, yeah", "like, I don't know"
  // NOT filler: "like a database", "looks like", "I like it", "something like that"
  const likePattern = /\blike\b/gi;
  likePattern.lastIndex = 0;
  while ((match = likePattern.exec(lower)) !== null) {
    if (counted.has(match.index)) continue;
    const before = lower.substring(Math.max(0, match.index - 15), match.index).trim();
    const after = lower.substring(match.index + 4, Math.min(lower.length, match.index + 20)).trim();

    // Skip if followed by a noun/adjective/article (comparison usage)
    if (/^[\s,]*(?:a|an|the|this|that|it|how|when|what)\b/i.test(after)) continue;
    // Skip if preceded by "looks", "feels", "sounds", "seems", "would", "I"
    if (/\b(?:looks?|feels?|sounds?|seems?|would|i|we|they|you)\s*$/i.test(before)) continue;
    // Count if followed by comma, pause marker, or another filler
    if (/^[\s,]*(?:um|uh|you know|I mean|so|well|,)/i.test(after) ||
        /[,]\s*$/i.test(before) ||
        /^(?:\s|$)/.test(after) && /(?:was|is|it's|and|but)\s*$/i.test(before)) {
      counted.add(match.index);
      count++;
    }
  }

  // 4. "so" - only as filler at sentence start or after a pause, not as conjunction
  // Filler: "So, I was thinking...", "So basically..."
  // NOT filler: "so that we could", "so much", "and so on", "did so"
  const soPattern = /\bso\b/gi;
  soPattern.lastIndex = 0;
  while ((match = soPattern.exec(lower)) !== null) {
    if (counted.has(match.index)) continue;
    const before = lower.substring(Math.max(0, match.index - 3), match.index).trim();
    const after = lower.substring(match.index + 2, Math.min(lower.length, match.index + 15)).trim();

    // Only count at sentence start (after period/start) or after comma
    const atSentenceStart = match.index === 0 || /[.!?]\s*$/.test(before) || before === '';
    const afterComma = /^,?\s*$/.test(before) || before.endsWith(',');

    // Skip if followed by "that", "much", "many", "far", "on", adjective patterns
    if (/^(?:that|much|many|far|long|on|few|well|good|bad|great)\b/i.test(after)) continue;

    if (atSentenceStart || afterComma) {
      counted.add(match.index);
      count++;
    }
  }

  // 5. "well" - only as filler at sentence start, not "well-known", "as well", "well enough"
  const wellPattern = /\bwell\b/gi;
  wellPattern.lastIndex = 0;
  while ((match = wellPattern.exec(lower)) !== null) {
    if (counted.has(match.index)) continue;
    const before = lower.substring(Math.max(0, match.index - 5), match.index).trim();
    const after = lower.substring(match.index + 4, Math.min(lower.length, match.index + 15)).trim();

    // Skip if part of compound: "well-", "as well", "well enough"
    if (/^-/.test(after) || /\bas\s*$/.test(before) || /^(?:enough|done|known|being)\b/i.test(after)) continue;

    // Only count at sentence start
    const atSentenceStart = match.index === 0 || /[.!?]\s*$/.test(before) || before === '';
    if (atSentenceStart) {
      counted.add(match.index);
      count++;
    }
  }

  // 6. "right" - only as filler when sentence-final with question intonation
  const rightPattern = /\bright\s*\?/gi;
  rightPattern.lastIndex = 0;
  while ((match = rightPattern.exec(lower)) !== null) {
    if (!counted.has(match.index)) {
      counted.add(match.index);
      count++;
    }
  }

  // 7. "I think" - only as filler when followed by hedging ("maybe", "probably", "perhaps")
  const iThinkPattern = /\bI think\b/gi;
  iThinkPattern.lastIndex = 0;
  while ((match = iThinkPattern.exec(lower)) !== null) {
    if (counted.has(match.index)) continue;
    const after = lower.substring(match.index + 7, Math.min(lower.length, match.index + 25)).trim();
    if (/^(?:maybe|probably|perhaps|I guess|like|sort of|kind of)\b/i.test(after)) {
      counted.add(match.index);
      count++;
    }
  }

  // 8. "okay/ok" - only as filler at sentence start or as standalone
  const okPattern = /\b(?:okay|ok)\b/gi;
  okPattern.lastIndex = 0;
  while ((match = okPattern.exec(lower)) !== null) {
    if (counted.has(match.index)) continue;
    const before = lower.substring(Math.max(0, match.index - 3), match.index).trim();
    const atSentenceStart = match.index === 0 || /[.!?,]\s*$/.test(before) || before === '';
    if (atSentenceStart) {
      counted.add(match.index);
      count++;
    }
  }

  // 9. Non-context-dependent fillers (always count)
  const otherFillers = [
    /\bsort of\b/gi,
    /\bkind of\b/gi,
    /\bactually\b/gi,
    /\bbasically\b/gi,
    /\bliterally\b/gi,
  ];
  for (const pattern of otherFillers) {
    pattern.lastIndex = 0;
    while ((match = pattern.exec(lower)) !== null) {
      if (!counted.has(match.index)) {
        counted.add(match.index);
        count++;
      }
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
  thresholdMs: number = 600 // Lowered from 800ms to 600ms to catch more pauses
): number {
  if (!words || words.length < 2) return 0;

  let longPauses = 0;
  for (let i = 1; i < words.length; i++) {
    const gap = (words[i].start - words[i - 1].end) * 1000; // Convert to ms
    if (gap > thresholdMs) {
      longPauses++;
      // Count very long pauses (>1.5s) as multiple pauses
      if (gap > 1500) {
        longPauses += Math.floor((gap - 1500) / 500); // Every 500ms after 1.5s counts as another pause
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
  // 1. Punctuation marks (periods, commas, question marks) - these indicate natural pauses
  // 2. Ellipses and dashes (indicate hesitation)
  // 3. Very short transcript relative to duration (suggests many pauses)
  // 4. Filler words followed by punctuation (often indicates hesitation/pause)
  
  const punctuationPauses = (transcript.match(/[.!?]/g) || []).length;
  const hesitationMarkers = (transcript.match(/\.\.\.|--|—/g) || []).length;
  
  // Count filler words that might indicate pauses (um, uh, erm followed by punctuation or space)
  const fillerPauseMarkers = (transcript.match(/\b(um|uh|erm|er)\s*[.,!?;:]|\b(um|uh|erm|er)\s+[A-Z]/gi) || []).length;
  
  // If transcript is very short relative to duration, there are likely many pauses
  const estimatedWPM = wordCount / (estimatedDurationSeconds / 60);
  // More aggressive pause detection for slow speech
  const pauseFromSlowSpeech = estimatedWPM < 120 ? Math.ceil((120 - estimatedWPM) / 15) : 0;
  
  // Combine indicators - be more generous with pause counting
  const estimatedPauses = punctuationPauses + hesitationMarkers + fillerPauseMarkers + pauseFromSlowSpeech;
  
  return Math.max(0, estimatedPauses);
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * Calculate a conciseness score (0-10) based on answer length relative to question type,
 * repetition rate, filler-to-content ratio, and whether the answer stayed on topic.
 */
export function calculateConcisenessScore(
  wordCount: number,
  fillerCount: number,
  questionType?: string,
  questionAnswered?: boolean,
  hasExcessiveRepetition?: boolean
): number {
  // Ideal word ranges by question type (more forgiving ranges)
  const idealRanges: Record<string, { min: number; max: number }> = {
    DEFINITION: { min: 20, max: 100 },
    BEHAVIORAL: { min: 100, max: 350 },
    TECHNICAL: { min: 60, max: 300 },
    SCENARIO: { min: 80, max: 300 },
    PITCH: { min: 40, max: 180 },
  };

  const range = idealRanges[questionType || 'BEHAVIORAL'] || idealRanges.BEHAVIORAL;
  let score = 10;

  // 1. Length penalty: too short or too long
  if (wordCount < range.min) {
    // Too brief - scale penalty based on how far below minimum
    const ratio = wordCount / range.min;
    if (ratio < 0.3) score -= 6;
    else if (ratio < 0.5) score -= 4;
    else if (ratio < 0.75) score -= 2;
    else score -= 1;
  } else if (wordCount > range.max) {
    // Rambling - scale penalty based on how far above maximum
    const excessRatio = wordCount / range.max;
    if (excessRatio > 3) score -= 6;
    else if (excessRatio > 2) score -= 4;
    else if (excessRatio > 1.5) score -= 2;
    else score -= 1;
  }

  // 2. Filler-to-content ratio penalty
  if (wordCount > 0) {
    const fillerRate = (fillerCount / wordCount) * 100;
    if (fillerRate > 8) score -= 3;
    else if (fillerRate > 5) score -= 2;
    else if (fillerRate > 3) score -= 1;
  }

  // 3. Excessive repetition penalty
  if (hasExcessiveRepetition) {
    score -= 2;
  }

  // 4. Off-topic penalty
  if (questionAnswered === false) {
    score -= 2;
  }

  // Round to nearest 0.5 and clamp
  return Math.min(10, Math.max(0, Math.round(score * 2) / 2));
}
