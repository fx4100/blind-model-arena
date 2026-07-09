// ============================================================
// Gemini Provider — BYOK, CORS status unconfirmed
// ============================================================

import type { ModelProvider, ModelInfo, ChatRequest, ChatChunk } from '../types';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const geminiProvider: ModelProvider = {
  id: 'gemini',
  name: 'Google Gemini',
  needsApiKey: true,

  async fetchModels(apiKey?: string): Promise<ModelInfo[]> {
    if (!apiKey) throw new Error('API key required');

    const res = await fetch(`${GEMINI_BASE}/models?key=${apiKey}`);

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gemini: ${res.status} ${body.slice(0, 200)}`);
    }

    const data = await res.json();

    return (data.models ?? [])
      .filter(
        (m: { name: string; supportedGenerationMethods?: string[] }) =>
          m.supportedGenerationMethods?.includes('generateContent'),
      )
      .map((m: { name: string; displayName?: string }) => ({
        id: m.name.replace('models/', ''),
        name: m.displayName ?? m.name,
        provider: 'gemini' as const,
      }));
  },

  async *chat(request: ChatRequest): AsyncGenerator<ChatChunk> {
    if (!request.apiKey) throw new Error('API key required');

    const modelId = request.model.id;

    // Convert messages to Gemini format
    const contents = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const systemInstruction = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');

    const body: Record<string, unknown> = {
      contents,
      generationConfig: { temperature: 0.7 },
    };

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    const res = await fetch(
      `${GEMINI_BASE}/models/${modelId}:generateContent?key=${request.apiKey}&alt=sse`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini: ${res.status} ${text.slice(0, 200)}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n').filter((l) => l.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6).trim();
        if (!data) continue;

        try {
          const json = JSON.parse(data);
          const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
          const text = typeof raw === 'string' ? raw : '';
          if (text) fullContent += text;
          yield { content: text, done: false };
        } catch {
          // Skip malformed chunks
        }
      }
    }

    yield { content: '', done: true };
  },
};