// ============================================================
// Blind Model Arena — Shared Types
// ============================================================

export type AppPhase = 'setup' | 'match' | 'reveal';

export type AccessMode = 'byok' | 'demo';

export type GameMode = 'standard' | 'speed';

// All supported LLM backends routed through the Edge Function
export type LlmProvider = 'openai' | 'openrouter' | 'gemini' | 'mistral' | 'fireworks' | 'custom';

// Legacy alias — still used by demo & pollinations providers
export type ProviderId = 'openrouter' | 'gemini' | 'mistral' | 'fireworks' | 'custom';

// ---------------------------------------------------------------------------
// Model / config types used across the app
// ---------------------------------------------------------------------------

export interface ModelInfo {
  id: string;
  name: string;
  provider: ProviderId;
}

export interface SpeedProviderConfig {
  provider: LlmProvider;
  apiKey: string;
  endpoint?: string;
}

export interface MatchConfig {
  mode: AccessMode;
  gameMode: GameMode;
  provider?: LlmProvider;
  apiKey?: string;
  /** Endpoint URL for custom provider */
  endpoint?: string;
  /** Speed-mode: two provider configs (Fireworks + AMD) */
  speedProviders?: [SpeedProviderConfig, SpeedProviderConfig];
  /** Pool of allowed models — two are randomly selected each round */
  allowedModels: ModelInfo[];
  systemPrompt: string;
  totalRounds: number;
  /** Demo mode: AMD GPU is reachable — use live inference instead of canned responses */
  amdAlive?: boolean;
}

// ---------------------------------------------------------------------------
// Round results (arena → reveal)
// ---------------------------------------------------------------------------

export interface RoundResult {
  roundNumber: number;
  prompt: string;
  responseA: string;
  responseB: string;
  modelBehindA: ModelInfo;
  modelBehindB: ModelInfo;
  /** Tokens computed client-side via gpt-tokenizer */
  tokensA: { output: number; input: number };
  tokensB: { output: number; input: number };
  /** Response time in milliseconds */
  timeMsA: number;
  timeMsB: number;
  /** Tokens per second (output tokens / seconds) */
  tpsA: number;
  tpsB: number;
  vote: 'a' | 'b';
  /** True when the user clicked "Unsure" to peek at cost/tokens before voting A or B. */
  decidedViaUnsure?: boolean;
  /** Speed mode: user's guess for which was faster */
  userGuess?: 'a' | 'b';
  /** Speed mode: was the guess correct */
  correctGuess?: boolean;
  /** Speed mode: provider name behind A (e.g. 'Fireworks' / 'AMD') */
  providerLabelA?: string;
  /** Speed mode: provider name behind B (e.g. 'Fireworks' / 'AMD') */
  providerLabelB?: string;
}

export interface MatchState {
  phase: 'prompt' | 'responding' | 'voting' | 'round_end';
  config: MatchConfig;
  currentRound: number;
  rounds: RoundResult[];
  scores: { a: number; b: number };
  modelBehindA: ModelInfo;
  modelBehindB: ModelInfo;
  /** Speed mode: hearts remaining (starts at 3) */
  heartsRemaining?: number;
}

// ---------------------------------------------------------------------------
// Provider abstraction (used by demo & pollinations providers only)
// ---------------------------------------------------------------------------

export interface ChatRequest {
  model: ModelInfo;
  messages: { role: string; content: string }[];
  apiKey?: string;
  provider: ProviderId;
}

export interface ChatChunk {
  content: string;
  done: boolean;
}

export interface ModelProvider {
  id: ProviderId;
  name: string;
  needsApiKey: boolean;
  fetchModels(apiKey?: string): Promise<ModelInfo[]>;
  chat(request: ChatRequest): AsyncGenerator<ChatChunk>;
}

// ---------------------------------------------------------------------------
// Edge Function request / response types
// ---------------------------------------------------------------------------

export interface EdgeFunctionRequest {
  model: string;
  messages: { role: string; content: string }[];
  stream: boolean;
}

export interface FetchLLMParams {
  model: { id: string; name: string; provider: LlmProvider };
  messages: { role: string; content: string }[];
  apiKey: string;
  provider: LlmProvider;
  endpoint?: string;
}

// ---------------------------------------------------------------------------
// Database row shapes (Supabase)
// ---------------------------------------------------------------------------

export interface MatchRecord {
  id: string;
  client_id: string;
  created_at: string;
  total_rounds: number;
  system_prompt: string;
  selection_mode: string;
  pool_model_count: number;
}

export interface RoundRecord {
  id: string;
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
  decided_via_unsure: boolean;
  tokens_a_input?: number;
  tokens_a_output?: number;
  tokens_b_input?: number;
  tokens_b_output?: number;
  time_ms_a?: number;
  time_ms_b?: number;
  created_at: string;
}