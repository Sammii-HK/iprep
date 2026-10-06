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
  style?: 'dialogue' | 'narrator';
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

// ============================================================
// Dialogue style (default): two hosts, Jess and Zac, scripted by Podify and voiced by Orpheus.
// ============================================================

export type EpisodeStyle = 'dialogue' | 'narrator';
export const DEFAULT_STYLE: EpisodeStyle = 'dialogue';

export const DIALOGUE_VOICES = 'orpheus_jess_zac';
export const DIALOGUE_TTS_MODEL = 'canopylabs/orpheus-3b-0.1-ft';
export const DEFAULT_DIALOGUE_MINUTES = 10;
/** DeepInfra list price for Orpheus, USD per 1M input characters. */
export const ORPHEUS_USD_PER_MILLION_CHARS = 7.0;
export const WORDS_PER_MINUTE = 150;
export const CHARS_PER_WORD = 6;
/** Small allowance for the Podify script LLM (DeepInfra), per episode. */
export const SCRIPT_LLM_ALLOWANCE_USD = 0.01;

/** Host names that must never appear: they belong to another show. */
export const BANNED_HOST_NAMES = ['Luna', 'Sol'] as const;
/** Brand terms that must not appear unless the source notes themselves use them. */
export const BANNED_BRAND_TERMS = ['The Grimoire', 'Lunary'] as const;

export const SOURCE_RULES =
  'SOURCE RULES FOR THE HOSTS: This is private interview preparation for one person, Samantha. ' +
  'Use ONLY the facts written in the notes below. Do not invent figures, dates, employers, names, tools or outcomes, ' +
  'and do not add claims about her that are not in the notes. If a note says something is unknown or "check before quoting", say so. ' +
  'The two hosts are Jess and Zac. Do not call them any other names. Never use the names Luna or Sol. ' +
  'Do not name any podcast, show or brand of your own, and never mention The Grimoire. ' +
  'Make it a real conversation: they react to each other, challenge each other, and talk through how to answer each question out loud. ' +
  'UK English. No dashes used as punctuation.\n\n';

export function buildDialogueNotes(questions: EpisodeQuestion[]): string {
  return questions
    .map((q, i) => `Question ${i + 1}: ${tidy(q.text)}` + (q.hint ? `\nAnswer notes: ${tidy(q.hint)}` : ''))
    .join('\n\n');
}

export function buildDialogueSource(questions: EpisodeQuestion[]): { notes: string; source: string } {
  const notes = buildDialogueNotes(questions);
  return { notes, source: SOURCE_RULES + notes };
}

export function estimateDialogueCost(minutes: number = DEFAULT_DIALOGUE_MINUTES) {
  const characters = Math.round(minutes * WORDS_PER_MINUTE * CHARS_PER_WORD);
  const usd = (characters / 1_000_000) * ORPHEUS_USD_PER_MILLION_CHARS + SCRIPT_LLM_ALLOWANCE_USD;
  const gbp = usd * GBP_PER_USD;
  return { characters, usd, gbp, pence: gbp * 100 };
}

/** Hash of everything that decides the dialogue episode: the notes, the rules, host voices, length. */
export function dialogueSourceHash(source: string, minutes: number = DEFAULT_DIALOGUE_MINUTES): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        style: 'dialogue',
        v: EPISODE_FORMAT_VERSION,
        model: DIALOGUE_TTS_MODEL,
        voices: DIALOGUE_VOICES,
        minutes,
        source,
      })
    )
    .digest('hex');
}

/** Host names or brand terms in the transcript that should fail the bank. */
export function findBannedNames(transcript: string, notes: string): string[] {
  const found: string[] = [];
  for (const name of BANNED_HOST_NAMES) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(transcript)) found.push(name);
  }
  for (const term of BANNED_BRAND_TERMS) {
    const re = new RegExp(`\\b${term}\\b`, 'i');
    if (re.test(transcript) && !re.test(notes)) found.push(term);
  }
  return found;
}

function numberTokens(text: string): Set<string> {
  const tokens = text.match(/\d[\d,.]*/g) ?? [];
  const out = new Set<string>();
  for (const t of tokens) {
    const clean = t.replace(/[,.]+$/, '').replace(/,/g, '');
    if (clean) out.add(clean);
  }
  return out;
}

/**
 * Numbers spoken in the transcript that do not appear in the source notes.
 * Question numbers (1..questionCount) are allowed because the hosts count through the questions.
 */
export function findUnsupportedNumbers(transcript: string, notes: string, questionCount = 0): string[] {
  const allowed = numberTokens(notes);
  for (let i = 1; i <= questionCount; i++) allowed.add(String(i));
  return [...numberTokens(transcript)].filter((n) => !allowed.has(n)).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

export interface DialogueCheck {
  ok: boolean;
  bannedNames: string[];
  unsupportedNumbers: string[];
  hasDashes: boolean;
}

export function checkDialogueTranscript(transcript: string, notes: string, questionCount: number): DialogueCheck {
  const bannedNames = findBannedNames(transcript, notes);
  const unsupportedNumbers = findUnsupportedNumbers(transcript, notes, questionCount);
  return {
    ok: bannedNames.length === 0 && unsupportedNumbers.length === 0,
    bannedNames,
    unsupportedNumbers,
    hasDashes: /[–—]/.test(transcript),
  };
}

export interface LocalState {
  sourceHash: string;
  status: 'ok' | 'needs-review';
}

export type BankAction =
  | 'generate'
  | 'regenerate'
  | 'upload-local'
  | 'skip-up-to-date'
  | 'skip-local-ready'
  | 'skip-needs-review'
  | 'skip-unmanaged';

/**
 * Local-first decision. Remote (R2) up to date always wins; then a matching local render is reused
 * (uploaded only with --upload, never regenerated); otherwise fall back to the remote decision.
 */
export function decideBankAction(opts: {
  remote: { hasAudio: boolean; meta: { sourceHash: string } | null };
  local: LocalState | null;
  hash: string;
  force: boolean;
  upload: boolean;
}): BankAction {
  const { remote, local, hash, force, upload } = opts;
  if (!force) {
    if (remote.meta?.sourceHash === hash) return 'skip-up-to-date';
    if (local && local.sourceHash === hash) {
      if (local.status === 'needs-review') return 'skip-needs-review';
      return upload ? 'upload-local' : 'skip-local-ready';
    }
  }
  return decideEpisodeAction({ hasAudio: remote.hasAudio, meta: remote.meta as EpisodeMeta | null }, hash, force);
}
