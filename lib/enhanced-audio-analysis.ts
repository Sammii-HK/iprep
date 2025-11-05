/**
 * Enhanced audio analysis for voice quality and speaking patterns
 * This includes both transcript-based and audio-feature-based analysis
 */

import { analyzeTranscript as analyzeTranscriptBase } from './ai';
import {
  analyzeConfidenceFromTranscript,
  analyzeIntonationFromTranscript,
} from './audio-analysis';

export interface VoiceQualityMetrics {
  articulationScore: number; // 0-5: clarity and enunciation
  volumeConsistency: number; // 0-5: consistent volume throughout
  pacingScore: number; // 0-5: natural rhythm and pacing
  emphasisScore: number; // 0-5: appropriate emphasis on key points
  engagementScore: number; // 0-5: enthusiasm and energy
}

export interface TechnicalKnowledgeMetrics {
  terminologyScore: number; // 0-5: use of domain-specific terms
  specificityScore: number; // 0-5: concrete vs vague language
  depthScore: number; // 0-5: depth of technical understanding
  accuracyScore: number; // 0-5: technical accuracy (requires domain knowledge)
}

/**
 * Analyze pause patterns for better speaking rhythm assessment
 */
export function analyzePausePatterns(
  wordTimestamps: Array<{ word: string; start: number; end: number }>
): {
  naturalPauses: number; // Pauses at sentence boundaries
  awkwardPauses: number; // Pauses mid-sentence
  pauseDistribution: number; // 0-5: how well-distributed pauses are
} {
  if (!wordTimestamps || wordTimestamps.length < 2) {
    return { naturalPauses: 0, awkwardPauses: 0, pauseDistribution: 3 };
  }

  const pauses: Array<{ gap: number; isNatural: boolean }> = [];
  const sentenceEnders = /[.!?]$/;

  for (let i = 1; i < wordTimestamps.length; i++) {
    const gap = (wordTimestamps[i].start - wordTimestamps[i - 1].end) * 1000; // ms
    if (gap > 200) {
      // Only count pauses > 200ms
      const prevWord = wordTimestamps[i - 1].word.toLowerCase();
      const isNatural = sentenceEnders.test(prevWord) || gap > 500;
      pauses.push({ gap, isNatural });
    }
  }

  const naturalPauses = pauses.filter((p) => p.isNatural).length;
  const awkwardPauses = pauses.filter((p) => !p.isNatural && p.gap > 800).length;

  // Calculate pause distribution score (ideal: consistent pauses at sentence boundaries)
  const pauseGaps = pauses.filter((p) => p.isNatural).map((p) => p.gap);
  const avgGap = pauseGaps.length > 0
    ? pauseGaps.reduce((a, b) => a + b, 0) / pauseGaps.length
    : 0;
  const gapVariance = pauseGaps.length > 0
    ? pauseGaps.reduce((sum, gap) => sum + Math.pow(gap - avgGap, 2), 0) / pauseGaps.length
    : 0;

  // Lower variance = more consistent = better
  const distributionScore = Math.max(0, Math.min(5, 5 - (gapVariance / 100000)));

  return {
    naturalPauses,
    awkwardPauses,
    pauseDistribution: Math.round(distributionScore),
  };
}

/**
 * Analyze voice quality from transcript and word timestamps
 */
