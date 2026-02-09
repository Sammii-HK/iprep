/**
 * Coaching configuration types and defaults
 */

export type CoachingStyle = 'encouraging' | 'strict' | 'balanced';
export type ExperienceLevel = 'junior' | 'mid' | 'senior' | 'executive';
export type FeedbackDepth = 'brief' | 'detailed' | 'comprehensive';
export type FocusArea = 'technical' | 'communication' | 'leadership' | 'all';

export interface CoachingPreferences {
  style: CoachingStyle;
  experienceLevel: ExperienceLevel;
  feedbackDepth: FeedbackDepth;
  focusAreas: FocusArea[];
  role: string;
  priorities: string[];
}

export const DEFAULT_PREFERENCES: CoachingPreferences = {
  style: 'balanced',
  experienceLevel: 'senior',
  feedbackDepth: 'detailed',
  focusAreas: ['all'],
  role: 'Senior Design Engineer / Design Engineering Leader',
  priorities: ['clarity', 'impact statements', 'technical accuracy', 'resilience', 'performance'],
};

export function getCoachingStylePrompt(style: CoachingStyle): string {
  switch (style) {
    case 'encouraging':
      return `You are an encouraging, supportive coach. Focus on what the candidate did well first, then gently suggest improvements. Use positive language and frame feedback as growth opportunities. Be warm and motivating.`;
    case 'strict':
      return `You are a rigorous, no-nonsense coach. Be direct and honest about weaknesses. Hold candidates to high standards. Point out specific mistakes clearly. Focus on what needs improvement.`;
    case 'balanced':
      return `You are a balanced, professional coach. Acknowledge strengths while being clear about areas for improvement. Be constructive and specific. Maintain a professional but supportive tone.`;
  }
}

export function getExperienceLevelContext(level: ExperienceLevel): string {
  switch (level) {
    case 'junior':
      return `This candidate is at a junior level. Focus on:
- Basic technical concepts and fundamentals
- Clear communication and structure
- Building confidence
- Learning from mistakes
- Basic STAR method understanding`;
    case 'mid':
      return `This candidate is at a mid-level. Focus on:
- Solid technical knowledge with some depth
- Effective communication and impact statements
- Problem-solving approach
- Leadership potential
- Refined STAR method usage`;
    case 'senior':
      return `This candidate is at a senior level. Expect:
- Deep technical expertise and architectural thinking
- Strong leadership and influence
- Strategic impact and business outcomes
- Mentoring and team development
- Excellent STAR method with metrics`;
    case 'executive':
      return `This candidate is at an executive level. Expect:
- Strategic vision and business acumen
- Cross-functional leadership
- Organizational impact and transformation
- High-level technical decisions
- Executive presence and communication`;
  }
}

export function getFocusAreaContext(areas: FocusArea[]): string {
  if (areas.includes('all')) {
    return `Assess all aspects: technical depth, communication clarity, leadership examples, and problem-solving approach.`;
  }
  
  const contexts: string[] = [];
  if (areas.includes('technical')) {
    contexts.push('Technical depth, accuracy, and use of appropriate terminology');
  }
  if (areas.includes('communication')) {
    contexts.push('Clarity, structure, pacing, and ability to explain complex concepts');
  }
  if (areas.includes('leadership')) {
    contexts.push('Leadership examples, team influence, decision-making, and mentorship');
  }
  
  return `Focus assessment on: ${contexts.join(', ')}.`;
}

export type PracticePreset = 'interview' | 'technical' | 'pitch' | 'meeting' | 'custom';

export interface PracticePresetConfig {
  label: string;
  description: string;
  preferences: Partial<CoachingPreferences>;
}

export const PRACTICE_PRESETS: Record<PracticePreset, PracticePresetConfig> = {
  interview: {
    label: 'Interview Prep',
    description: 'STAR-focused scoring, behavioral question emphasis',
    preferences: {
      focusAreas: ['all'],
      priorities: ['STAR structure', 'impact statements', 'specific examples', 'clear outcomes', 'metrics'],
    },
  },
  technical: {
    label: 'Technical Study',
    description: 'Terminology + accuracy weighted higher, definition-style focus',
    preferences: {
      focusAreas: ['technical'],
      priorities: ['technical accuracy', 'terminology usage', 'depth of knowledge', 'clear explanations', 'examples'],
    },
  },
  pitch: {
    label: 'Investor Pitch',
    description: 'Impact + clarity + confidence weighted higher',
    preferences: {
      focusAreas: ['communication', 'leadership'],
      priorities: ['confidence', 'impact statements', 'clarity', 'conciseness', 'persuasiveness'],
    },
  },
  meeting: {
    label: 'Meeting Prep',
    description: 'Clarity + structure focus, conciseness scoring',
    preferences: {
      focusAreas: ['communication'],
      priorities: ['clarity', 'structure', 'conciseness', 'actionable points', 'audience awareness'],
    },
  },
  custom: {
    label: 'Custom',
    description: 'Default balanced settings',
    preferences: {},
  },
};

export function getFeedbackDepthInstructions(depth: FeedbackDepth): string {
  switch (depth) {
    case 'brief':
      return `Provide concise, high-level feedback. Tips should be 10-15 words each. Focus on the most critical improvements.`;
    case 'detailed':
      return `Provide detailed, actionable feedback. Tips should be 15-20 words each. Include specific examples from the transcript.`;
    case 'comprehensive':
      return `Provide comprehensive, in-depth feedback. Tips should be 20-25 words each. Include specific examples, alternative approaches, and detailed explanations.`;
  }
}

