import type { FetchLLMParams } from '../types';

let clientId: string | null = null;

export function getClientId(): string {
  if (!clientId) {
    const stored = localStorage.getItem('bm_client_id');
    if (stored) { clientId = stored; }
    else { clientId = crypto.randomUUID(); localStorage.setItem('bm_client_id', clientId); }
  }
  return clientId;
}

export function getEdgeFunctionUrl(): string {
  return '/api/llm-proxy';
}

export async function fetchLLM(params: FetchLLMParams): Promise<Response> {
  const { model, messages, apiKey, provider, endpoint } = params;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-provider': provider,
  };
  if (apiKey) headers['x-api-key'] = apiKey;
  if (endpoint) headers['x-endpoint'] = endpoint;

  const response = await fetch(getEdgeFunctionUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: model.id,
      messages,
      stream: true,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    let errMsg = `Proxy returned ${response.status}`;
    try {
      const err = await response.json();
      const v = err?.error;
      errMsg = typeof v === 'string' ? v : JSON.stringify(v) ?? errMsg;
    } catch {}
    throw new Error(errMsg);
  }

  return response;
}

export async function proxySaveMatch(data: Record<string, any>): Promise<string> {
  data.client_id = getClientId();
  const res = await fetch('/api/llm-proxy?action=supabase&table=matches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`saveMatch: ${res.status}`);
  const r = await res.json();
  return (Array.isArray(r) ? r[0] : r).id;
}

export async function proxySaveRound(data: Record<string, any>): Promise<void> {
  const res = await fetch('/api/llm-proxy?action=supabase&table=rounds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`saveRound: ${res.status}`);
}

// Keep aliases for imports
export const saveMatch = proxySaveMatch;
export const saveRound = proxySaveRound;
