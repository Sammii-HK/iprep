/**
 * Which provider and model the AI calls use. One place, so the evaluator that scores an answer and the record
 * of which model scored it cannot drift apart.
 */
export interface ModelInfo {
  provider: 'deepinfra' | 'openai';
  model: string;
}

/** Chat model: Deep Infra (Llama 3.3 70B) when its key is set, else OpenAI. */
export function chatModelInfo(): ModelInfo {
  return process.env.DEEPINFRA_API_KEY
    ? { provider: 'deepinfra', model: 'meta-llama/Meta-Llama-3.3-70B-Instruct-Turbo' }
    : { provider: 'openai', model: 'gpt-4o-mini' };
}

/** Speech-to-text model for the configured provider. */
export function transcriptionModelInfo(): ModelInfo {
  return process.env.DEEPINFRA_API_KEY
    ? { provider: 'deepinfra', model: 'openai/whisper-large-v3-turbo' }
    : { provider: 'openai', model: 'whisper-1' };
}
