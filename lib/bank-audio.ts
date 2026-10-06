import { createHash } from 'crypto';

/**
 * Pure helpers for building a bank's spoken study episode.
 * No network or filesystem access here so everything is unit-testable.
 */

/** Bump when the script wording or voice settings change, to force regeneration. */
export const EPISODE_FORMAT_VERSION = 1;

export const TTS_MODEL = 'hexgrad/Kokoro-82M';
/** British English female voice, clear coach register. */
export const DEFAULT_VOICE = 'bf_emma';
/** DeepInfra list price for Kokoro-82M, USD per 1M input characters (see podify README). */
export const KOKORO_USD_PER_MILLION_CHARS = 0.62;
/** Approximate conversion used for estimates only. */
export const GBP_PER_USD = 0.8;
/** Kokoro requests are chunked to stay well inside the request size limits. */
export const MAX_CHUNK_CHARS = 1200;
export const DEFAULT_THINKING_PAUSE_SECONDS = 4;

export interface EpisodeQuestion {
  text: string;
  hint: string | null;
}

export type EpisodeSegment =
  | { kind: 'speech'; text: string }
  | { kind: 'pause'; seconds: number };

export interface EpisodeScript {
  segments: EpisodeSegment[];
  /** Characters actually sent to TTS (speech segments only). */
  characters: number;
  /** Plain-text transcript of the episode. */
  transcript: string;
}

/** Em and en dashes read badly and are banned from copy we write ourselves. */
function removeDashes(value: string): string {
  return value.replace(/\s*[–—]\s*/g, ', ');
}

/** Make a bank title pleasant to hear. Only touches our own framing, never stored hints. */
export function spokenTitle(title: string): string {
  return removeDashes(title)
    .replace(/\s*\/\s*/g, ' or ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Collapse runs of whitespace without changing the words. */
function tidy(value: string): string {
  return value.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

export function buildEpisodeScript(
  bankTitle: string,
  questions: EpisodeQuestion[],
  options: { pauseSeconds?: number } = {}
): EpisodeScript {
  const pauseSeconds = options.pauseSeconds ?? DEFAULT_THINKING_PAUSE_SECONDS;
  const title = spokenTitle(bankTitle);
  const segments: EpisodeSegment[] = [];
  const transcript: string[] = [];

  const speak = (text: string) => {
    segments.push({ kind: 'speech', text });
    transcript.push(text);
  };

  const count = questions.length;
  speak(
    `${title}. ${count} ${count === 1 ? 'question' : 'questions'}. ` +
      'For each one you will hear the question, a short pause to answer out loud, and then your answer notes.'
  );
  segments.push({ kind: 'pause', seconds: 1.2 });

  questions.forEach((q, index) => {
    speak(`Question ${index + 1}.`);
    segments.push({ kind: 'pause', seconds: 0.4 });
    // Question text and answer hints are read exactly as stored.
    speak(tidy(q.text));
    segments.push({ kind: 'pause', seconds: pauseSeconds });
    const hint = q.hint ? tidy(q.hint) : '';
    if (hint) {
      speak('Answer notes.');
      segments.push({ kind: 'pause', seconds: 0.4 });
      speak(hint);
    } else {
      speak('There are no answer notes for this one.');
    }
    segments.push({ kind: 'pause', seconds: 1.5 });
  });

  speak(`That is the end of ${title}.`);

  const characters = segments.reduce(
    (sum, s) => (s.kind === 'speech' ? sum + s.text.length : sum),
    0
  );

  return { segments, characters, transcript: transcript.join('\n\n') };
}

/** Split text into chunks of at most maxChars, breaking on paragraph then sentence boundaries. */
export function chunkText(text: string, maxChars: number = MAX_CHUNK_CHARS): string[] {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];

  const pieces = clean
    .split(/\n+/)
    .flatMap((paragraph) => paragraph.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g) ?? [paragraph]);

  const chunks: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const piece of pieces) {
    let remaining = piece.trim();
    if (!remaining) continue;
    // A single sentence longer than the limit: split on spaces.
    while (remaining.length > maxChars) {
      let cut = remaining.lastIndexOf(' ', maxChars);
      if (cut <= 0) cut = maxChars;
      flush();
      chunks.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    if (current && current.length + 1 + remaining.length > maxChars) flush();
    current = current ? `${current} ${remaining}` : remaining;
  }
  flush();
  return chunks;
}

export function estimateCost(characters: number): { usd: number; gbp: number; pence: number } {
  const usd = (characters / 1_000_000) * KOKORO_USD_PER_MILLION_CHARS;
  const gbp = usd * GBP_PER_USD;
  return { usd, gbp, pence: gbp * 100 };
}

/** Hash of everything that affects the audio. Changes when questions, hints, voice or format change. */
export function episodeSourceHash(
  script: EpisodeScript,
  voice: string = DEFAULT_VOICE
): string {
  return createHash('sha256')
    .update(JSON.stringify({ v: EPISODE_FORMAT_VERSION, model: TTS_MODEL, voice, segments: script.segments }))
    .digest('hex');
}

export interface EpisodeMeta {
  sourceHash: string;
  voice: string;
  model: string;
  characters: number;
  questionCount: number;
  generatedAt: string;
}

export type EpisodeDecision = 'generate' | 'skip-up-to-date' | 'skip-unmanaged' | 'regenerate';

/**
 * Decide what to do for a bank.
 * - no mp3: generate
 * - mp3 with our sidecar and same hash: skip
 * - mp3 with our sidecar and different hash: regenerate
 * - mp3 with no sidecar (made by another tool): leave it alone unless forced
 */
export function decideEpisodeAction(
  existing: { hasAudio: boolean; meta: EpisodeMeta | null },
  sourceHash: string,
  force = false
): EpisodeDecision {
  if (!existing.hasAudio) return 'generate';
  if (force) return 'regenerate';
  if (!existing.meta) return 'skip-unmanaged';
  return existing.meta.sourceHash === sourceHash ? 'skip-up-to-date' : 'regenerate';
}
