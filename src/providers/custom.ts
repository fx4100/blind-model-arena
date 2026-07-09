// ============================================================
// Custom Provider — User-supplied OpenAI-compatible endpoint
// ============================================================

import type { ModelProvider, ModelInfo, ChatRequest, ChatChunk } from '../types';

export function createCustomProvider(endpoint: string): ModelProvider {
  // Ensure endpoint doesn't end with slash
  const base = endpoint.replace(/\/+$/, '');

  return {
    id: 'custom',
    name: 'Custom Endpoint',
    needsApiKey: true,

    async fetchModels(apiKey?: string): Promise<ModelInfo[]> {
      if (!apiKey) throw new Error('API key required');

      const res = await fetch(`${base}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Custom: ${res.status} ${body.slice(0, 200)}`);
      }

      const data = await res.json();
      const models = data.data ?? data.models ?? data;

      return (Array.isArray(models) ? models : [models]).map((m: { id: string; name?: string }) => ({
        id: typeof m.id === 'string' ? m.id : String(m),
        name: typeof m.name === 'string' ? m.name : String(m.id ?? m),
        provider: 'custom' as const,
      }));
    },

    async *chat(request: ChatRequest): AsyncGenerator<ChatChunk> {
      if (!request.apiKey) throw new Error('API key required');

      const res = await fetch(`${base}/chat/completions`, {
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
        throw new Error(`Custom: ${res.status} ${body.slice(0, 200)}`);
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
}