export function analyzeVoiceQuality(
  transcript: string,
  wordTimestamps: Array<{ word: string; start: number; end: number }> | undefined,
  wordCount: number
): VoiceQualityMetrics {
  // Articulation: Based on word length variation and pronunciation clarity indicators
  const words = transcript.split(/\s+/).filter((w) => w.length > 0);
  const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
  const wordLengthVariance =
    words.reduce((sum, w) => sum + Math.pow(w.length - avgWordLength, 2), 0) / words.length;

  // Good articulation uses varied word lengths (not all short words = mumbling)
  const articulationScore = Math.min(5, Math.max(0, Math.round(
    3 + (avgWordLength > 4 ? 1 : 0) + (wordLengthVariance > 2 ? 1 : 0)
  )));

  // Volume consistency: Based on sentence length consistency (speakers trail off = volume drops)
  const sentences = transcript.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const sentenceLengths = sentences.map((s) => s.trim().split(/\s+/).length);
  const lengthVariance =
    sentenceLengths.length > 1
      ? sentenceLengths.reduce(
          (sum, len) =>
            sum + Math.pow(len - sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length, 2),
          0
        ) / sentenceLengths.length
      : 0;

  // Lower variance = more consistent = better
  const volumeConsistency = Math.min(5, Math.max(0, Math.round(5 - lengthVariance / 10)));

  // Pacing: Based on WPM and pause patterns
  let pacingScore = 3;
  if (wordTimestamps && wordTimestamps.length > 0) {
    const duration = wordTimestamps[wordTimestamps.length - 1].end;
    const wpm = (wordCount / duration) * 60;
    const pausePatterns = analyzePausePatterns(wordTimestamps);

    // Ideal WPM: 120-150
    if (wpm >= 120 && wpm <= 150) {
      pacingScore += 1;
    } else if (wpm < 100 || wpm > 180) {
      pacingScore -= 1;
    }

    // Good pause distribution improves pacing
    pacingScore = Math.min(5, Math.max(0, Math.round(pacingScore + pausePatterns.pauseDistribution / 5)));
  }

  // Emphasis: Based on technical terms, numbers, and strong action verbs
  const emphasisMarkers = [
    /\b\d+(?:\.\d+)?%?\b/g, // Numbers
    /\b(API|SQL|HTTP|REST|GraphQL|AWS|Azure|GCP|Kubernetes|Docker|React|Vue|Angular)\b/gi, // Tech terms
    /\b(achieved|delivered|improved|reduced|increased|optimized|scaled|built|created|solved|implemented)\b/gi, // Action verbs
  ];

  let emphasisCount = 0;
  emphasisMarkers.forEach((pattern) => {
    const matches = transcript.match(pattern);
    if (matches) emphasisCount += matches.length;
  });

  const emphasisRatio = wordCount > 0 ? emphasisCount / wordCount : 0;
  const emphasisScore = Math.min(5, Math.max(0, Math.round(3 + emphasisRatio * 20)));

  // Engagement: Based on varied sentence structures, questions, and active voice
  const questions = (transcript.match(/\?/g) || []).length;
  const activeVoice = (transcript.match(/\b(I|we|the team|our team)\s+\w+ed\b/gi) || []).length;
  const variedStructures = sentenceLengths.length > 1
    ? sentenceLengths.length / Math.max(...sentenceLengths)
    : 0;

  const engagementScore = Math.min(5, Math.max(0, Math.round(
    3 +
      (questions > 0 ? 0.5 : 0) +
      (activeVoice > 2 ? 0.5 : 0) +
      (variedStructures > 0.3 ? 0.5 : 0)
  )));

  return {
    articulationScore,
    volumeConsistency,
    pacingScore,
    emphasisScore,
    engagementScore,
  };
}

/**
 * Analyze technical knowledge from transcript
 */
export async function analyzeTechnicalKnowledge(
  transcript: string,
  questionTags: string[],
  domain: string = 'Software Engineering'
): Promise<TechnicalKnowledgeMetrics> {
  // Terminology: Count domain-specific terms
  const domainTerms: Record<string, string[]> = {
    'Software Engineering': [
      'API', 'endpoint', 'microservice', 'database', 'cache', 'queue', 'load balancer',
      'scalability', 'performance', 'latency', 'throughput', 'architecture', 'design pattern',
      'algorithm', 'data structure', 'OOP', 'functional programming', 'test coverage',
      'CI/CD', 'deployment', 'monitoring', 'logging', 'debugging', 'refactoring',
      'code review', 'version control', 'Git', 'repository', 'branch', 'merge',
      'pull request', 'agile', 'sprint', 'scrum', 'kanban', 'stakeholder',
    ],
    'System Design': [
      'scalability', 'reliability', 'availability', 'consistency', 'partition tolerance',
      'CAP theorem', 'distributed system', 'replication', 'sharding', 'caching',
      'CDN', 'database', 'SQL', 'NoSQL', 'index', 'query optimization',
      'load balancing', 'horizontal scaling', 'vertical scaling', 'caching strategy',
      'message queue', 'pub/sub', 'event-driven', 'microservices', 'monolith',
      'API gateway', 'service mesh', 'containerization', 'orchestration',
    ],
    'Frontend': [
      'React', 'Vue', 'Angular', 'component', 'state', 'props', 'hook', 'lifecycle',
      'rendering', 'virtual DOM', 'SSR', 'CSR', 'hydration', 'bundle', 'webpack',
      'accessibility', 'a11y', 'responsive', 'mobile-first', 'progressive enhancement',
      'CSS', 'SASS', 'styled-components', 'CSS-in-JS', 'animation', 'transition',
      'performance', 'lazy loading', 'code splitting', 'tree shaking', 'minification',
    ],
  };

  const terms = domainTerms[domain] || domainTerms['Software Engineering'];
  const termMatches = terms.filter((term) =>
    new RegExp(`\\b${term}\\b`, 'gi').test(transcript)
  );

  const terminologyScore = Math.min(5, Math.max(0, Math.round((termMatches.length / terms.length) * 10)));

  // Specificity: Count concrete metrics, numbers, and specific examples
  const numbers = (transcript.match(/\b\d+(?:\.\d+)?%?\b/g) || []).length;
  const metrics = (transcript.match(/\b(seconds|milliseconds|requests|users|queries|transactions|errors|uptime|latency|throughput|RPS|QPS|TPS)\b/gi) || []).length;
  const examples = (transcript.match(/\b(for example|for instance|specifically|such as|like|including)\b/gi) || []).length;

  const specificityScore = Math.min(5, Math.max(0, Math.round(
    2 + (numbers > 0 ? 1 : 0) + (metrics > 0 ? 1 : 0) + (examples > 0 ? 1 : 0)
  )));

  // Depth: Analyze sentence complexity and technical explanations
  const complexSentences = transcript.split(/[.!?]+/).filter((s) => {
    const words = s.trim().split(/\s+/);
    return words.length > 15 && (
      /\b(because|since|although|however|therefore|furthermore|additionally|moreover)\b/gi.test(s) ||
      /\([^)]+\)/.test(s) // Has parentheses (often technical explanations)
    );
  }).length;

  const depthScore = Math.min(5, Math.max(0, Math.round(
    2 + (complexSentences > 2 ? 1 : 0) + (termMatches.length > 5 ? 1 : 0) + (specificityScore > 3 ? 1 : 0)
  )));

  // Use LLM to assess technical accuracy (requires domain knowledge)
  const accuracyScore = await assessTechnicalAccuracy(transcript, questionTags, domain);

  return {
    terminologyScore,
    specificityScore,
    depthScore,
    accuracyScore,
  };
}

