import { useState, useCallback, useRef, useEffect } from 'react';
import { Heart, HelpCircle, Send, Trophy, RefreshCw, Zap, X } from 'lucide-react';
import { encode } from 'gpt-tokenizer';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { demoProvider } from '../../providers/demo';
import { fetchLLM, saveMatch, saveRound } from '../../services/api';
import type {
  MatchConfig,
  MatchState,
  RoundResult,
  ChatRequest,
  ModelInfo,
  LlmProvider,
} from '../../types';

interface MatchArenaProps {
  config: MatchConfig;
  onReveal: (state: MatchState, rounds: RoundResult[]) => void;
}

/** Pick 2 distinct models from the pool at random, then randomly assign A/B labels. */
function pickAndShuffle(pool: ModelInfo[]): { behindA: ModelInfo; behindB: ModelInfo } {
  const idx1 = Math.floor(Math.random() * pool.length);
  let idx2 = Math.floor(Math.random() * (pool.length - 1));
  if (idx2 >= idx1) idx2++;

  const [m1, m2] = [pool[idx1], pool[idx2]];
  return Math.random() < 0.5
    ? { behindA: m1, behindB: m2 }
    : { behindA: m2, behindB: m1 };
}

/** Tokenize text with gpt-tokenizer and return the token count. */
function countTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}

/** Format TPS for display — always 1 decimal place. */
function formatTps(tps: number): string {
  return tps.toFixed(1);
}

/** Consume an SSE stream from a fetch Response, yielding string deltas. */
async function* readSSEStream(
  response: Response,
): AsyncGenerator<{ content: string; done: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;

      const jsonStr = trimmed.slice(6);
      if (jsonStr === '[DONE]') {
        yield { content: '', done: true };
        return;
      }

      try {
        const json = JSON.parse(jsonStr);
        const d = json.choices?.[0]?.delta;
        const raw = d?.content || d?.reasoning || '';
        const delta = typeof raw === 'string' ? raw : '';
        if (delta) yield { content: delta, done: false };
      } catch {
        // Skip malformed chunks
      }
    }
  }

  yield { content: '', done: true };
}

