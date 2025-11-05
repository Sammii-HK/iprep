/**
 * Confidence and intonation analysis based on transcript patterns
 * For v1, we use transcript-based heuristics since server-side audio analysis
 * requires additional libraries. Client-side audio analysis can be added later.
 */

/**
 * Analyze transcript for confidence indicators
 * Confidence markers: sentence completion, hesitation patterns, filler usage, sentence structure
 */
export function analyzeConfidenceFromTranscript(
  transcript: string,
  fillerCount: number,
  wordCount: number,
  longPauses: number
): number {
  // Base score starts at 3 (neutral)
  let score = 3;

  // Sentence completion strength (sentences ending with proper punctuation vs trailing off)
  const sentences = transcript.match(/[.!?]+/g) || [];
  const sentenceCount = sentences.length;
  const trailingOff = transcript.match(/\.\.\.|--|—|\s+$/g) || [];
  
  if (sentenceCount > 0 && wordCount > 0) {
    const avgWordsPerSentence = wordCount / sentenceCount;
    // Confident speakers complete thoughts (10-25 words per sentence average)
    if (avgWordsPerSentence >= 10 && avgWordsPerSentence <= 25) {
      score += 0.5;
    }
    // Trailing off reduces confidence
    if (trailingOff.length > sentenceCount * 0.3) {
      score -= 0.5;
    }
  }

  // Filler rate impact (lower fillers = more confident)
  const fillerRate = wordCount > 0 ? (fillerCount / wordCount) * 100 : 0;
  if (fillerRate < 2) {
    score += 0.5;
  } else if (fillerRate > 5) {
    score -= 0.5;
  }

  // Long pauses reduce confidence (shows hesitation)
  if (longPauses === 0) {
    score += 0.5;
  } else if (longPauses > 3) {
    score -= 0.5;
  }

  // Strong declarative statements boost confidence
  const strongStatements = transcript.match(/\b(I|We|The team)\s+(achieved|delivered|improved|reduced|increased|built|created|solved)/gi) || [];
  if (strongStatements.length > 0) {
    score += 0.3;
  }

  // Uncertainty markers reduce confidence
  const uncertaintyMarkers = transcript.match(/\b(maybe|perhaps|I think|I guess|sort of|kind of|probably|I'm not sure)/gi) || [];
  if (uncertaintyMarkers.length > 2) {
    score -= 0.5;
  }

  return Math.min(5, Math.max(0, Math.round(score)));
}

/**
 * Analyze transcript for intonation indicators
 * Intonation markers: question marks, exclamations, varied sentence length, emphasis words
 */
export function analyzeIntonationFromTranscript(
  transcript: string,
  wordCount: number
): number {
  // Base score starts at 3 (neutral)
  let score = 3;

  // Exclamations and questions show expressiveness
  const exclamations = (transcript.match(/!/g) || []).length;
  const questions = (transcript.match(/\?/g) || []).length;
  const sentences = (transcript.match(/[.!?]+/g) || []).length;
  
  if (sentences > 0) {
    const expressivenessRatio = (exclamations + questions) / sentences;
    // Moderate expressiveness (5-15%) is ideal
    if (expressivenessRatio >= 0.05 && expressivenessRatio <= 0.15) {
      score += 0.5;
    } else if (expressivenessRatio === 0) {
      score -= 0.5; // Too monotone
    }
  }

  // Sentence length variation (monotone = all similar length, expressive = varied)
  const sentenceLengths = transcript
    .split(/[.!?]+/)
    .map((s) => s.trim().split(/\s+/).filter((w) => w.length > 0).length)
    .filter((len) => len > 0);

  if (sentenceLengths.length > 1) {
    const avgLength = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length;
    const variance =
      sentenceLengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) /
      sentenceLengths.length;
    
    // Moderate variance is good (not all same length, not too chaotic)
    const normalizedVariance = variance / (avgLength * avgLength);
    if (normalizedVariance >= 0.2 && normalizedVariance <= 0.6) {
      score += 0.5;
    } else if (normalizedVariance < 0.1) {
      score -= 0.5; // Too monotone
    }
  }

  // Emphasis words (really, very, absolutely, definitely, etc.)
  const emphasisWords = transcript.match(/\b(really|very|absolutely|definitely|clearly|significantly|dramatically|substantially)/gi) || [];
  if (wordCount > 0) {
    const emphasisRatio = emphasisWords.length / wordCount;
    // Moderate emphasis (1-3% of words) shows good intonation
    if (emphasisRatio >= 0.01 && emphasisRatio <= 0.03) {
      score += 0.5;
    }
  }

  // Contractions and natural speech patterns show expressiveness
  const contractions = transcript.match(/\b(I'm|I've|I'll|we're|we've|don't|can't|won't|isn't|aren't)/gi) || [];
  if (wordCount > 0) {
    const contractionRatio = contractions.length / wordCount;
    // Natural speech has some contractions (2-5%)
    if (contractionRatio >= 0.02 && contractionRatio <= 0.05) {
      score += 0.3;
    }
  }

  return Math.min(5, Math.max(0, Math.round(score)));
}
