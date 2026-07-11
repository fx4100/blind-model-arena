import { useState, useEffect, useRef, useMemo } from 'react';
import { RefreshCw, Trophy, Zap, ChevronDown, ChevronUp, Crown } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import type { RoundResult, ModelInfo } from '../../types';

interface RevealScreenProps {
  rounds: RoundResult[];
  scores: { a: number; b: number };
  onPlayAgain: () => void;
  gameMode?: 'standard' | 'speed';
  heartsRemaining?: number;
}

const AMD_ARROW = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAwIDEwMDAiPjxwYXRoIGQ9Ik00Ni4xLDc3NS4zVjU5Ny4xbDI1NC40LTI1NC40djM1Ni41aDM1Ni41TDQwMi43LDk1My42SDQ2LjFWNzc1LjN6IE04MjkuNyw4MjIuN2wtMTIzLTEyM1YyOTQuMUgzMDEuMUw1My40LDQ2LjRoODk5LjlsMC4xLDQ0NS41bDAuNCw0NDcuOGMwLjEsMS40LDAsMi44LTAuNCw0LjJDOTUyLjksOTQ1LjMsOTIwLjgsOTEzLjgsODI5LjcsODIyLjdMODI5LjcsODIyLjd6Ii8+PC9zdmc+';

const FW_LOGO = 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/fireworks.svg';

function provLogo(prov: string): string {
  return prov === 'Fireworks' ? FW_LOGO : AMD_ARROW;
}