export function MatchArena({ config, onReveal }: MatchArenaProps) {
  const isSpeed = config.gameMode === 'speed';
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<MatchState['phase']>('prompt');
  const [currentRound, setCurrentRound] = useState(1);
  const [rounds, setRounds] = useState<RoundResult[]>([]);
  const [scores, setScores] = useState({ a: 0, b: 0 });
  const [responseA, setResponseA] = useState('');
  const [responseB, setResponseB] = useState('');
  const [errorA, setErrorA] = useState('');
  const [errorB, setErrorB] = useState('');
  const [isStreamingA, setIsStreamingA] = useState(false);
  const [isStreamingB, setIsStreamingB] = useState(false);
  const [showUnsureInfo, setShowUnsureInfo] = useState(false);
  const [decidedViaUnsure, setDecidedViaUnsure] = useState(false);
  const [unsureUsedThisRound, setUnsureUsedThisRound] = useState(false);
  const [hearts, setHearts] = useState(3);
  const [correctGuesses, setCorrectGuesses] = useState(0);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const feedbackTid = useRef<ReturnType<typeof setTimeout>>();

  // Per-round TPS / token stats
  const [currentRoundStats, setCurrentRoundStats] = useState({
    a: { tokens: 0, timeMs: 0, tps: 0 },
    b: { tokens: 0, timeMs: 0, tps: 0 },
    inputTokens: 0,
  });

  // Track which model is behind A/B for current round
  const [shuffle, setShuffle] = useState(() => isSpeed
    ? { behindA: config.allowedModels[0] ?? { id: 'demo/gpt-4o', name: 'GPT-4o (simulated)', provider: 'openrouter' as const }, behindB: config.allowedModels[0] ?? { id: 'demo/gpt-4o', name: 'GPT-4o (simulated)', provider: 'openrouter' as const } }
    : pickAndShuffle(config.allowedModels));

  // Persistence: match ID saved on first round, reused for subsequent rounds
  const matchIdRef = useRef<string | null>(null);

  // Speed mode: track which side was actually faster this round
  const actualFasterRef = useRef<'a' | 'b'>('a');
  // Speed mode: whether providers are swapped (AMD on A) this round
  const swapRef = useRef(false);

  // Auto-show token breakdown at round_end for demo mode (standard only)
  useEffect(() => {
    if (phase === 'round_end' && config.mode === 'demo' && !isSpeed) {
      setShowUnsureInfo(true);
    }
  }, [phase, config.mode, isSpeed]);

  const isFreeMode = config.mode === 'demo';
  const roundLabel = isSpeed ? 'Provider' : isFreeMode ? 'Model' : 'Response';

  // ========== Build messages array ==========
  const buildMessages = useCallback(
    (): { role: string; content: string }[] => {
      const messages: { role: string; content: string }[] = [];
      if (config.systemPrompt) {
        messages.push({ role: 'system', content: config.systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });
      return messages;
    },
    [config.systemPrompt, prompt],
  );

  // ========== Build chat request (for demo / pollinations) ==========
  const buildRequest = useCallback(
    (model: ModelInfo): ChatRequest => {
      return {
        model,
        messages: buildMessages(),
        apiKey: config.apiKey,
        provider: config.provider ?? 'openrouter',
      };
    },
    [config, buildMessages],
  );

  // ========== Throttled streaming helpers ==========
  const flushARef = useRef<{ last: number; raf: number }>({ last: 0, raf: 0 });
  const flushBRef = useRef<{ last: number; raf: number }>({ last: 0, raf: 0 });
  const THROTTLE_MS = 50;

  function throttledSetA(text: string) {
    const now = Date.now();
    const state = flushARef.current;
    if (now - state.last >= THROTTLE_MS) {
      cancelAnimationFrame(state.raf);
      state.last = now;
      state.raf = 0;
      setResponseA(text);
    } else if (!state.raf) {
      state.raf = requestAnimationFrame(() => {
        state.raf = 0;
        state.last = Date.now();
        setResponseA(text);
      });
    }
  }

  function throttledSetB(text: string) {
    const now = Date.now();
    const state = flushBRef.current;
    if (now - state.last >= THROTTLE_MS) {
      cancelAnimationFrame(state.raf);
      state.last = now;
      state.raf = 0;
      setResponseB(text);
    } else if (!state.raf) {
      state.raf = requestAnimationFrame(() => {
        state.raf = 0;
        state.last = Date.now();
        setResponseB(text);
      });
    }
  }

  // ========== Send prompt ==========
  const handleSend = useCallback(async () => {
    if (!prompt.trim()) return;

    setPhase('responding');
    setResponseA('');
    setResponseB('');
    setErrorA('');
    setErrorB('');
    setIsStreamingA(true);
    setIsStreamingB(true);
    setShowUnsureInfo(false);
    setDecidedViaUnsure(false);
    setUnsureUsedThisRound(false);

    // Reset throttle state
    flushARef.current = { last: 0, raf: 0 };
    flushBRef.current = { last: 0, raf: 0 };

    const t0 = performance.now();
    let timeA = 0;
    let timeB = 0;

    // ---- Speed mode: real Fireworks vs AMD GPU (randomized A/B) ----
    if (isSpeed) {
      const messages = buildMessages();
      const fwKey = import.meta.env.VITE_FIREWORKS_API_KEY;
      const fwModel = import.meta.env.VITE_FIREWORKS_MODEL_ID;
      const amdUrl = import.meta.env.VITE_AMD_ENDPOINT;
      const amdKey = import.meta.env.VITE_AMD_API_KEY;
      const amdModel = import.meta.env.VITE_AMD_MODEL_ID;
      const swap = Math.random() < 0.5;
      swapRef.current = swap;

      const streamViaProxy = async (
        provider: LlmProvider, k: string, mdl: string, ep: string | undefined,
        setText: (t: string) => void,
      ): Promise<{ text: string; elapsed: number }> => {
        let text = '';
        const t1 = performance.now();
        const isAmd = provider === 'custom';
        const msgs = isAmd
          ? [...messages, { role: 'assistant' as const, content: '<think></think>' }]
          : messages;
        const res = await fetchLLM({
          model: { id: mdl, name: mdl, provider },
          messages: msgs, apiKey: k, provider, endpoint: ep,
        });
        for await (const chunk of readSSEStream(res)) {
          text += chunk.content;
          setText(text);
        }
        return { text, elapsed: performance.now() - t1 };
      };

      const aProm = streamViaProxy(
        swap ? 'custom' : 'fireworks',
        swap ? amdKey : fwKey,
        swap ? amdModel : fwModel,
        swap ? amdUrl : undefined,
        throttledSetA,
      );
      const bProm = streamViaProxy(
        swap ? 'fireworks' : 'custom',
        swap ? fwKey : amdKey,
        swap ? fwModel : amdModel,
        swap ? undefined : amdUrl,
        throttledSetB,
      );

      const [resultA, resultB] = await Promise.allSettled([aProm, bProm]);
      timeA = resultA.status === 'fulfilled' ? resultA.value.elapsed : 0;
      timeB = resultB.status === 'fulfilled' ? resultB.value.elapsed : 0;

      setIsStreamingA(false);
      setIsStreamingB(false);

      const textA = resultA.status === 'fulfilled' ? resultA.value.text : '';
      const textB = resultB.status === 'fulfilled' ? resultB.value.text : '';
      if (resultA.status === 'rejected') setErrorA(resultA.reason instanceof Error ? resultA.reason.message : 'Request failed');
      if (resultB.status === 'rejected') setErrorB(resultB.reason instanceof Error ? resultB.reason.message : 'Request failed');

      setResponseA(textA);
      setResponseB(textB);

      actualFasterRef.current = timeA < timeB ? 'a' : 'b';

      const tokensA = countTokens(textA);
      const tokensB = countTokens(textB);
      const tpsA = timeA > 0 ? tokensA / (timeA / 1000) : 0;
      const tpsB = timeB > 0 ? tokensB / (timeB / 1000) : 0;
      const inputTokens = countTokens(prompt) + (config.systemPrompt ? countTokens(config.systemPrompt) : 0);

      setCurrentRoundStats({
        a: { tokens: tokensA, timeMs: Math.round(timeA), tps: tpsA },
        b: { tokens: tokensB, timeMs: Math.round(timeB), tps: tpsB },
        inputTokens,
      });

      setPhase('voting');
      return;
    }

    // ---- BYOK mode: use Edge Function ----
    if (config.mode === 'byok') {
      const messages = buildMessages();
      const provider = (config.provider ?? 'openrouter') as LlmProvider;

      const [resultA, resultB] = await Promise.allSettled([
        (async () => {
          const res = await fetchLLM({
            model: { id: shuffle.behindA.id, name: shuffle.behindA.name, provider },
            messages,
            apiKey: config.apiKey!,
            provider,
            endpoint: config.endpoint,
          });
          let text = '';
          for await (const chunk of readSSEStream(res)) {
            text += chunk.content;
            throttledSetA(text);
          }
          timeA = performance.now() - t0;
          return text;
        })(),
        (async () => {
          const res = await fetchLLM({
            model: { id: shuffle.behindB.id, name: shuffle.behindB.name, provider },
            messages,
            apiKey: config.apiKey!,
            provider,
            endpoint: config.endpoint,
          });
          let text = '';
          for await (const chunk of readSSEStream(res)) {
            text += chunk.content;
            throttledSetB(text);
          }
          timeB = performance.now() - t0;
          return text;
        })(),
      ]);

      setIsStreamingA(false);
      setIsStreamingB(false);

      const textA = resultA.status === 'fulfilled' ? resultA.value : '';
      const textB = resultB.status === 'fulfilled' ? resultB.value : '';

      if (resultA.status === 'rejected') {
        setErrorA(resultA.reason instanceof Error ? resultA.reason.message : 'Request failed');
      }
      if (resultB.status === 'rejected') {
        setErrorB(resultB.reason instanceof Error ? resultB.reason.message : 'Request failed');
      }

      setResponseA(textA);
      setResponseB(textB);

      const tokensA = countTokens(textA);
      const tokensB = countTokens(textB);
      const tpsA = timeA > 0 ? tokensA / (timeA / 1000) : 0;
      const tpsB = timeB > 0 ? tokensB / (timeB / 1000) : 0;
      const inputTokens = countTokens(prompt) + (config.systemPrompt ? countTokens(config.systemPrompt) : 0);

      setCurrentRoundStats({
        a: { tokens: tokensA, timeMs: Math.round(timeA), tps: tpsA },
        b: { tokens: tokensB, timeMs: Math.round(timeB), tps: tpsB },
        inputTokens,
      });

      setPhase('voting');
      return;
    }

    // ---- Free mode (demo): use in-app provider ----
    const provider = demoProvider;
    const reqA = buildRequest(shuffle.behindA);
    const reqB = buildRequest(shuffle.behindB);

    const [resultA, resultB] = await Promise.allSettled([
      (async () => {
        let text = '';
        for await (const chunk of provider.chat(reqA)) {
          text += chunk.content;
          throttledSetA(text);
        }
        timeA = performance.now() - t0;
        return text;
      })(),
      (async () => {
        let text = '';
        for await (const chunk of provider.chat(reqB)) {
          text += chunk.content;
          throttledSetB(text);
        }
        timeB = performance.now() - t0;
        return text;
      })(),
    ]);

    setIsStreamingA(false);
    setIsStreamingB(false);

      const textA = resultA.status === 'fulfilled' ? resultA.value : '';
      const textB = resultB.status === 'fulfilled' ? resultB.value : '';

    if (resultA.status === 'rejected') {
      setErrorA(resultA.reason instanceof Error ? resultA.reason.message : 'Request failed');
    }
    if (resultB.status === 'rejected') {
      setErrorB(resultB.reason instanceof Error ? resultB.reason.message : 'Request failed');
    }

    setResponseA(textA);
    setResponseB(textB);

    const tokensA = countTokens(textA);
    const tokensB = countTokens(textB);
    const tpsA = timeA > 0 ? tokensA / (timeA / 1000) : 0;
    const tpsB = timeB > 0 ? tokensB / (timeB / 1000) : 0;
    const inputTokens = countTokens(prompt) + (config.systemPrompt ? countTokens(config.systemPrompt) : 0);

    setCurrentRoundStats({
      a: { tokens: tokensA, timeMs: Math.round(timeA), tps: tpsA },
      b: { tokens: tokensB, timeMs: Math.round(timeB), tps: tpsB },
      inputTokens,
    });

    setPhase('voting');
  }, [prompt, shuffle, buildRequest, buildMessages, config, isSpeed]);

  // ========== Vote ==========
  const handleVote = useCallback(
    (vote: 'a' | 'b') => {
      const finalVote = vote;

      // ---- Speed mode ----
      if (isSpeed) {
        const correct = vote === actualFasterRef.current;
        const newHearts = correct ? hearts : Math.max(0, hearts - 1);
        const newCorrect = correct ? correctGuesses + 1 : correctGuesses;

        const round: RoundResult = {
          roundNumber: currentRound,
          prompt,
          responseA,
          responseB,
          modelBehindA: shuffle.behindA,
          modelBehindB: shuffle.behindB,
          tokensA: { output: currentRoundStats.a.tokens, input: currentRoundStats.inputTokens },
          tokensB: { output: currentRoundStats.b.tokens, input: currentRoundStats.inputTokens },
          timeMsA: currentRoundStats.a.timeMs,
          timeMsB: currentRoundStats.b.timeMs,
          tpsA: currentRoundStats.a.tps,
          tpsB: currentRoundStats.b.tps,
          vote: finalVote,
          userGuess: vote,
          correctGuess: correct,
          providerLabelA: swapRef.current ? 'AMD' : 'Fireworks',
          providerLabelB: swapRef.current ? 'Fireworks' : 'AMD',
        };

        const newRounds = [...rounds, round];
        setRounds(newRounds);
        setHearts(newHearts);
        setCorrectGuesses(newCorrect);
        setFeedback(correct ? 'correct' : 'wrong');
        clearTimeout(feedbackTid.current);
        feedbackTid.current = setTimeout(() => setFeedback(null), 1000);

        if (currentRound >= config.totalRounds) {
          const state: MatchState = {
            phase: 'round_end',
            config,
            currentRound,
            rounds: newRounds,
            scores: { a: newCorrect, b: config.totalRounds - newCorrect },
            modelBehindA: shuffle.behindA,
            modelBehindB: shuffle.behindB,
            heartsRemaining: newHearts,
          };
          onReveal(state, newRounds);
        } else {
          setPhase('round_end');
        }
        return;
      }

      // ---- Standard mode ----
      const round: RoundResult = {
        roundNumber: currentRound,
        prompt,
        responseA,
        responseB,
        modelBehindA: shuffle.behindA,
        modelBehindB: shuffle.behindB,
        tokensA: { output: currentRoundStats.a.tokens, input: currentRoundStats.inputTokens },
        tokensB: { output: currentRoundStats.b.tokens, input: currentRoundStats.inputTokens },
        timeMsA: currentRoundStats.a.timeMs,
        timeMsB: currentRoundStats.b.timeMs,
        tpsA: currentRoundStats.a.tps,
        tpsB: currentRoundStats.b.tps,
        vote: finalVote,
        decidedViaUnsure,
      };

      const newRounds = [...rounds, round];
      const newScores = {
        a: scores.a + (finalVote === 'a' ? 1 : 0),
        b: scores.b + (finalVote === 'b' ? 1 : 0),
      };

      setRounds(newRounds);
      setScores(newScores);
      setDecidedViaUnsure(false);

      // ---- Persist round to Supabase ----
      (async () => {
        try {
          // Create match on first round, reuse after
          if (!matchIdRef.current) {
            matchIdRef.current = await saveMatch({
              total_rounds: config.totalRounds,
              system_prompt: config.systemPrompt,
              selection_mode: 'whitelist',
              pool_model_count: config.allowedModels.length,
            });
          }

          await saveRound({
            match_id: matchIdRef.current,
            round_number: round.roundNumber,
            prompt: round.prompt,
            model_a_id: shuffle.behindA.id,
            model_a_name: shuffle.behindA.name,
            model_a_provider: shuffle.behindA.provider,
            model_b_id: shuffle.behindB.id,
            model_b_name: shuffle.behindB.name,
            model_b_provider: shuffle.behindB.provider,
            response_a: round.responseA,
            response_b: round.responseB,
            vote: round.vote,
            decided_via_unsure: round.decidedViaUnsure ?? false,
            tokens_a_output: round.tokensA.output,
            tokens_a_input: round.tokensA.input,
            tokens_b_output: round.tokensB.output,
            tokens_b_input: round.tokensB.input,
            time_ms_a: round.timeMsA,
            time_ms_b: round.timeMsB,
          });
        } catch {
          // Silently ignore persistence errors — don't disrupt the UX
        }
      })();

      // Early win: majority threshold = floor(totalRounds/2) + 1
      const winThreshold = Math.floor(config.totalRounds / 2) + 1;
      if (newScores.a >= winThreshold || newScores.b >= winThreshold || currentRound >= config.totalRounds) {
        const state: MatchState = {
          phase: 'round_end',
          config,
          currentRound,
          rounds: newRounds,
          scores: newScores,
          modelBehindA: shuffle.behindA,
          modelBehindB: shuffle.behindB,
        };
        onReveal(state, newRounds);
      } else {
        setPhase('round_end');
      }
    },
    [
      currentRound,
      prompt,
      responseA,
      responseB,
      shuffle,
      currentRoundStats,
      rounds,
      scores,
      decidedViaUnsure,
      config,
      onReveal,
      isSpeed,
      hearts,
      correctGuesses,
    ],
  );

  // ========== Next round ==========
  const handleNextRound = useCallback(() => {
    setCurrentRound((r) => r + 1);
    setPrompt('');
    setResponseA('');
    setResponseB('');
    setPhase('prompt');
    setShowUnsureInfo(false);
    setDecidedViaUnsure(false);
    setUnsureUsedThisRound(false);
  }, []);

  // ========== Render ==========
  const isBothDone = !isStreamingA && !isStreamingB && phase === 'voting';

  return (
    <div className="h-screen overflow-hidden flex flex-col px-4 py-6" style={isSpeed ? { '--color-primary': 'oklch(0.6 0.22 30)' } as React.CSSProperties : undefined}>
      <style>{`
        @keyframes sldIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shakeH { 0%,100%{translate:0} 20%{translate:-6px} 40%{translate:6px} 60%{translate:-4px} 80%{translate:4px} }
        @keyframes glowGrn { 0%,100%{filter:drop-shadow(0 0 0 oklch(0.72 0.22 160))} 50%{filter:drop-shadow(0 0 14px oklch(0.72 0.22 160))} }
        .anim-sld { animation: sldIn 0.5s ease-out both; }
        .anim-sld-1 { animation-delay: 0.1s; }
        .anim-sld-2 { animation-delay: 0.25s; }
        .anim-shake { animation: shakeH 0.4s ease-out; }
        .anim-glow-green { animation: glowGrn 1s ease-out; }
        [style*="--color-primary"] button:hover { background-color: color-mix(in srgb, oklch(0.6 0.22 30) 85%, black) !important; }
        [style*="--color-primary"] button:active { background-color: color-mix(in srgb, oklch(0.6 0.22 30) 70%, black) !important; }
        [style*="--color-primary"] button:not(.text-on-primary):hover { color: white !important; }
      `}</style>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 max-w-6xl mx-auto w-full shrink-0">
        <div>
          <h1 className="font-heading font-bold text-xl text-foreground">Blind Model Arena</h1>
          <p className="text-sm text-foreground/50">
            Round {currentRound} / {config.totalRounds}
          </p>
        </div>

        {/* Score / Hearts */}
        {isSpeed ? (
          <div className={`flex items-center gap-1 self-center sm:self-auto text-lg ${feedback === 'wrong' ? 'anim-shake' : ''} ${feedback === 'correct' ? 'anim-glow-green' : ''}`}>
            {Array.from({ length: 3 }, (_, i) => (
              <Heart
                key={i}
                size={20}
                className={i < hearts ? 'fill-destructive text-destructive' : 'fill-none text-foreground/20'}
              />
            ))}
            <span className="ml-2 text-sm text-foreground/50 font-mono">
              {correctGuesses}/{config.totalRounds}
            </span>
          </div>
        ) : (() => {
          const aWinning = scores.a > scores.b;
          const bWinning = scores.b > scores.a;
          const aColor = aWinning ? 'text-primary' : 'text-foreground/50';
          const bColor = bWinning ? 'text-primary' : 'text-foreground/50';
          return (
            <div className="flex rounded-none border border-border divide-x divide-border self-center sm:self-auto bg-surface">
              <div className="px-4 py-2 font-heading font-bold text-base">
                <span className={aColor}>A {scores.a}</span>
              </div>
              <div className="px-4 py-2 font-heading font-bold text-base">
                <span className={bColor}>B {scores.b}</span>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Prompt Input */}
      {phase === 'prompt' && (
        <div className="max-w-6xl mx-auto w-full mb-4 shrink-0">
          <div className="flex gap-3">
            <Input
              placeholder="Enter your prompt to compare both models…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              className="flex-1"
            />
            <Button onClick={handleSend} disabled={!prompt.trim()} size="lg">
              <Send size={18} />
              Send
            </Button>
          </div>
        </div>
      )}

      {/* Response Panels */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-6xl mx-auto w-full">
        {/* Model A */}
        <Card padding="md" className={`flex flex-col min-h-0 relative rounded-none ${isStreamingA ? 'border-t-primary border-t-2' : ''}`}>
          <div className="flex items-center justify-between mb-4 shrink-0">
            <h3 className="font-heading font-semibold text-foreground uppercase tracking-widest text-sm text-foreground/80">
              {roundLabel} A
            </h3>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {errorA ? (
              <div className="text-destructive text-sm p-4 rounded-none bg-destructive/5">{errorA}</div>
            ) : responseA ? (
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{responseA}</div>
            ) : phase === 'responding' ? (
              <div className="flex items-center gap-2 text-foreground/40 text-sm font-mono uppercase tracking-wider">
                <span className="inline-block w-1.5 h-1.5 bg-primary animate-pulse" />
                Generating response…
              </div>
            ) : phase === 'prompt' ? (
              <div className="text-foreground/30 text-sm">
                Enter a prompt above to see the response here.
              </div>
            ) : (
              <div className="text-foreground/30 text-sm italic">Said nothing.</div>
            )}
          </div>
        </Card>

        {/* Model B */}
        <Card padding="md" className={`flex flex-col min-h-0 relative rounded-none ${isStreamingB ? 'border-t-primary border-t-2' : ''}`}>
          <div className="flex items-center justify-between mb-4 shrink-0">
            <h3 className="font-heading font-semibold text-foreground uppercase tracking-widest text-sm text-foreground/80">
              {roundLabel} B
            </h3>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {errorB ? (
              <div className="text-destructive text-sm p-4 rounded-none bg-destructive/5">{errorB}</div>
            ) : responseB ? (
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{responseB}</div>
            ) : phase === 'responding' ? (
              <div className="flex items-center gap-2 text-foreground/40 text-sm font-mono uppercase tracking-wider">
                <span className="inline-block w-1.5 h-1.5 bg-primary animate-pulse" />
                Generating response…
              </div>
            ) : phase === 'prompt' ? (
              <div className="text-foreground/30 text-sm">
                Enter a prompt above to see the response here.
              </div>
            ) : (
              <div className="text-foreground/30 text-sm italic">Said nothing.</div>
            )}
          </div>
        </Card>
      </div>

      {/* Voting */}
      {isBothDone && (
        <div className="max-w-6xl mx-auto w-full mt-4 shrink-0 anim-sld anim-sld-1">
          <Card padding="md" className="rounded-none border border-border">
            <div className="flex flex-col items-center gap-4">
              <p className="font-heading font-semibold text-foreground">
                {isSpeed ? 'Which came in faster?' : 'Which response was better?'}
              </p>
              <div className="flex items-center gap-3 flex-wrap justify-center">
                <Button variant="primary" onClick={() => handleVote('a')} size="lg" className="anim-sld anim-sld-1">
                  {isSpeed ? <Zap size={18} /> : <Trophy size={18} />}
                  {isSpeed ? 'A was faster' : 'Model A wins'}
                </Button>
                <Button variant="secondary" onClick={() => handleVote('b')} size="lg" className="anim-sld anim-sld-2">
                  {isSpeed ? <Zap size={18} /> : <Trophy size={18} />}
                  {isSpeed ? 'B was faster' : 'Model B wins'}
                </Button>
                {!isSpeed && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setShowUnsureInfo(true);
                      setDecidedViaUnsure(true);
                      setUnsureUsedThisRound(true);
                    }}
                    size="lg"
                    disabled={unsureUsedThisRound}
                  >
                    <HelpCircle size={18} />
                    Unsure
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* TPS & Token breakdown */}
      {!isSpeed && showUnsureInfo && (phase === 'voting' || phase === 'round_end') && (
        <div className="max-w-6xl mx-auto w-full mt-2 shrink-0 anim-sld anim-sld-2">
          <Card padding="md" className="rounded-none border border-border bg-surface">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-heading font-semibold text-sm text-foreground/50">
                Speed & Tokens — Round {currentRound}
              </h4>
              <button
                onClick={() => setShowUnsureInfo(false)}
                className="text-foreground/40 hover:text-foreground cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-6">
              {/* Model A stats */}
              <div>
                <p className="text-xs text-foreground/50 mb-2 font-heading uppercase tracking-wider">
                  {roundLabel} A
                </p>
                <div className="space-y-1 text-sm">
                  <p>
                    Output tokens:{' '}
                    <span className="font-mono">
                      {currentRoundStats.a.tokens.toLocaleString()}
                    </span>
                  </p>
                  <p>
                    Total tokens:{' '}
                    <span className="font-mono font-semibold">
                      {(currentRoundStats.a.tokens + currentRoundStats.inputTokens).toLocaleString()}
                    </span>
                  </p>
                  <p>
                    Response time:{' '}
                    <span className="font-mono">
                      {(currentRoundStats.a.timeMs / 1000).toFixed(2)}s
                    </span>
                  </p>
                  <p className="flex items-center gap-1">
                    <Zap size={14} className="text-amber-400" />
                    <span className="font-semibold">
                      {formatTps(currentRoundStats.a.tps)} tok/s
                    </span>
                  </p>
                </div>
              </div>
              {/* Model B stats */}
              <div>
                <p className="text-xs text-foreground/50 mb-2 font-heading uppercase tracking-wider">
                  {roundLabel} B
                </p>
                <div className="space-y-1 text-sm">
                  <p>
                    Output tokens:{' '}
                    <span className="font-mono">
                      {currentRoundStats.b.tokens.toLocaleString()}
                    </span>
                  </p>
                  <p>
                    Total tokens:{' '}
                    <span className="font-mono font-semibold">
                      {(currentRoundStats.b.tokens + currentRoundStats.inputTokens).toLocaleString()}
                    </span>
                  </p>
                  <p>
                    Response time:{' '}
                    <span className="font-mono">
                      {(currentRoundStats.b.timeMs / 1000).toFixed(2)}s
                    </span>
                  </p>
                  <p className="flex items-center gap-1">
                    <Zap size={14} className="text-amber-400" />
                    <span className="font-semibold">
                      {formatTps(currentRoundStats.b.tps)} tok/s
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Next round */}
      {phase === 'round_end' && (
        <div className="max-w-6xl mx-auto w-full mt-2 flex justify-center shrink-0 anim-sld anim-sld-1">
          <Button onClick={handleNextRound} size="lg">
            <RefreshCw size={18} />
            Next Round
          </Button>
        </div>
      )}
    </div>
  );
}