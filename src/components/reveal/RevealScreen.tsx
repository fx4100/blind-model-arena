import { useState, useEffect } from 'react';
import { RefreshCw, Trophy, Zap, ChevronDown, ChevronUp, Crown } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import type { RoundResult, ModelInfo } from '../../types';

interface RevealScreenProps {
  rounds: RoundResult[];
  scores: { a: number; b: number };
  onPlayAgain: () => void;
}

const MODEL_LOGOS: [RegExp, string][] = [
  [/claude|sonnet|haiku|opus|fable/i, 'https://cdn.simpleicons.org/claude/383c4a'],
  [/mistral/i, 'https://cdn.simpleicons.org/mistralai/383c4a'],
  [/gemini/i, 'https://cdn.simpleicons.org/googlegemini/383c4a'],
  [/gpt|o\d/i, 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openai.svg'],
  [/llama/i, 'https://cdn.simpleicons.org/meta/383c4a'],
  [/deepseek/i, 'https://cdn.simpleicons.org/deepseek/383c4a'],
  [/qwen/i, 'https://cdn.simpleicons.org/qwen/383c4a'],
  [/fireworks/i, 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/fireworks.svg'],
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

export function RevealScreen({ rounds, scores, onPlayAgain }: RevealScreenProps) {
  const modelVotes = tallyModelVotes(rounds);
  const sortedByVotes = [...modelVotes.values()].sort((a, b) => b.votes - a.votes);
  const winner = sortedByVotes.length > 0 ? sortedByVotes[0] : null;
  const runnerUp = sortedByVotes.length > 1 ? sortedByVotes[1] : null;

  const modelSpeed = tallyModelSpeed(rounds);
  const speedEntries = [...modelSpeed.values()];

  const totalVotes = scores.a + scores.b;
  const pctA = totalVotes > 0 ? (scores.a / totalVotes) * 100 : 50;

  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(new Set());
  const [bgReady, setBgReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBgReady(true), 200);
    return () => clearTimeout(t);
  }, []);

  const toggleRound = (n: number) => {
    setExpandedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  const topModel = winner?.model;
  const secondModel = runnerUp?.model;

  return (
    <div className="min-h-screen flex flex-col px-4 py-8 relative overflow-hidden bg-background">
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
      `}</style>

      {/* Background model logos */}
      {bgReady && topModel && (
        <div className="fixed inset-0 pointer-events-none z-0 flex flex-col items-center justify-between py-[12vh] select-none">
          <div className="anim-sld-bg" style={{
            animation: 'sldInBg 1s ease-out 0.3s both, rolSlw 45s linear 1.3s infinite',
          }}>
            <img
              src={getModelLogoUrl(topModel) ?? ''}
              alt=""
              className="w-48 h-48 opacity-[0.04] grayscale"
            />
          </div>
          <div className="anim-sld-bg" style={{
            animation: 'sldInBg 1s ease-out 0.6s both, rolSlw 45s linear 1.6s infinite reverse',
          }}>
            <img
              src={getModelLogoUrl(secondModel ?? topModel) ?? ''}
              alt=""
              className="w-48 h-48 opacity-[0.04] grayscale"
            />
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto w-full relative z-10">

        {/* ====== HEADER ====== */}
        <div className="text-center mb-8 anim-sld anim-sld-1">
          <div className="relative inline-block">
            <Trophy size={52} className="mx-auto mb-3 text-primary anim-glow" />
          </div>
          <h1 className="font-heading text-3xl font-bold text-foreground mb-2 uppercase tracking-wider">
            Match Complete
          </h1>
          {winner ? (
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
            <h2 className="font-heading font-semibold text-lg mb-4 text-foreground">Score</h2>
            <div className="h-8 w-full rounded-none bg-muted overflow-hidden flex">
              {sortedByVotes.length > 0 && (
                <div
                  className="h-full bg-primary transition-all duration-700 flex items-center justify-center text-xs font-bold text-on-primary truncate px-1"
                  style={{ width: `${sortedByVotes.length > 1 ? (sortedByVotes[0].votes / (sortedByVotes[0].votes + sortedByVotes[1].votes)) * 100 : 100}%` }}
                >
                  {sortedByVotes[0].model.name} {sortedByVotes[0].votes}
                </div>
              )}
              {sortedByVotes.length > 1 && (
                <div
                  className="h-full bg-foreground/20 transition-all duration-700 flex items-center justify-center text-xs font-bold text-foreground truncate px-1"
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
              {sortedByVotes.length > 1 && (
                <span className="anim-sld anim-sld-2 text-foreground/50 truncate">
                  {sortedByVotes[1].model.name} — {sortedByVotes[1].votes} vote{sortedByVotes[1].votes !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </Card>
        </div>

        {/* ====== ROUND TIMELINE ====== */}
        <div className="mb-6 anim-sld anim-sld-3">
          <Card padding="lg" className="rounded-none border border-border">
            <h2 className="font-heading font-semibold text-lg mb-4 text-foreground">Timeline</h2>
            <div className="flex justify-center items-center">
              {rounds.map((r, i) => {
                const isAWin = r.vote === 'a';
                return (
                  <div key={r.roundNumber} className="flex items-center">
                    <div className="flex flex-col items-center w-8">
                      <div
                        className="w-5 h-5 rounded-full border-2 border-primary bg-primary flex items-center justify-center text-[10px] font-bold text-on-primary cursor-pointer transition-all hover:scale-125"
                        onClick={() => toggleRound(r.roundNumber)}
                        title={`Round ${r.roundNumber}: ${isAWin ? 'A' : 'B'} won`}
                      >
                        {r.roundNumber}
                      </div>
                      <span className="text-[10px] mt-1 font-heading text-primary">
                        {isAWin ? 'A' : 'B'}
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
                      <p className="font-heading font-semibold text-sm text-primary truncate">
                        {s.model.name}
                      </p>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div>
                        <p className="text-xs text-foreground/50 uppercase tracking-wider">Avg TPS</p>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex-1 h-2 rounded-none bg-muted overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-none transition-all duration-700"
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                          <span className="font-heading font-semibold text-sm text-foreground shrink-0">
                            {formatTps(s.avgTps)} tok/s
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
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
                          <Badge variant={isAWin ? 'success' : 'info'}>
                            {isAWin ? 'A won' : 'B won'}
                            {round.decidedViaUnsure && ' (unsure)'}
                          </Badge>
                        </div>
                        <span className="text-xs text-foreground/40 font-heading flex items-center gap-1">
                          <Zap size={12} />
                          <span className="text-foreground">{formatTps(Math.max(round.tpsA, round.tpsB))} tok/s</span>
                        </span>
                      </div>

                      {/* Models A & B */}
                      <div className="grid grid-cols-2 gap-4 text-xs mb-2">
                        <div className={`p-2 rounded-none ${isAWin ? 'bg-primary/5 border-l-2 border-primary' : ''}`}>
                          <div className="flex items-center gap-1.5 mb-1">
                            {getModelLogoUrl(round.modelBehindA) && (
                              <img src={getModelLogoUrl(round.modelBehindA)!} alt="" className="w-3.5 h-3.5 shrink-0 theme-logo" />
                            )}
                            <span className="font-heading font-medium text-foreground truncate">
                              {round.modelBehindA.name}
                            </span>
                            {isAWin && <Trophy size={10} className="text-primary shrink-0" />}
                          </div>
                          <p className="text-foreground/50">
                            {round.tokensA.output.toLocaleString()} out · {formatTps(round.tpsA)} tok/s
                          </p>
                        </div>
                        <div className={`p-2 rounded-none ${!isAWin ? 'bg-primary/5 border-l-2 border-primary' : ''}`}>
                          <div className="flex items-center gap-1.5 mb-1">
                            {getModelLogoUrl(round.modelBehindB) && (
                              <img src={getModelLogoUrl(round.modelBehindB)!} alt="" className="w-3.5 h-3.5 shrink-0 theme-logo" />
                            )}
                            <span className="font-heading font-medium text-foreground truncate">
                              {round.modelBehindB.name}
                            </span>
                            {!isAWin && <Trophy size={10} className="text-primary shrink-0" />}
                          </div>
                          <p className="text-foreground/50">
                            {round.tokensB.output.toLocaleString()} out · {formatTps(round.tpsB)} tok/s
                          </p>
                        </div>
                      </div>

                      {/* Prompt — click to expand */}
                      <button
                        onClick={() => toggleRound(round.roundNumber)}
                        className="w-full text-left text-sm text-foreground/60 line-clamp-2 hover:text-foreground/80 transition-colors cursor-pointer group"
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
                              {getModelLogoUrl(round.modelBehindA) && (
                                <img src={getModelLogoUrl(round.modelBehindA)!} alt="" className="w-3.5 h-3.5 shrink-0 theme-logo" />
                              )}
                              <span className="font-heading text-xs font-semibold text-foreground/70">A — {round.modelBehindA.name}</span>
                            </div>
                            <p className="text-xs text-foreground/60 whitespace-pre-wrap leading-relaxed bg-surface p-3 rounded-none border border-border">
                              {round.responseA || <span className="italic text-foreground/30">No response</span>}
                            </p>
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5 mb-1">
                              {getModelLogoUrl(round.modelBehindB) && (
                                <img src={getModelLogoUrl(round.modelBehindB)!} alt="" className="w-3.5 h-3.5 shrink-0 theme-logo" />
                              )}
                              <span className="font-heading text-xs font-semibold text-foreground/70">B — {round.modelBehindB.name}</span>
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