const MODEL_LOGOS: [RegExp, string][] = [
  [/claude|sonnet|haiku|opus|fable/i, 'https://cdn.simpleicons.org/anthropic/383c4a'],
  [/mistral/i, 'https://cdn.simpleicons.org/mistralai/383c4a'],
  [/gemini/i, 'https://cdn.simpleicons.org/googlegemini/383c4a'],
  [/gpt|o\d/i, 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openai.svg'],
  [/llama/i, 'https://cdn.simpleicons.org/meta/383c4a'],
  [/deepseek/i, 'https://cdn.simpleicons.org/deepseek/383c4a'],
  [/qwen/i, 'https://cdn.simpleicons.org/qwen/383c4a'],
  [/fireworks/i, FW_LOGO],
  [/amd|radeon/i, AMD_ARROW],
];

function getModelLogoUrl(model: ModelInfo): string | null {
  for (const [re, url] of MODEL_LOGOS) {
    if (re.test(model.id) || re.test(model.name)) return url;
  }
  return null;
}

function tallyModelVotes(
  rounds: RoundResult[],
): Map<string, { model: ModelInfo; votes: number }> {
  const map = new Map<string, { model: ModelInfo; votes: number }>();
  for (const r of rounds) {
    if (r.vote === 'a') {
      const m = r.modelBehindA;
      if (!map.has(m.id)) map.set(m.id, { model: m, votes: 0 });
      map.get(m.id)!.votes++;
    } else if (r.vote === 'b') {
      const m = r.modelBehindB;
      if (!map.has(m.id)) map.set(m.id, { model: m, votes: 0 });
      map.get(m.id)!.votes++;
    }
  }
  return map;
}

function formatTps(tps: number): string {
  return tps.toFixed(1);
}

interface ModelSpeedStats {
  model: ModelInfo;
  outputTokens: number;
  totalTokens: number;
  totalTimeMs: number;
  avgTps: number;
  appearances: number;
}

function tallyModelSpeed(rounds: RoundResult[]): Map<string, ModelSpeedStats> {
  const map = new Map<string, ModelSpeedStats>();
  for (const r of rounds) {
    for (const side of ['a', 'b'] as const) {
      const model = side === 'a' ? r.modelBehindA : r.modelBehindB;
      const tokens = side === 'a' ? r.tokensA : r.tokensB;
      const timeMs = side === 'a' ? r.timeMsA : r.timeMsB;

      let entry = map.get(model.id);
      if (!entry) {
        entry = { model, outputTokens: 0, totalTokens: 0, totalTimeMs: 0, avgTps: 0, appearances: 0 };
        map.set(model.id, entry);
      }
      entry.outputTokens += tokens.output;
      entry.totalTokens += tokens.output + tokens.input;
      entry.totalTimeMs += timeMs;
      entry.appearances++;
    }
  }
  for (const stats of map.values()) {
    stats.avgTps = stats.totalTimeMs > 0 ? stats.outputTokens / (stats.totalTimeMs / 1000) : 0;
  }
  return map;
}

export function RevealScreen({ rounds, scores, onPlayAgain, gameMode = 'standard', heartsRemaining }: RevealScreenProps) {
  const isSpeed = gameMode === 'speed';

  // Speed mode stats
  const correctCount = isSpeed ? rounds.filter(r => r.correctGuess).length : 0;
  const wrongCount = isSpeed ? rounds.length - correctCount : 0;
  const survived = isSpeed ? (heartsRemaining ?? 0) > 0 : false;

  // Model vote tally (standard mode)
  const modelVotes = isSpeed ? new Map() : tallyModelVotes(rounds);
  const sortedByVotes = isSpeed ? [] : [...modelVotes.values()].sort((a, b) => b.votes - a.votes);
  const winner = sortedByVotes.length > 0 ? sortedByVotes[0] : null;
  const runnerUp = sortedByVotes.length > 1 ? sortedByVotes[1] : null;

  const modelSpeed = tallyModelSpeed(rounds);
  const speedEntries = [...modelSpeed.values()];

  const totalVotes = scores.a + scores.b;

  const [fasterProv, slowerProv] = useMemo(() => {
    if (!isSpeed) return [null, null] as const;
    let fwWins = 0;
    let amdWins = 0;
    for (const r of rounds) {
      const fwSide = r.providerLabelA === 'Fireworks' ? 'a' : 'b';
      const faster = r.timeMsA < r.timeMsB ? 'a' : 'b';
      if (faster === fwSide) fwWins++;
      else amdWins++;
    }
    const fast = fwWins >= amdWins ? 'Fireworks' : 'AMD';
    const slow = fwWins >= amdWins ? 'AMD' : 'Fireworks';
    return [fast, slow] as const;
  }, [rounds, isSpeed]);

  const topModel = isSpeed ? rounds[0]?.modelBehindA ?? null : winner?.model ?? null;
  const secondModel = isSpeed ? rounds[0]?.modelBehindB ?? null : runnerUp?.model ?? null;

  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(new Set());
  const [bgReady, setBgReady] = useState(false);
  const meteorRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setBgReady(true), 200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!bgReady) return;
    const isDark = document.documentElement.classList.contains('dark');
    let url: string | null = null;
    if (isSpeed && fasterProv) {
      url = provLogo(fasterProv);
    } else if (topModel) {
      url = getModelLogoUrl(topModel);
    }
    if (!url) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;

    const canvas = meteorRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const metCnt = () => Math.min(40, Math.max(8, Math.floor((canvas.width * canvas.height) / 60000)));
    const metSpd = () => 2.5 + Math.random() * 2.5;
    const metSz = () => 24 + Math.random() * 20;

    interface Met {
      x: number; y: number; vx: number; vy: number; sz: number; op: number; rot: number;
    }

    let mets: Met[] = [];
    let aid: number;

    const spawn = () => {
      const max = metCnt();
      const cw = canvas.width;
      while (mets.length < max) {
        const sz = metSz();
        const spd = metSpd();
        mets.push({
          x: -sz - Math.random() * cw * 0.6,
          y: -sz - Math.random() * ch * 0.5,
          vx: spd * 1.1,
          vy: spd,
          sz,
          op: 0.12 + Math.random() * 0.2,
          rot: Math.atan2(1, 1.1),
        });
      }
    };

    const ch = canvas.height;

    img.onload = () => {
      spawn();

      const loop = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (const m of mets) {
          m.x += m.vx;
          m.y += m.vy;

          ctx.save();
          ctx.globalAlpha = m.op;
          if (isDark) ctx.filter = 'invert(1)';
          ctx.translate(m.x, m.y);
          ctx.rotate(m.rot);
          ctx.drawImage(img, -m.sz / 2, -m.sz / 2, m.sz, m.sz);
          ctx.restore();
        }

        // remove off-screen
        mets = mets.filter(m => m.x < canvas.width + 100 && m.y < canvas.height + 100);

        // keep refilled
        spawn();

        aid = requestAnimationFrame(loop);
      };
      loop();
    };

    return () => {
      cancelAnimationFrame(aid);
      window.removeEventListener('resize', resize);
    };
  }, [bgReady, topModel, isSpeed, fasterProv]);

  const toggleRound = (n: number) => {
    setExpandedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  return (
    <div className="min-h-screen flex flex-col px-4 py-8 relative overflow-hidden bg-background" style={isSpeed ? { '--color-primary': 'oklch(0.6 0.22 30)' } as React.CSSProperties : undefined}>
      <style>{`
        @keyframes sldIn {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes sldInBg {
          from { opacity: 0; transform: translateY(40px) rotate(-6deg); }
          to   { opacity: 1; transform: translateY(0) rotate(0deg); }
        }
        @keyframes rolSlw {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes glowPulse {
          0%, 100% { filter: drop-shadow(0 0 12px oklch(0.63 0.19 255 / 0.3)); }
          50%      { filter: drop-shadow(0 0 28px oklch(0.63 0.19 255 / 0.6)); }
        }
        .anim-sld { animation: sldIn 0.6s ease-out both; }
        .anim-sld-1 { animation-delay: 0.1s; }
        .anim-sld-2 { animation-delay: 0.25s; }
        .anim-sld-3 { animation-delay: 0.4s; }
        .anim-sld-4 { animation-delay: 0.55s; }
        .anim-sld-5 { animation-delay: 0.7s; }
        .anim-glow { animation: glowPulse 2.5s ease-in-out infinite; }
        [style*="--color-primary"] button:hover { background-color: color-mix(in srgb, oklch(0.6 0.22 30) 85%, black) !important; }
        [style*="--color-primary"] button:active { background-color: color-mix(in srgb, oklch(0.6 0.22 30) 70%, black) !important; }
        [style*="--color-primary"] button:not(.text-on-primary):hover { color: white !important; }
      `}</style>

      {/* Background model logos */}
      {bgReady && (isSpeed || topModel) && (
        <div className="fixed inset-0 pointer-events-none z-0 flex flex-col items-center justify-start pt-[6vh] gap-[18vh] select-none">
          <div className="anim-sld-bg" style={{
            animation: 'sldInBg 1s ease-out 0.3s both, rolSlw 45s linear 1.3s infinite',
          }}>
            <img
              src={isSpeed ? provLogo(fasterProv ?? 'Fireworks') : (getModelLogoUrl(topModel!) ?? '')}
              alt=""
              className="w-48 h-48 opacity-[0.04] grayscale"
            />
          </div>
          <div className="anim-sld-bg" style={{
            animation: 'sldInBg 1s ease-out 0.6s both, rolSlw 45s linear 1.6s infinite reverse',
          }}>
            <img
              src={isSpeed ? provLogo(slowerProv ?? 'AMD') : (getModelLogoUrl(secondModel ?? topModel!) ?? '')}
              alt=""
              className="w-48 h-48 opacity-[0.04] grayscale"
            />
          </div>
        </div>
      )}

      <canvas ref={meteorRef} className="fixed inset-0 pointer-events-none z-[1]" />

      <div className="max-w-3xl mx-auto w-full relative z-10">

        {/* ====== HEADER ====== */}
        <div className="text-center mb-8 anim-sld anim-sld-1">
          <div className="relative inline-block">
            {isSpeed ? (
              <Zap size={52} className="mx-auto mb-3 text-amber-400 anim-glow" />
            ) : (
              <Trophy size={52} className="mx-auto mb-3 text-primary anim-glow" />
            )}
          </div>
          <h1 className="font-heading text-3xl font-bold text-foreground mb-2 uppercase tracking-wider">
            {isSpeed ? 'Catch the Speeder' : 'Match Complete'}
          </h1>
          {isSpeed ? (
            <>
              <p className="text-xl text-foreground/70 mb-1">
                {survived ? (
                  <>
                    <span className="font-heading font-semibold text-amber-400">Survived!</span>{' '}
                    <span className="text-foreground/60">with {heartsRemaining} heart{heartsRemaining !== 1 ? 's' : ''} remaining</span>
                  </>
                ) : (
                  <>
                    <span className="font-heading font-semibold text-destructive">Eliminated</span>{' '}
                    <span className="text-foreground/60">— lost all hearts</span>
                  </>
                )}
              </p>
              <p className="text-sm text-foreground/40">
                {correctCount} correct{wrongCount > 0 ? ` · ${wrongCount} wrong` : ''} · {rounds.length} rounds
              </p>
            </>
          ) : winner ? (
            <>
              <p className="text-xl text-foreground/70 mb-1">
                <Crown size={20} className="inline text-yellow-500 align-text-top mr-1" />
                <span className="font-heading font-semibold text-primary">
                  {winner.model.name}
                </span>{' '}
                won with{' '}
                <span className="font-semibold">{winner.votes}</span> vote
                {winner.votes !== 1 ? 's' : ''}
              </p>
              {runnerUp && (
                <p className="text-sm text-foreground/40">
                  Runner-up: {runnerUp.model.name} with {runnerUp.votes} vote
                  {runnerUp.votes !== 1 ? 's' : ''}
                </p>
              )}
            </>
          ) : (
            <p className="text-xl text-foreground/70">
              No winner — the match ended without votes
            </p>
          )}
        </div>

        {/* ====== SCORE BAR ====== */}
        <div className="mb-6 anim-sld anim-sld-2">
          <Card padding="lg" className="rounded-none border border-border">
            <h2 className="font-heading font-semibold text-lg mb-4 text-foreground">
              {isSpeed ? 'Guesses' : 'Score'}
            </h2>
            {isSpeed ? (
              <>
                <div className="h-8 w-full rounded-none bg-muted overflow-hidden flex">
                  {correctCount > 0 && (
                    <div
                      className="h-full bg-emerald-500 transition-all duration-700 flex items-center justify-center text-xs font-bold text-on-primary truncate px-1"
                      style={{ width: `${(correctCount / rounds.length) * 100}%` }}
                    >
                      Correct {correctCount}
                    </div>
                  )}
                  {wrongCount > 0 && (
                    <div
                      className="h-full bg-destructive/40 flex-1 transition-all duration-700 flex items-center justify-center text-xs font-bold text-foreground truncate px-1"
                    >
                      Wrong {wrongCount}
                    </div>
                  )}
                </div>
                <div className="flex justify-between text-xs text-foreground/50 mt-1">
                  {correctCount > 0 && (
                    <span className="text-emerald-400 font-semibold">
                      Correct — {correctCount}/{rounds.length}
                    </span>
                  )}
                  {wrongCount > 0 && (
                    <span className="text-foreground/50">
                      Wrong — {wrongCount}/{rounds.length}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="h-8 w-full rounded-none bg-muted overflow-hidden flex">
                  {sortedByVotes.length > 0 && (
                    <div
                      className="h-full bg-primary transition-all duration-700 flex items-center justify-center text-xs font-bold text-on-primary truncate px-1"
                      style={{ width: `${sortedByVotes.length > 1 ? (sortedByVotes[0].votes / (sortedByVotes[0].votes + sortedByVotes[1].votes)) * 100 : 100}%` }}
                    >
                      {sortedByVotes[0].model.name} {sortedByVotes[0].votes}
                    </div>
                  )}
                  {sortedByVotes.length > 1 && sortedByVotes[1].votes > 0 && (
                    <div
                      className="h-full bg-foreground/20 flex-1 transition-all duration-700 flex items-center justify-center text-xs font-bold text-foreground truncate px-1"
                    >
                      {sortedByVotes[1].model.name} {sortedByVotes[1].votes}
                    </div>
                  )}
                </div>
                <div className="flex justify-between text-xs text-foreground/50 mt-1">
                  {sortedByVotes.length > 0 && (
                    <span className="anim-sld anim-sld-1 text-primary font-semibold truncate mr-2">
                      {sortedByVotes[0].model.name} — {sortedByVotes[0].votes} vote{sortedByVotes[0].votes !== 1 ? 's' : ''}
                    </span>
                  )}
                  {sortedByVotes.length > 1 && sortedByVotes[1].votes > 0 && (
                    <span className="anim-sld anim-sld-2 text-foreground/50 truncate">
                      {sortedByVotes[1].model.name} — {sortedByVotes[1].votes} vote{sortedByVotes[1].votes !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </>
            )}
          </Card>
        </div>

        {/* ====== ROUND TIMELINE ====== */}
        <div className="mb-6 anim-sld anim-sld-3">
          <Card padding="lg" className="rounded-none border border-border">
            <h2 className="font-heading font-semibold text-lg mb-4 text-foreground">Timeline</h2>
            <div className="flex justify-center items-center">
              {rounds.map((r, i) => {
                const isCorrect = isSpeed ? r.correctGuess : r.vote === 'a';
                const cls = isCorrect ? 'border-emerald-500 bg-emerald-500' : 'border-destructive bg-destructive';
                return (
                  <div key={r.roundNumber} className="flex items-center">
                    <div className="flex flex-col items-center w-8">
                      <div
                        className={`w-5 h-5 rounded-full border-2 ${cls} flex items-center justify-center text-[10px] font-bold text-on-primary cursor-pointer transition-all hover:scale-125`}
                        onClick={() => toggleRound(r.roundNumber)}
                        title={`Round ${r.roundNumber}: ${isSpeed ? (r.correctGuess ? 'Correct' : 'Wrong') : isCorrect ? 'A won' : 'B won'}`}
                      >
                        {r.roundNumber}
                      </div>
                      <span className={`text-[10px] mt-1 font-heading ${isCorrect ? 'text-emerald-400' : 'text-destructive'}`}>
                        {isSpeed ? (r.correctGuess ? '✓' : '✗') : isCorrect ? 'A' : 'B'}
                      </span>
                    </div>
                    {i < rounds.length - 1 && (
                      <div className="w-6 h-px bg-gradient-to-r from-foreground/20 via-foreground/40 to-foreground/20" />
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* ====== SPEED SUMMARY ====== */}
        <div className="mb-6 anim-sld anim-sld-4">
          <Card padding="lg" className="rounded-none border border-border">
            <h2 className="font-heading font-semibold text-lg mb-4 flex items-center gap-2 text-foreground">
              <Zap size={20} className="text-primary" />
              Speed
            </h2>
            {isSpeed ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {(() => {
                  const provMap = new Map<string, { tps: number; cnt: number; logo: string }>();
                  for (const r of rounds) {
                    const a = provMap.get(r.providerLabelA!) ?? { tps: 0, cnt: 0, logo: provLogo(r.providerLabelA ?? 'Fireworks') };
                    a.tps += r.tpsA; a.cnt++;
                    provMap.set(r.providerLabelA!, a);
                    const b = provMap.get(r.providerLabelB!) ?? { tps: 0, cnt: 0, logo: provLogo(r.providerLabelB ?? 'AMD') };
                    b.tps += r.tpsB; b.cnt++;
                    provMap.set(r.providerLabelB!, b);
                  }
                  const provs = [...provMap.entries()].map(([name, d]) => ({
                    name, avgTps: d.cnt > 0 ? d.tps / d.cnt : 0, logo: d.logo,
                  })).sort((a, b) => b.avgTps - a.avgTps);
                  const max = Math.max(...provs.map(p => p.avgTps), 1);
                  return provs.map((p) => (
                    <div key={p.name} className="p-4 rounded-none bg-surface border border-border">
                      <div className="flex items-center gap-2 mb-3">
                        <img src={p.logo} alt="" className="w-4 h-4 shrink-0 theme-logo" />
                        <p className="font-heading font-semibold text-sm text-primary truncate">{p.name}</p>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div>
                          <p className="text-xs text-foreground/50 uppercase tracking-wider">Avg TPS</p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-2 rounded-none bg-muted overflow-hidden">
                              <div className="h-full bg-primary rounded-none transition-all duration-700" style={{ width: `${(p.avgTps / max) * 100}%` }} />
                            </div>
                            <span className="font-heading font-semibold text-sm text-foreground shrink-0">{formatTps(p.avgTps)} tok/s</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {speedEntries.sort((a, b) => b.avgTps - a.avgTps).map((s, i, arr) => {
                  const maxTps = arr[0]?.avgTps || 1;
                  const barPct = (s.avgTps / maxTps) * 100;
                  return (
                    <div key={s.model.id} className="p-4 rounded-none bg-surface border border-border">
                      <div className="flex items-center gap-2 mb-3">
                        {getModelLogoUrl(s.model) && (
                          <img src={getModelLogoUrl(s.model)!} alt="" className="w-4 h-4 shrink-0 theme-logo" />
                        )}
                        <p className="font-heading font-semibold text-sm text-primary truncate">{s.model.name}</p>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div>
                          <p className="text-xs text-foreground/50 uppercase tracking-wider">Avg TPS</p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-2 rounded-none bg-muted overflow-hidden">
                              <div className="h-full bg-primary rounded-none transition-all duration-700" style={{ width: `${barPct}%` }} />
                            </div>
                            <span className="font-heading font-semibold text-sm text-foreground shrink-0">{formatTps(s.avgTps)} tok/s</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* ====== ROUND BY ROUND ====== */}
        <div className="mb-8 anim-sld anim-sld-5">
          <Card padding="lg" className="rounded-none border border-border">
            <h2 className="font-heading font-semibold text-lg mb-4 text-foreground">Round by Round</h2>
            <div className="space-y-0">
              {rounds.map((round, ri) => {
                const isAWin = round.vote === 'a';
                const isExpanded = expandedRounds.has(round.roundNumber);
                const isCorrect = isSpeed ? round.correctGuess : undefined;
                return (
                  <div key={round.roundNumber}>
                    {ri > 0 && <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent my-0" />}
                    <div className={`py-4 ${ri === 0 ? 'pt-0' : ''} ${ri === rounds.length - 1 ? 'pb-0' : ''}`}>
                      {/* Round header */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-heading text-sm font-semibold text-foreground">
                            Round {round.roundNumber}
                          </span>
                          {isSpeed ? (
                            <Badge variant={isCorrect ? 'success' : 'error'}>
                              {isCorrect ? 'Correct' : 'Wrong'}
                            </Badge>
                          ) : (
                            <Badge variant={isAWin ? 'success' : 'info'}>
                              {isAWin ? 'A won' : 'B won'}
                              {round.decidedViaUnsure && ' (unsure)'}
                            </Badge>
                          )}
                        </div>
                        {!isSpeed && (
                          <span className="text-xs text-foreground/40 font-heading flex items-center gap-1">
                            <Zap size={12} />
                            <span className="text-foreground">{formatTps(Math.max(round.tpsA, round.tpsB))} tok/s</span>
                          </span>
                        )}
                      </div>

                      {/* Models A & B */}
                      <div className="grid grid-cols-2 gap-4 text-xs mb-2">
                        <div className={`p-2 rounded-none ${isSpeed ? (round.timeMsA < round.timeMsB ? 'bg-amber-500/5 border-l-2 border-amber-500' : '') : (isAWin ? 'bg-primary/5 border-l-2 border-primary' : '')}`}>
                          <div className="flex items-center gap-1.5 mb-1">
                            {isSpeed ? (
                              <img src={provLogo(round.providerLabelA ?? 'Fireworks')} alt="" className="w-3.5 h-3.5 shrink-0 theme-logo" />
                            ) : getModelLogoUrl(round.modelBehindA) && (
                              <img src={getModelLogoUrl(round.modelBehindA)!} alt="" className="w-3.5 h-3.5 shrink-0 theme-logo" />
                            )}
                            <span className="font-heading font-medium text-foreground truncate">
                              {isSpeed ? round.providerLabelA : round.modelBehindA.name}
                            </span>
                            {isSpeed ? (
                              round.timeMsA < round.timeMsB && <Zap size={10} className="text-amber-400 shrink-0" />
                            ) : (isAWin && <Trophy size={10} className="text-primary shrink-0" />)}
                          </div>
                          <p className="text-foreground/50">
                            {isSpeed ? (
                              <>{formatTps(round.tpsA)} tok/s · {(round.timeMsA / 1000).toFixed(2)}s</>
                            ) : (
                              <>{round.tokensA.output.toLocaleString()} out · {formatTps(round.tpsA)} tok/s</>
                            )}
                          </p>
                        </div>
                        <div className={`p-2 rounded-none ${isSpeed ? (round.timeMsB < round.timeMsA ? 'bg-amber-500/5 border-l-2 border-amber-500' : '') : (!isAWin ? 'bg-primary/5 border-l-2 border-primary' : '')}`}>
                          <div className="flex items-center gap-1.5 mb-1">
                            {isSpeed ? (
                              <img src={provLogo(round.providerLabelB ?? 'AMD')} alt="" className="w-3.5 h-3.5 shrink-0 theme-logo" />
                            ) : getModelLogoUrl(round.modelBehindB) && (
                              <img src={getModelLogoUrl(round.modelBehindB)!} alt="" className="w-3.5 h-3.5 shrink-0 theme-logo" />
                            )}
                            <span className="font-heading font-medium text-foreground truncate">
                              {isSpeed ? round.providerLabelB : round.modelBehindB.name}
                            </span>
                            {isSpeed ? (
                              round.timeMsB < round.timeMsA && <Zap size={10} className="text-amber-400 shrink-0" />
                            ) : (!isAWin && <Trophy size={10} className="text-primary shrink-0" />)}
                          </div>
                          <p className="text-foreground/50">
                            {isSpeed ? (
                              <>{formatTps(round.tpsB)} tok/s · {(round.timeMsB / 1000).toFixed(2)}s</>
                            ) : (
                              <>{round.tokensB.output.toLocaleString()} out · {formatTps(round.tpsB)} tok/s</>
                            )}
                          </p>
                        </div>
                      </div>

                      {/* Speed guess info */}
                      {isSpeed && (
                        <p className="text-xs text-foreground/50 mb-2">
                          You guessed <span className="font-semibold">{round.userGuess === 'a' ? round.providerLabelA : round.providerLabelB}</span> —{' '}
                          <span className={isCorrect ? 'text-emerald-400' : 'text-destructive'}>
                            {isCorrect ? 'correct!' : `actually ${round.timeMsA < round.timeMsB ? round.providerLabelA : round.providerLabelB} was faster`}
                          </span>
                        </p>
                      )}

                      {/* Prompt — click to expand */}
                      <button
                        onClick={() => toggleRound(round.roundNumber)}
                        className="w-full text-left text-sm text-foreground/60 line-clamp-2 hover:text-foreground transition-colors cursor-pointer group outline-none focus-visible:outline-none rounded-none px-1 -mx-1 hover:bg-muted"
                      >
                        <span className="flex items-center gap-1">
                          <span className="truncate">{round.prompt}</span>
                          {isExpanded ? (
                            <ChevronUp size={14} className="shrink-0 text-foreground/30 group-hover:text-foreground/60" />
                          ) : (
                            <ChevronDown size={14} className="shrink-0 text-foreground/30 group-hover:text-foreground/60" />
                          )}
                        </span>
                      </button>

                      {/* Expanded responses */}
                      {isExpanded && (
                        <div className="mt-3 space-y-2 border-t border-border pt-3">
                          <div>
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="font-heading text-xs font-semibold text-foreground/70">A — {isSpeed ? round.providerLabelA : round.modelBehindA.name}</span>
                            </div>
                            <p className="text-xs text-foreground/60 whitespace-pre-wrap leading-relaxed bg-surface p-3 rounded-none border border-border">
                              {round.responseA || <span className="italic text-foreground/30">No response</span>}
                            </p>
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="font-heading text-xs font-semibold text-foreground/70">B — {isSpeed ? round.providerLabelB : round.modelBehindB.name}</span>
                            </div>
                            <p className="text-xs text-foreground/60 whitespace-pre-wrap leading-relaxed bg-surface p-3 rounded-none border border-border">
                              {round.responseB || <span className="italic text-foreground/30">No response</span>}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* ====== PLAY AGAIN ====== */}
        <div className="flex justify-center anim-sld anim-sld-5">
          <Button onClick={onPlayAgain} size="lg">
            <RefreshCw size={18} />
            Play Again
          </Button>
        </div>
      </div>
    </div>
  );
}
