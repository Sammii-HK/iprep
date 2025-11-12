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
 * IMPROVED: More dynamic scoring that better reflects actual expressiveness
 */
export function analyzeIntonationFromTranscript(
  transcript: string,
  wordCount: number
): number {
  // Start with base score of 2.5 (slightly below neutral to allow for more variation)
  let score = 2.5;
  let factors = 0; // Track how many factors we're evaluating

  // 1. Exclamations and questions show expressiveness (0-1.5 points)
  const exclamations = (transcript.match(/!/g) || []).length;
  const questions = (transcript.match(/\?/g) || []).length;
  const sentences = (transcript.match(/[.!?]+/g) || []).length;
  
  if (sentences > 0) {
    factors++;
    const expressivenessRatio = (exclamations + questions) / sentences;
    // More dynamic scoring: reward expressiveness more strongly
    if (expressivenessRatio >= 0.15) {
      score += 1.5; // Very expressive
    } else if (expressivenessRatio >= 0.08) {
      score += 1.0; // Good expressiveness
    } else if (expressivenessRatio >= 0.03) {
      score += 0.5; // Some expressiveness
    } else if (expressivenessRatio === 0 && sentences >= 3) {
      score -= 0.8; // Too monotone (only penalize if multiple sentences)
    }
  }

  // 2. Sentence length variation (monotone = all similar length, expressive = varied) (0-1.5 points)
  const sentenceLengths = transcript
    .split(/[.!?]+/)
    .map((s) => s.trim().split(/\s+/).filter((w) => w.length > 0).length)
    .filter((len) => len > 0);

  if (sentenceLengths.length > 2) { // Need at least 3 sentences for meaningful variation
    factors++;
    const avgLength = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length;
    const variance =
      sentenceLengths.reduce((sum, len) => sum + Math.pow(len - avgLength, 2), 0) /
      sentenceLengths.length;
    
    // More dynamic variance scoring
    const normalizedVariance = variance / (avgLength * avgLength);
    if (normalizedVariance >= 0.5) {
      score += 1.5; // Very varied (expressive)
    } else if (normalizedVariance >= 0.3) {
      score += 1.0; // Good variation
    } else if (normalizedVariance >= 0.15) {
      score += 0.5; // Some variation
    } else if (normalizedVariance < 0.05) {
      score -= 1.0; // Too monotone (all sentences similar length)
    }
  }

  // 3. Emphasis words and intensifiers (0-1.0 points)
  const emphasisWords = transcript.match(/\b(really|very|absolutely|definitely|clearly|significantly|dramatically|substantially|particularly|especially|notably|crucially|importantly|essentially|fundamentally)/gi) || [];
  if (wordCount > 0) {
    factors++;
    const emphasisRatio = emphasisWords.length / wordCount;
    // More generous scoring for emphasis
    if (emphasisRatio >= 0.03) {
      score += 1.0; // Strong emphasis
    } else if (emphasisRatio >= 0.015) {
      score += 0.7; // Good emphasis
    } else if (emphasisRatio >= 0.005) {
      score += 0.4; // Some emphasis
    }
  }

  // 4. Contractions and natural speech patterns (0-0.8 points)
  const contractions = transcript.match(/\b(I'm|I've|I'll|I'd|we're|we've|we'll|don't|can't|won't|isn't|aren't|wasn't|weren't|hasn't|haven't|doesn't|didn't|wouldn't|couldn't|shouldn't)/gi) || [];
  if (wordCount > 0) {
    factors++;
    const contractionRatio = contractions.length / wordCount;
    // More natural speech scoring
    if (contractionRatio >= 0.04) {
      score += 0.8; // Very natural
    } else if (contractionRatio >= 0.02) {
      score += 0.5; // Natural
    } else if (contractionRatio >= 0.01) {
      score += 0.3; // Some natural patterns
    }
  }

  // 5. Active voice and action verbs (0-0.7 points)
  const actionVerbs = transcript.match(/\b(achieved|delivered|improved|reduced|increased|optimized|scaled|built|created|solved|implemented|designed|developed|managed|led|executed|completed|accomplished)/gi) || [];
  if (wordCount > 0) {
    factors++;
    const actionRatio = actionVerbs.length / wordCount;
    if (actionRatio >= 0.02) {
      score += 0.7; // Very active
    } else if (actionRatio >= 0.01) {
      score += 0.4; // Active
    }
  }

  // 6. Numbers and metrics (show engagement with data) (0-0.5 points)
  const numbers = (transcript.match(/\b\d+(?:\.\d+)?%?\b/g) || []).length;
  if (wordCount > 0 && numbers > 0) {
    factors++;
    const numberRatio = numbers / wordCount;
    if (numberRatio >= 0.02) {
      score += 0.5; // Lots of metrics
    } else if (numberRatio >= 0.01) {
      score += 0.3; // Some metrics
    }
  }

  // Normalize score: if we evaluated few factors, adjust base score
  // This prevents artificially high/low scores from limited data
  if (factors < 3 && wordCount < 50) {
    // Short answers with few factors: be more conservative
    score = Math.min(score, 3.5);
  }

  // Round to nearest integer (0-5 scale)
  return Math.min(5, Math.max(0, Math.round(score)));
}
