// ============================================================
// Blind Model Arena — API Service
// Centralized client for Edge Function LLM proxy & Supabase DB.
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  FetchLLMParams,
  MatchRecord,
  RoundRecord,
} from '../types';

// ---------------------------------------------------------------------------
// Supabase client (lazy singleton)
// ---------------------------------------------------------------------------

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars. ' +
          'Please set them in your environment configuration.'
      );
    }

    supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  }
  return supabaseClient;
}

// ---------------------------------------------------------------------------
// Anonymous client ID (cached in localStorage)
// ---------------------------------------------------------------------------

let clientId: string | null = null;

export function getClientId(): string {
  if (!clientId) {
    const stored = localStorage.getItem('bm_client_id');
    if (stored) {
      clientId = stored;
    } else {
      clientId = crypto.randomUUID();
      localStorage.setItem('bm_client_id', clientId);
    }
  }
  return clientId;
}

// ---------------------------------------------------------------------------
// Edge Function URL
// ---------------------------------------------------------------------------

export function getEdgeFunctionUrl(): string {
  const customUrl = import.meta.env.VITE_EDGE_FUNCTION_URL;
  if (customUrl) return customUrl;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (supabaseUrl) return `${supabaseUrl}/functions/v1/llm-proxy`;

  // Fallback for projects that don't have env vars yet
  return 'https://sbqyohmjugwqlzpepeyu.supabase.co/functions/v1/llm-proxy';
}

// ---------------------------------------------------------------------------
// fetchLLM — stream a chat completion through the Edge Function
// ---------------------------------------------------------------------------

/**
 * Sends a streaming chat request to the llm-proxy Edge Function.
 * Returns the raw Response object so the caller can consume the SSE body.
 */
export async function fetchLLM(params: FetchLLMParams): Promise<Response> {
  const { model, messages, apiKey, provider, endpoint } = params;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'x-provider': provider,
  };

  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (supabaseAnonKey) {
    headers['Authorization'] = `Bearer ${supabaseAnonKey}`;
  }

  if (endpoint) {
    headers['x-endpoint'] = endpoint;
  }

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
    let errorMsg = `Edge Function returned ${response.status}`;
    try {
      const err = await response.json();
      const errVal = err?.error;
      errorMsg = typeof errVal === 'string' ? errVal : JSON.stringify(errVal) ?? errorMsg;
    } catch {
      // Use default message
    }
    throw new Error(errorMsg);
  }

  return response;
}

// ---------------------------------------------------------------------------
// saveMatch — persist match metadata to Supabase
// ---------------------------------------------------------------------------

export async function saveMatch(data: {
  total_rounds: number;
  system_prompt?: string;
  selection_mode?: string;
  pool_model_count?: number;
}): Promise<string> {
  const client = getSupabaseClient();

  const { data: row, error } = await client
    .from('matches')
    .insert({
      client_id: getClientId(),
      total_rounds: data.total_rounds,
      system_prompt: data.system_prompt ?? '',
      selection_mode: data.selection_mode ?? 'whitelist',
      pool_model_count: data.pool_model_count ?? 0,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to save match: ${error.message}`);
  return (row as { id: string }).id;
}

// ---------------------------------------------------------------------------
// saveRound — persist a single round to Supabase
// ---------------------------------------------------------------------------

export async function saveRound(data: {
  match_id: string;
  round_number: number;
  prompt: string;
  model_a_id: string;
  model_a_name: string;
  model_a_provider: string;
  model_b_id: string;
  model_b_name: string;
  model_b_provider: string;
  response_a?: string;
  response_b?: string;
  vote?: 'a' | 'b';
  decided_via_unsure?: boolean;
  tokens_a_input?: number;
  tokens_a_output?: number;
  tokens_b_input?: number;
  tokens_b_output?: number;
  time_ms_a?: number;
  time_ms_b?: number;
}): Promise<void> {
  const client = getSupabaseClient();

  const { error } = await client.from('rounds').insert({
    match_id: data.match_id,
    round_number: data.round_number,
    prompt: data.prompt,
    model_a_id: data.model_a_id,
    model_a_name: data.model_a_name,
    model_a_provider: data.model_a_provider,
    model_b_id: data.model_b_id,
    model_b_name: data.model_b_name,
    model_b_provider: data.model_b_provider,
    response_a: data.response_a ?? null,
    response_b: data.response_b ?? null,
    vote: data.vote ?? null,
    decided_via_unsure: data.decided_via_unsure ?? false,
    tokens_a_input: data.tokens_a_input ?? null,
    tokens_a_output: data.tokens_a_output ?? null,
    tokens_b_input: data.tokens_b_input ?? null,
    tokens_b_output: data.tokens_b_output ?? null,
    time_ms_a: data.time_ms_a ?? null,
    time_ms_b: data.time_ms_b ?? null,
  });

  if (error) throw new Error(`Failed to save round: ${error.message}`);
}