/**
 * Use LLM to assess technical accuracy
 */
async function assessTechnicalAccuracy(
  transcript: string,
  questionTags: string[],
  domain: string
): Promise<number> {
  try {
    // Enhanced prompt for technical accuracy assessment
    const response = await analyzeTranscriptBase(transcript);
    
    // Combine clarity and impact scores as proxy for technical accuracy
    // In a real implementation, you'd have a dedicated accuracy assessment
    const accuracyScore = Math.round(
      (response.clarityScore + response.impactScore) / 2
    );

    return Math.min(5, Math.max(0, accuracyScore));
  } catch (error) {
    console.error('Error assessing technical accuracy:', error);
    return 3; // Default neutral score
  }
}

/**
 * Enhanced confidence analysis with pause patterns
 */
export function analyzeConfidenceEnhanced(
  transcript: string,
  fillerCount: number,
  wordCount: number,
  wordTimestamps: Array<{ word: string; start: number; end: number }> | undefined
): number {
  let score = analyzeConfidenceFromTranscript(transcript, fillerCount, wordCount, 0);

  if (wordTimestamps && wordTimestamps.length > 0) {
    const pausePatterns = analyzePausePatterns(wordTimestamps);

    // Natural pauses boost confidence, awkward pauses reduce it
    if (pausePatterns.naturalPauses > pausePatterns.awkwardPauses) {
      score += 0.5;
    } else if (pausePatterns.awkwardPauses > pausePatterns.naturalPauses) {
      score -= 0.5;
    }

    // Good pause distribution indicates confident pacing
    score += pausePatterns.pauseDistribution / 5;
  }

  return Math.min(5, Math.max(0, Math.round(score)));
}

/**
 * Enhanced intonation analysis with emphasis patterns
 */
export function analyzeIntonationEnhanced(
  transcript: string,
  wordCount: number,
  wordTimestamps: Array<{ word: string; start: number; end: number }> | undefined
): number {
  let score = analyzeIntonationFromTranscript(transcript, wordCount);

  if (wordTimestamps && wordTimestamps.length > 0) {
    // Analyze word duration variance (longer words = more emphasis)
    const wordDurations = wordTimestamps.map((w) => w.end - w.start);
    const avgDuration = wordDurations.reduce((a, b) => a + b, 0) / wordDurations.length;
    const durationVariance =
      wordDurations.reduce((sum, d) => sum + Math.pow(d - avgDuration, 2), 0) /
      wordDurations.length;

    // Moderate variance indicates good emphasis variation
    const normalizedVariance = durationVariance / (avgDuration * avgDuration);
    if (normalizedVariance >= 0.1 && normalizedVariance <= 0.4) {
      score += 0.5;
    } else if (normalizedVariance < 0.05) {
      score -= 0.5; // Too monotone
    }
  }

  return Math.min(5, Math.max(0, Math.round(score)));
}
