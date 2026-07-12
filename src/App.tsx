import { useState, useCallback, useEffect } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { SetupScreen } from './components/setup/SetupScreen';
import { MatchArena } from './components/arena/MatchArena';
import { RevealScreen } from './components/reveal/RevealScreen';
import type { AppPhase, MatchConfig, MatchState, RoundResult } from './types';

interface MatchResults {
  rounds: RoundResult[];
  scores: { a: number; b: number };
  gameMode: 'standard' | 'speed';
  heartsRemaining?: number;
}

export default function App() {
  const [phase, setPhase] = useState<AppPhase>('setup');
  const [matchConfig, setMatchConfig] = useState<MatchConfig | null>(null);
  const [results, setResults] = useState<MatchResults | null>(null);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bm_theme');
      if (saved === 'light' || saved === 'dark') return saved;
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    }
    return 'dark';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('bm_theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const handleStart = useCallback((config: MatchConfig) => {
    setMatchConfig(config);
    setResults(null);
    setPhase('match');
  }, []);

  const handleReveal = useCallback(
    (state: MatchState, rounds: RoundResult[]) => {
      if (!matchConfig) return;
      setResults({
        rounds,
        scores: state.scores,
        gameMode: state.config.gameMode,
        heartsRemaining: state.heartsRemaining,
      });
      setPhase('reveal');
    },
    [matchConfig],
  );

  const handlePlayAgain = useCallback(() => {
    setMatchConfig(null);
    setResults(null);
    setPhase('setup');
  }, []);

  return (
    <div className="min-h-screen bg-background relative">
      {phase === 'setup' && <SetupScreen onStart={handleStart} toggleTheme={toggleTheme} theme={theme} />}
      {phase === 'match' && matchConfig && (
        <MatchArena config={matchConfig} onReveal={handleReveal} />
      )}
      {phase === 'reveal' && results && (
        <RevealScreen
          rounds={results.rounds}
          scores={results.scores}
          onPlayAgain={handlePlayAgain}
          gameMode={results.gameMode}
          heartsRemaining={results.heartsRemaining}
        />
      )}
      <Analytics />
    </div>
  );
}