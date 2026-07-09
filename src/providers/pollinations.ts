// ============================================================
// Pollinations.ai Provider — Free tier, no API key needed
// OpenAI-compatible endpoint with SSE streaming support.
// ============================================================

import type { ModelProvider, ModelInfo, ChatRequest, ChatChunk } from '../types';

const POLLINATIONS_BASE = 'https://text.pollinations.ai/openai';

// Hardcoded fallback models if the /models endpoint is unreachable
const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'openai', name: 'OpenAI (GPT-4o-mini)', provider: 'openrouter' },
  { id: 'openai-large', name: 'OpenAI Large (GPT-4o)', provider: 'openrouter' },
  { id: 'claude-hybridspace', name: 'Claude Hybridspace', provider: 'openrouter' },
  { id: 'gemini', name: 'Gemini 2.0 Flash', provider: 'openrouter' },
  { id: 'mistral', name: 'Mistral', provider: 'openrouter' },
  { id: 'deepseek', name: 'DeepSeek V3', provider: 'openrouter' },
];

/** Turn a raw model id into a human-friendly label */
function formatModelName(id: string): string {
  return id
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const pollinationsProvider: ModelProvider = {
  id: 'openrouter',
  name: 'Pollinations.ai (Free)',
  needsApiKey: false,

  async fetchModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch('https://text.pollinations.ai/models');

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: unknown[] = await res.json();

      if (Array.isArray(data) && data.length > 0) {
        return data
          .filter((m: Record<string, unknown>) => m.type === 'chat' || typeof m.name === 'string')
          .map((m: Record<string, unknown>) => ({
            id: typeof m.name === 'string' ? m.name : typeof m.id === 'string' ? m.id : '',
            name: formatModelName(typeof m.name === 'string' ? m.name : typeof m.id === 'string' ? m.id : ''),
            provider: 'openrouter' as const,
          }));
      }
    } catch {
      // Fall through to defaults
    }
    return FALLBACK_MODELS;
  },

  async *chat(request: ChatRequest): AsyncGenerator<ChatChunk> {
    const res = await fetch(`${POLLINATIONS_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model.id,
        messages: request.messages,
        stream: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Pollinations.ai: ${res.status} ${body.slice(0, 200)}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n').filter((l) => l.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const json = JSON.parse(data);
          const raw = json.choices?.[0]?.delta?.content;
          const delta = typeof raw === 'string' ? raw : '';
          if (delta) yield { content: delta, done: false };
        } catch {
          // Skip malformed chunks
        }
      }
    }

    yield { content: '', done: true };
  },
};