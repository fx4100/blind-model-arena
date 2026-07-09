// ============================================================
// Mistral Provider — BYOK, CORS status unconfirmed
// ============================================================

import type { ModelProvider, ModelInfo, ChatRequest, ChatChunk } from '../types';

const MISTRAL_API = 'https://api.mistral.ai/v1';

export const mistralProvider: ModelProvider = {
  id: 'mistral',
  name: 'Mistral AI',
  needsApiKey: true,

  async fetchModels(apiKey?: string): Promise<ModelInfo[]> {
    if (!apiKey) throw new Error('API key required');

    const res = await fetch(`${MISTRAL_API}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Mistral: ${res.status} ${body.slice(0, 200)}`);
    }

    const data = await res.json();

    return (data.data ?? []).map((m: { id: string; name?: string }) => ({
      id: typeof m.id === 'string' ? m.id : String(m.id ?? ''),
      name: typeof m.name === 'string' ? m.name : String(m.id ?? ''),
      provider: 'mistral' as const,
    }));
  },

  async *chat(request: ChatRequest): AsyncGenerator<ChatChunk> {
    if (!request.apiKey) throw new Error('API key required');

    const res = await fetch(`${MISTRAL_API}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
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
      throw new Error(`Mistral: ${res.status} ${body.slice(0, 200)}`);
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
          yield { content: delta, done: false };
        } catch {
          // Skip malformed chunks
        }
      }
    }

    yield { content: '', done: true };
  },
};