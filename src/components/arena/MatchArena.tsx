import { useState, useCallback, useRef, useEffect } from 'react';
import { Heart, HelpCircle, Send, Trophy, RefreshCw, Zap, X } from 'lucide-react';
import { encode } from 'gpt-tokenizer';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { demoProvider, speedChat } from '../../providers/demo';
import { fetchLLM, proxySaveMatch, proxySaveRound } from '../../services/api';
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

function pickAndShuffle(pool: ModelInfo[]): { behindA: ModelInfo; behindB: ModelInfo } {
  const idx1 = Math.floor(Math.random() * pool.length);
  let idx2 = Math.floor(Math.random() * (pool.length - 1));
  if (idx2 >= idx1) idx2++;
  const [m1, m2] = [pool[idx1], pool[idx2]];
  return Math.random() < 0.5
    ? { behindA: m1, behindB: m2 }
    : { behindA: m2, behindB: m1 };
}

function countTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}

function formatTps(tps: number): string {
  return tps.toFixed(1);
}

function renderMarkdown(md: string): string {
  let h = ''
    .concat(md)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  h = h.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/### (.+)/g, '<h3>$1</h3>');
  h = h.replace(/## (.+)/g, '<h2>$1</h2>');
  h = h.replace(/# (.+)/g, '<h1>$1</h1>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  h = h.replace(/^[\-*] (.+)/gm, '<li>$1</li>');
  h = h.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  h = h.replace(/^(\d+)\. (.+)/gm, '<li value="$1">$2</li>');
  h = h.replace(/(?:^|\n)\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/g, (_, head, body) => {
    const hs = head.split('|').filter(Boolean).map((c: string) => `<th>${c.trim()}</th>`).join('');
    const rows = body.split('\n').filter((l: string) => l.trim()).map((r: string) => {
      const cs = r.split('|').filter(Boolean).map((c: string) => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cs}</tr>`;
    }).join('');
    return `<table><thead><tr>${hs}</tr></thead><tbody>${rows}</tbody></table>`;
  });
  h = h.replace(/\n\n/g, '</p><p>');
  h = '<p>' + h + '</p>';
  return h;
}

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
      if (jsonStr === '[DONE]') { yield { content: '', done: true }; return; }
      try {
        const json = JSON.parse(jsonStr);
        const d = json.choices?.[0]?.delta;
        const raw = d?.content || d?.reasoning || '';
        const delta = typeof raw === 'string' ? raw : '';
        if (delta) yield { content: delta, done: false };
      } catch {}
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

  const [currentRoundStats, setCurrentRoundStats] = useState({
    a: { tokens: 0, timeMs: 0, tps: 0 },
    b: { tokens: 0, timeMs: 0, tps: 0 },
    inputTokens: 0,
  });

  const [shuffle, setShuffle] = useState(() => isSpeed
    ? { behindA: config.allowedModels[0] ?? { id: 'demo/gpt-4o', name: 'GPT-4o (simulated)', provider: 'openrouter' as const }, behindB: config.allowedModels[0] ?? { id: 'demo/gpt-4o', name: 'GPT-4o (simulated)', provider: 'openrouter' as const } }
    : pickAndShuffle(config.allowedModels));

  const matchIdRef = useRef<string | null>(null);
  const actualFasterRef = useRef<'a' | 'b'>('a');
  const swapRef = useRef(false);
  const amdOkRef = useRef(true);
  const fwOkRef = useRef(true);
  const [toasts, setToasts] = useState<Array<{id: number; msg: string; leaving: boolean}>>([]);
  const tidRef = useRef(0);

  function addToast(msg: string) {
    const id = ++tidRef.current;
    setToasts(p => [...p, {id, msg, leaving: false}]);
    setTimeout(() => dismissToast(id), 10000);
  }

  function dismissToast(id: number) {
    setToasts(p => p.map(t => t.id === id ? {...t, leaving: true} : t));
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 300);
  }

  // health check once on mount for speed mode
  useEffect(() => {
    if (!isSpeed) return;
    (async () => {
      try {
        const hr = await fetch('/api/llm-proxy?action=health', { method: 'GET', signal: AbortSignal.timeout(5000) });
        if (hr.ok) {
          const h = await hr.json();
          if (!h.amd) { amdOkRef.current = false; addToast('AMD GPU unreachable; using demo responses'); }
          if (!h.fireworks) { fwOkRef.current = false; addToast('Fireworks API unreachable; using demo responses'); }
          if (!h.amd && !h.fireworks) addToast('Providers unreachable; using demo responses');
        }
      } catch { amdOkRef.current = false; fwOkRef.current = false; addToast('Providers unreachable; using demo responses'); }
    })();
  }, [isSpeed]);

  useEffect(() => {
    if (phase === 'round_end' && config.mode === 'demo' && !isSpeed) {
      setShowUnsureInfo(true);
    }
  }, [phase, config.mode, isSpeed]);

  const isFreeMode = config.mode === 'demo';
  const roundLabel = isSpeed ? 'Provider' : isFreeMode ? 'Model' : 'Response';

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

  const buildRequest = useCallback(
    (model: ModelInfo): ChatRequest => {
      return { model, messages: buildMessages(), apiKey: config.apiKey, provider: config.provider ?? 'openrouter' };
    },
    [config, buildMessages],
  );

  const flushARef = useRef<{ last: number; raf: number }>({ last: 0, raf: 0 });
  const flushBRef = useRef<{ last: number; raf: number }>({ last: 0, raf: 0 });
  const THROTTLE_MS = 50;

  function throttledSetA(text: string) {
    const now = Date.now();
    const state = flushARef.current;
    if (now - state.last >= THROTTLE_MS) {
      cancelAnimationFrame(state.raf);
      state.last = now; state.raf = 0;
      setResponseA(text);
    } else if (!state.raf) {
      state.raf = requestAnimationFrame(() => { state.raf = 0; state.last = Date.now(); setResponseA(text); });
    }
  }

  function throttledSetB(text: string) {
    const now = Date.now();
    const state = flushBRef.current;
    if (now - state.last >= THROTTLE_MS) {
      cancelAnimationFrame(state.raf);
      state.last = now; state.raf = 0;
      setResponseB(text);
    } else if (!state.raf) {
      state.raf = requestAnimationFrame(() => { state.raf = 0; state.last = Date.now(); setResponseB(text); });
    }
  }

  const handleSend = useCallback(async () => {
    if (!prompt.trim()) return;
    setPhase('responding');
    setResponseA(''); setResponseB('');
    setErrorA(''); setErrorB('');
    setIsStreamingA(true); setIsStreamingB(true);
    setShowUnsureInfo(false);
    setDecidedViaUnsure(false);
    setUnsureUsedThisRound(false);
    flushARef.current = { last: 0, raf: 0 };
    flushBRef.current = { last: 0, raf: 0 };

    const t0 = performance.now();
    let timeA = 0, timeB = 0;

    // ---- Speed mode: real Fireworks vs AMD GPU (randomized A/B) ----
    if (isSpeed) {
      const messages = buildMessages();
      const swap = Math.random() < 0.5;
      swapRef.current = swap;

      const streamViaProxy = async (
        provider: LlmProvider,
        setText: (t: string) => void,
      ): Promise<{ text: string; elapsed: number }> => {
        // preresponse fallback if provider is down
        if ((provider === 'custom' && !amdOkRef.current) || (provider === 'fireworks' && !fwOkRef.current)) {
          let text = '';
          const t1 = performance.now();
          for await (const chunk of speedChat(true)) {
            text += chunk.content;
            setText(text);
          }
          return { text, elapsed: performance.now() - t1 };
        }
        let text = '';
        const t1 = performance.now();
        const res = await fetchLLM({
          model: { id: 'gpt-oss-20b', name: 'gpt-oss-20b', provider },
          messages, provider,
        });
        for await (const chunk of readSSEStream(res)) {
          text += chunk.content;
          setText(text);
        }
        return { text, elapsed: performance.now() - t1 };
      };

      const aProm = streamViaProxy(swap ? 'custom' : 'fireworks', throttledSetA);
      const bProm = streamViaProxy(swap ? 'fireworks' : 'custom', throttledSetB);

      const [resultA, resultB] = await Promise.allSettled([aProm, bProm]);
      timeA = resultA.status === 'fulfilled' ? resultA.value.elapsed : 0;
      timeB = resultB.status === 'fulfilled' ? resultB.value.elapsed : 0;

      setIsStreamingA(false); setIsStreamingB(false);
      const textA = resultA.status === 'fulfilled' ? resultA.value.text : '';
      const textB = resultB.status === 'fulfilled' ? resultB.value.text : '';
      if (resultA.status === 'rejected') setErrorA(resultA.reason instanceof Error ? resultA.reason.message : 'Request failed');
      if (resultB.status === 'rejected') setErrorB(resultB.reason instanceof Error ? resultB.reason.message : 'Request failed');
      setResponseA(textA); setResponseB(textB);

      const tokensA = countTokens(textA);
      const tokensB = countTokens(textB);
      const tpsA = timeA > 0 ? tokensA / (timeA / 1000) : 0;
      const tpsB = timeB > 0 ? tokensB / (timeB / 1000) : 0;
      actualFasterRef.current = tpsA > tpsB ? 'a' : 'b';
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
          const res = await fetchLLM({ model: { id: shuffle.behindA.id, name: shuffle.behindA.name, provider }, messages, apiKey: config.apiKey!, provider, endpoint: config.endpoint });
          let text = '';
          for await (const chunk of readSSEStream(res)) { text += chunk.content; throttledSetA(text); }
          timeA = performance.now() - t0;
          return text;
        })(),
        (async () => {
          const res = await fetchLLM({ model: { id: shuffle.behindB.id, name: shuffle.behindB.name, provider }, messages, apiKey: config.apiKey!, provider, endpoint: config.endpoint });
          let text = '';
          for await (const chunk of readSSEStream(res)) { text += chunk.content; throttledSetB(text); }
          timeB = performance.now() - t0;
          return text;
        })(),
      ]);

      setIsStreamingA(false); setIsStreamingB(false);
      const textA = resultA.status === 'fulfilled' ? resultA.value : '';
      const textB = resultB.status === 'fulfilled' ? resultB.value : '';
      if (resultA.status === 'rejected') setErrorA(resultA.reason instanceof Error ? resultA.reason.message : 'Request failed');
      if (resultB.status === 'rejected') setErrorB(resultB.reason instanceof Error ? resultB.reason.message : 'Request failed');
      setResponseA(textA); setResponseB(textB);

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

    // ---- Demo mode: per-model routing (AMD-backed or simulated) ----
    let textA = '', textB = '';

    const streamFromBackend = async (
      model: ModelInfo,
      setText: (t: string) => void,
    ): Promise<{ text: string; elapsed: number }> => {
      if (config.amdAlive && model.provider === 'custom') {
        const messages = buildMessages();
        let txt = '';
        const t1 = performance.now();
        const res = await fetchLLM({
          model: { id: 'openai/gpt-oss-20b', name: 'gpt-oss-20b', provider: 'custom' },
          messages, provider: 'custom',
        });
        for await (const chunk of readSSEStream(res)) { txt += chunk.content; setText(txt); }
        return { text: txt, elapsed: performance.now() - t1 };
      }
      const req = buildRequest(model);
      let txt = '';
      const t1 = performance.now();
      for await (const chunk of demoProvider.chat(req)) { txt += chunk.content; setText(txt); }
      return { text: txt, elapsed: performance.now() - t1 };
    };

    const [resA, resB] = await Promise.allSettled([
      streamFromBackend(shuffle.behindA, throttledSetA),
      streamFromBackend(shuffle.behindB, throttledSetB),
    ]);
    timeA = resA.status === 'fulfilled' ? resA.value.elapsed : 0;
    timeB = resB.status === 'fulfilled' ? resB.value.elapsed : 0;

    setIsStreamingA(false); setIsStreamingB(false);
    textA = resA.status === 'fulfilled' ? resA.value.text : '';
    textB = resB.status === 'fulfilled' ? resB.value.text : '';
    if (resA.status === 'rejected') setErrorA(resA.reason instanceof Error ? resA.reason.message : 'Request failed');
    if (resB.status === 'rejected') setErrorB(resB.reason instanceof Error ? resB.reason.message : 'Request failed');
    setResponseA(textA); setResponseB(textB);

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

  const handleVote = useCallback(
    (vote: 'a' | 'b') => {
      const finalVote = vote;
      if (isSpeed) {
        const correct = vote === actualFasterRef.current;
        const newHearts = correct ? hearts : Math.max(0, hearts - 1);
        const newCorrect = correct ? correctGuesses + 1 : correctGuesses;

        const round: RoundResult = {
          roundNumber: currentRound, prompt, responseA, responseB,
          modelBehindA: shuffle.behindA, modelBehindB: shuffle.behindB,
          tokensA: { output: currentRoundStats.a.tokens, input: currentRoundStats.inputTokens },
          tokensB: { output: currentRoundStats.b.tokens, input: currentRoundStats.inputTokens },
          timeMsA: currentRoundStats.a.timeMs, timeMsB: currentRoundStats.b.timeMs,
          tpsA: currentRoundStats.a.tps, tpsB: currentRoundStats.b.tps,
          vote: finalVote, userGuess: vote, correctGuess: correct,
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
          onReveal({ phase: 'round_end', config, currentRound, rounds: newRounds, scores: { a: newCorrect, b: config.totalRounds - newCorrect }, modelBehindA: shuffle.behindA, modelBehindB: shuffle.behindB, heartsRemaining: newHearts }, newRounds);
        } else { setPhase('round_end'); }
        return;
      }

      // ---- Standard mode ----
      const round: RoundResult = {
        roundNumber: currentRound, prompt, responseA, responseB,
        modelBehindA: shuffle.behindA, modelBehindB: shuffle.behindB,
        tokensA: { output: currentRoundStats.a.tokens, input: currentRoundStats.inputTokens },
        tokensB: { output: currentRoundStats.b.tokens, input: currentRoundStats.inputTokens },
        timeMsA: currentRoundStats.a.timeMs, timeMsB: currentRoundStats.b.timeMs,
        tpsA: currentRoundStats.a.tps, tpsB: currentRoundStats.b.tps,
        vote: finalVote, decidedViaUnsure,
      };

      const newRounds = [...rounds, round];
      const newScores = { a: scores.a + (finalVote === 'a' ? 1 : 0), b: scores.b + (finalVote === 'b' ? 1 : 0) };
      setRounds(newRounds);
      setScores(newScores);
      setDecidedViaUnsure(false);

      (async () => {
        try {
          if (!matchIdRef.current) {
            matchIdRef.current = await proxySaveMatch({ total_rounds: config.totalRounds, system_prompt: config.systemPrompt, selection_mode: 'whitelist', pool_model_count: config.allowedModels.length });
          }
          await proxySaveRound({
            match_id: matchIdRef.current, round_number: round.roundNumber, prompt: round.prompt,
            model_a_id: shuffle.behindA.id, model_a_name: shuffle.behindA.name, model_a_provider: shuffle.behindA.provider,
            model_b_id: shuffle.behindB.id, model_b_name: shuffle.behindB.name, model_b_provider: shuffle.behindB.provider,
            response_a: round.responseA, response_b: round.responseB, vote: round.vote,
            decided_via_unsure: round.decidedViaUnsure ?? false,
            tokens_a_output: round.tokensA.output, tokens_a_input: round.tokensA.input,
            tokens_b_output: round.tokensB.output, tokens_b_input: round.tokensB.input,
            time_ms_a: round.timeMsA, time_ms_b: round.timeMsB,
          });
        } catch {}
      })();

      const winThreshold = Math.floor(config.totalRounds / 2) + 1;
      if (newScores.a >= winThreshold || newScores.b >= winThreshold || currentRound >= config.totalRounds) {
        onReveal({ phase: 'round_end', config, currentRound, rounds: newRounds, scores: newScores, modelBehindA: shuffle.behindA, modelBehindB: shuffle.behindB }, newRounds);
      } else { setPhase('round_end'); }
    },
    [currentRound, prompt, responseA, responseB, shuffle, currentRoundStats, rounds, scores, decidedViaUnsure, config, onReveal, isSpeed, hearts, correctGuesses],
  );

  const handleNextRound = useCallback(() => {
    setCurrentRound((r) => r + 1);
    setPrompt(''); setResponseA(''); setResponseB('');
    setPhase('prompt'); setShowUnsureInfo(false);
    setDecidedViaUnsure(false); setUnsureUsedThisRound(false);
  }, []);

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

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 max-w-6xl mx-auto w-full shrink-0">
        <div>
          <h1 className="font-heading font-bold text-xl text-foreground">Blind Model Arena</h1>
          <p className="text-sm text-foreground/50">Round {currentRound} / {config.totalRounds}</p>
        </div>
        {isSpeed ? (
          <div className={`flex items-center gap-1 self-center sm:self-auto text-lg ${feedback === 'wrong' ? 'anim-shake' : ''} ${feedback === 'correct' ? 'anim-glow-green' : ''}`}>
            {Array.from({ length: 3 }, (_, i) => (
              <Heart key={i} size={20} className={i < hearts ? 'fill-destructive text-destructive' : 'fill-none text-foreground/20'} />
            ))}
            <span className="ml-2 text-sm text-foreground/50 font-mono">{correctGuesses}/{config.totalRounds}</span>
          </div>
        ) : (() => {
          const aW = scores.a > scores.b; const bW = scores.b > scores.a;
          return (
            <div className="flex rounded-none border border-border divide-x divide-border self-center sm:self-auto bg-surface">
              <div className="px-4 py-2 font-heading font-bold text-base"><span className={aW ? 'text-primary' : 'text-foreground/50'}>A {scores.a}</span></div>
              <div className="px-4 py-2 font-heading font-bold text-base"><span className={bW ? 'text-primary' : 'text-foreground/50'}>B {scores.b}</span></div>
            </div>
          );
        })()}
      </div>

      {phase === 'prompt' && (
        <div className="max-w-6xl mx-auto w-full mb-4 shrink-0">
          <div className="flex gap-3">
            <Input placeholder="Enter your prompt to compare both models…" value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} className="flex-1" />
            <Button onClick={handleSend} disabled={!prompt.trim()} size="lg"><Send size={18} /> Send</Button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-6xl mx-auto w-full">
        <Card padding="md" className={`flex flex-col min-h-0 relative rounded-none ${isStreamingA ? 'border-t-primary border-t-2' : ''}`}>
          <div className="flex items-center justify-between mb-4 shrink-0">
            <h3 className="font-heading font-semibold text-foreground uppercase tracking-widest text-sm text-foreground/80">{roundLabel} A</h3>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {errorA ? <div className="text-destructive text-sm p-4 rounded-none bg-destructive/5">{errorA}</div> :
            responseA ? <div className="text-sm leading-relaxed [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-1.5 [&_th]:bg-muted [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5 [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-x-auto [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_pre_code]:bg-transparent [&_pre_code]:p-0" dangerouslySetInnerHTML={{ __html: renderMarkdown(responseA) }}></div> :
            phase === 'responding' ? <div className="flex items-center gap-2 text-foreground/40 text-sm font-mono uppercase tracking-wider"><span className="inline-block w-1.5 h-1.5 bg-primary animate-pulse" /> Generating response…</div> :
            phase === 'prompt' ? <div className="text-foreground/30 text-sm">Enter a prompt above to see the response here.</div> :
            <div className="text-foreground/30 text-sm italic">Said nothing.</div>}
          </div>
        </Card>
        <Card padding="md" className={`flex flex-col min-h-0 relative rounded-none ${isStreamingB ? 'border-t-primary border-t-2' : ''}`}>
          <div className="flex items-center justify-between mb-4 shrink-0">
            <h3 className="font-heading font-semibold text-foreground uppercase tracking-widest text-sm text-foreground/80">{roundLabel} B</h3>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {errorB ? <div className="text-destructive text-sm p-4 rounded-none bg-destructive/5">{errorB}</div> :
            responseB ? <div className="text-sm leading-relaxed [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-1.5 [&_th]:bg-muted [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5 [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded [&_pre]:overflow-x-auto [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_pre_code]:bg-transparent [&_pre_code]:p-0" dangerouslySetInnerHTML={{ __html: renderMarkdown(responseB) }}></div> :
            phase === 'responding' ? <div className="flex items-center gap-2 text-foreground/40 text-sm font-mono uppercase tracking-wider"><span className="inline-block w-1.5 h-1.5 bg-primary animate-pulse" /> Generating response…</div> :
            phase === 'prompt' ? <div className="text-foreground/30 text-sm">Enter a prompt above to see the response here.</div> :
            <div className="text-foreground/30 text-sm italic">Said nothing.</div>}
          </div>
        </Card>
      </div>

      {isBothDone && (
        <div className="max-w-6xl mx-auto w-full mt-4 shrink-0 anim-sld anim-sld-1">
          <Card padding="md" className="rounded-none border border-border">
            <div className="flex flex-col items-center gap-4">
              <p className="font-heading font-semibold text-foreground">{isSpeed ? 'Which came in faster?' : 'Which response was better?'}</p>
              <div className="flex items-center gap-3 flex-wrap justify-center">
                <Button variant="primary" onClick={() => handleVote('a')} size="lg" className="anim-sld anim-sld-1">{isSpeed ? <Zap size={18} /> : <Trophy size={18} />} {isSpeed ? 'A was faster' : 'Model A wins'}</Button>
                <Button variant="secondary" onClick={() => handleVote('b')} size="lg" className="anim-sld anim-sld-2">{isSpeed ? <Zap size={18} /> : <Trophy size={18} />} {isSpeed ? 'B was faster' : 'Model B wins'}</Button>
                {!isSpeed && <Button variant="ghost" onClick={() => { setShowUnsureInfo(true); setDecidedViaUnsure(true); setUnsureUsedThisRound(true); }} size="lg" disabled={unsureUsedThisRound}><HelpCircle size={18} /> Unsure</Button>}
              </div>
            </div>
          </Card>
        </div>
      )}

      {!isSpeed && showUnsureInfo && (phase === 'voting' || phase === 'round_end') && (
        <div className="max-w-6xl mx-auto w-full mt-2 shrink-0 anim-sld anim-sld-2">
          <Card padding="md" className="rounded-none border border-border bg-surface">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-heading font-semibold text-sm text-foreground/50">Speed & Tokens — Round {currentRound}</h4>
              <button onClick={() => setShowUnsureInfo(false)} className="text-foreground/40 hover:text-foreground cursor-pointer"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs text-foreground/50 mb-2 font-heading uppercase tracking-wider">{roundLabel} A</p>
                <div className="space-y-1 text-sm">
                  <p>Output tokens: <span className="font-mono">{currentRoundStats.a.tokens.toLocaleString()}</span></p>
                  <p>Total tokens: <span className="font-mono font-semibold">{(currentRoundStats.a.tokens + currentRoundStats.inputTokens).toLocaleString()}</span></p>
                  <p>Response time: <span className="font-mono">{(currentRoundStats.a.timeMs / 1000).toFixed(2)}s</span></p>
                  <p className="flex items-center gap-1"><Zap size={14} className="text-amber-400" /><span className="font-semibold">{formatTps(currentRoundStats.a.tps)} tok/s</span></p>
                </div>
              </div>
              <div>
                <p className="text-xs text-foreground/50 mb-2 font-heading uppercase tracking-wider">{roundLabel} B</p>
                <div className="space-y-1 text-sm">
                  <p>Output tokens: <span className="font-mono">{currentRoundStats.b.tokens.toLocaleString()}</span></p>
                  <p>Total tokens: <span className="font-mono font-semibold">{(currentRoundStats.b.tokens + currentRoundStats.inputTokens).toLocaleString()}</span></p>
                  <p>Response time: <span className="font-mono">{(currentRoundStats.b.timeMs / 1000).toFixed(2)}s</span></p>
                  <p className="flex items-center gap-1"><Zap size={14} className="text-amber-400" /><span className="font-semibold">{formatTps(currentRoundStats.b.tps)} tok/s</span></p>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {phase === 'round_end' && (
        <div className="max-w-6xl mx-auto w-full mt-2 flex justify-center shrink-0 anim-sld anim-sld-1">
          <Button onClick={handleNextRound} size="lg"><RefreshCw size={18} /> Next Round</Button>
        </div>
      )}

      {/* toasts */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map(t => (
          <div key={t.id} className={`bg-black/70 backdrop-blur-sm border border-red-500/60 text-red-400 text-sm px-4 py-3 rounded shadow-lg flex items-start gap-2 transition-opacity duration-300 ${t.leaving ? 'opacity-0' : 'opacity-100'}`}>
            <span className="flex-1">{t.msg}</span>
            <button onClick={() => dismissToast(t.id)} className="text-red-400/60 hover:text-red-400 shrink-0 cursor-pointer"><X size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
