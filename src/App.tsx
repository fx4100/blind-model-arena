import { useState, useCallback, useEffect } from 'react';
import { SetupScreen } from './components/setup/SetupScreen';
import { MatchArena } from './components/arena/MatchArena';
import { RevealScreen } from './components/reveal/RevealScreen';
import { Sun, Moon } from 'lucide-react';
import type { AppPhase, MatchConfig, MatchState, RoundResult } from './types';

interface MatchResults {
  rounds: RoundResult[];
  scores: { a: number; b: number };
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
      <button
        onClick={toggleTheme}
        className="fixed top-6 right-6 z-50 p-2.5 rounded-xl border border-border bg-surface/60 backdrop-blur-md text-foreground hover:bg-muted/70 transition-all cursor-pointer shadow-sm flex items-center justify-center"
        aria-label="Toggle Theme"
      >
        {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
      </button>

      {phase === 'setup' && <SetupScreen onStart={handleStart} />}
      {phase === 'match' && matchConfig && (
        <MatchArena config={matchConfig} onReveal={handleReveal} />
      )}
      {phase === 'reveal' && results && (
        <RevealScreen
          rounds={results.rounds}
          scores={results.scores}
          onPlayAgain={handlePlayAgain}
        />
      )}
    </div>
  );
}