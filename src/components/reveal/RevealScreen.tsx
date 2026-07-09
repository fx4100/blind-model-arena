import { RefreshCw, Trophy, Zap } from 'lucide-react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import type { RoundResult, ModelInfo } from '../../types';

interface RevealScreenProps {
  rounds: RoundResult[];
  scores: { a: number; b: number };
  onPlayAgain: () => void;
}

/** Tally votes by model identity across all rounds. */
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

/** Aggregate speed stats per model identity across all rounds. */
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
  // Compute avg TPS per model
  for (const stats of map.values()) {
    stats.avgTps = stats.totalTimeMs > 0 ? stats.outputTokens / (stats.totalTimeMs / 1000) : 0;
  }
  return map;
}

export function RevealScreen({ rounds, scores, onPlayAgain }: RevealScreenProps) {
  const modelVotes = tallyModelVotes(rounds);
  const sortedByVotes = [...modelVotes.values()].sort((a, b) => b.votes - a.votes);
  const winner = sortedByVotes.length > 0 ? sortedByVotes[0] : null;

  const modelSpeed = tallyModelSpeed(rounds);
  const speedEntries = [...modelSpeed.values()];

  return (
    <div className="min-h-screen flex flex-col px-4 py-8">
      <div className="max-w-3xl mx-auto w-full">
        {/* Header */}
        <div className="text-center mb-10">
          <Trophy size={48} className="mx-auto mb-4 text-primary" />
          <h1 className="font-heading text-3xl font-bold text-foreground mb-3 uppercase tracking-wider">
            Match Complete
          </h1>
          {winner ? (
            <p className="text-xl text-foreground/70">
              <span className="font-heading font-semibold text-primary">
                {winner.model.name}
              </span>{' '}
              won with{' '}
              <span className="font-semibold">{winner.votes}</span> vote
              {winner.votes !== 1 ? 's' : ''}
            </p>
          ) : (
            <p className="text-xl text-foreground/70">
              No winner — the match ended without votes
            </p>
          )}
        </div>

        {/* Scoring Summary */}
        <Card padding="lg" className="mb-6">
          <h2 className="font-heading font-semibold text-lg mb-4">Score Summary</h2>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="p-4 rounded-none bg-surface border border-border">
              <p className="text-3xl font-bold text-primary font-heading">{scores.a}</p>
              <p className="text-sm text-foreground/60 mt-1">Voted A</p>
            </div>
            <div className="p-4 rounded-none bg-surface border border-border">
              <p className="text-3xl font-bold text-foreground/60 font-heading">{scores.b}</p>
              <p className="text-sm text-foreground/60 mt-1">Voted B</p>
            </div>
          </div>
        </Card>

        {/* Speed Summary */}
        <Card padding="lg" className="mb-6">
          <h2 className="font-heading font-semibold text-lg mb-4 flex items-center gap-2">
            <Zap size={20} className="text-primary" />
            Speed Summary
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {speedEntries.map((s) => (
              <div key={s.model.id} className="p-4 rounded-none bg-surface border border-border">
                <p className="font-heading font-semibold text-sm text-primary mb-3">
                  {s.model.name}
                </p>
                <div className="space-y-2 text-sm">
                  <div>
                    <p className="text-xs text-foreground/50 uppercase tracking-wider">
                      Avg TPS
                    </p>
                    <p className="font-heading font-semibold text-xl">
                      {formatTps(s.avgTps)} tok/s
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-foreground/50 uppercase tracking-wider">
                      Output Tokens
                    </p>
                    <p className="font-heading font-semibold text-xl">
                      {s.outputTokens.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-foreground/50 uppercase tracking-wider">
                      Total Time
                    </p>
                    <p className="font-heading font-semibold text-xl">
                      {(s.totalTimeMs / 1000).toFixed(1)}s
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Per-round breakdown */}
        <Card padding="lg" className="mb-8">
          <h2 className="font-heading font-semibold text-lg mb-4">Round by Round</h2>
          <div className="space-y-3">
            {rounds.map((round) => (
              <div
                key={round.roundNumber}
                className="p-4 rounded-none border border-border bg-surface"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-heading text-sm font-semibold text-foreground">
                      Round {round.roundNumber}
                    </span>
                    <Badge variant={round.vote === 'a' ? 'success' : 'info'}>
                      {round.vote === 'a' ? 'Voted A' : 'Voted B'}
                      {round.decidedViaUnsure && ' (via unsure)'}
                    </Badge>
                  </div>
                  <span className="text-xs text-foreground/40 font-heading flex items-center gap-1">
                    <Zap size={12} />
                    {formatTps(Math.max(round.tpsA, round.tpsB))} tok/s
                  </span>
                </div>

                <p className="text-sm text-foreground/60 line-clamp-2 mb-2">{round.prompt}</p>

                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <p className="text-foreground/50 mb-0.5">
                      <span className="font-heading font-medium">
                        A → {round.modelBehindA.name}
                      </span>
                    </p>
                    <p className="text-foreground/40">
                      {round.tokensA.output.toLocaleString()} out ·{' '}
                      {(round.tokensA.output + round.tokensA.input).toLocaleString()} total ·{' '}
                      {formatTps(round.tpsA)} tok/s ·{' '}
                      {(round.timeMsA / 1000).toFixed(2)}s
                    </p>
                  </div>
                  <div>
                    <p className="text-foreground/50 mb-0.5">
                      <span className="font-heading font-medium">
                        B → {round.modelBehindB.name}
                      </span>
                    </p>
                    <p className="text-foreground/40">
                      {round.tokensB.output.toLocaleString()} out ·{' '}
                      {(round.tokensB.output + round.tokensB.input).toLocaleString()} total ·{' '}
                      {formatTps(round.tpsB)} tok/s ·{' '}
                      {(round.timeMsB / 1000).toFixed(2)}s
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Play Again */}
        <div className="flex justify-center">
          <Button onClick={onPlayAgain} size="lg">
            <RefreshCw size={18} />
            Play Again
          </Button>
        </div>
      </div>
    </div>
  );
}