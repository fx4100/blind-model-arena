// ============================================================
// Puter.js Provider — Free tier, no API key needed
// Uses @heyputer/puter.js npm package (lazy-loaded to avoid
// network errors on initial page load if puter is unreachable).
// ============================================================

import type { ModelProvider, ModelInfo, ChatRequest, ChatChunk } from '../types';

// Lazy reference to the puter.js module — only loaded on first use
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _puter: any = null;

async function getPuter() {
  if (!_puter) {
    const mod = await import('@heyputer/puter.js');
    _puter = mod.default ?? mod;
  }
  return _puter;
}

// Default fallback models if listModels() fails
const PUTER_MODELS: ModelInfo[] = [
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openrouter' },
  { id: 'claude-3-haiku', name: 'Claude 3 Haiku', provider: 'openrouter' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'openrouter' },
  { id: 'llama-3.1-8b', name: 'Llama 3.1 8B', provider: 'openrouter' },
];

/** Timeout wrapper: rejects after `ms` if promise doesn't settle */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Timed out')), ms),
    ),
  ]);
}

/** Turn a raw model id into a human-friendly label */
function formatModelName(id: string): string {
  return id
    .replace(/^openrouter\//i, '')
    .replace(/^google\//i, '')
    .replace(/^anthropic\//i, '')
    .replace(/^meta-llama\//i, '')
    .replace(/^mistralai\//i, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const puterProvider: ModelProvider = {
  id: 'openrouter',
  name: 'Puter.js (Free)',
  needsApiKey: false,

  async fetchModels(): Promise<ModelInfo[]> {
    try {
      const puter = await getPuter();
      // 8-second timeout so the UI never freezes indefinitely
      const models = await withTimeout(puter.ai.listModels(), 8000);
      if (models && models.length > 0) {
        return models.map((m: { id: string }) => ({
          id: typeof m.id === 'string' ? m.id : String(m.id ?? ''),
          name: formatModelName(typeof m.id === 'string' ? m.id : String(m.id ?? '')),
          provider: 'openrouter' as const,
        }));
      }
    } catch {
      // Fall through to defaults
    }
    return PUTER_MODELS;
  },

  async *chat(request: ChatRequest): AsyncGenerator<ChatChunk> {
    const userMessage = request.messages.filter((m) => m.role === 'user').pop();
    const systemMessage = request.messages.filter((m) => m.role === 'system').pop();

    let prompt = userMessage?.content ?? '';

    if (systemMessage?.content) {
      prompt = `[System: ${systemMessage.content}]\n\n${prompt}`;
    }

    try {
      const puter = await getPuter();
      const reply = await puter.ai.chat(prompt, { model: request.model.id });
      const content: string = typeof reply === 'string' ? reply : reply?.message?.content ?? '';

      yield {
        content,
        done: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error from puter.js';
      throw new Error(`puter.js: ${message}`);
    }
  },
};