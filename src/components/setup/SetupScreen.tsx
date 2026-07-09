import { useState, useCallback, useMemo, useDeferredValue, memo, useEffect } from 'react';
import { AlertTriangle, Check, Key, Search, ShieldBan, Sparkles, Wand2, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import { VirtualList } from '../ui/VirtualList';
import { demoProvider } from '../../providers/demo';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import type { AccessMode, LlmProvider, ModelInfo, MatchConfig } from '../../types';
import { LogoRainCanvas } from './LogoRainCanvas';
import { getEdgeFunctionUrl } from '../../services/api';

interface SetupScreenProps {
  onStart: (config: MatchConfig) => void;
}

type SetupStep = 'mode' | 'config' | 'models';

// ---------------------------------------------------------------------------
// Provider metadata — just display info, no factories needed
// ---------------------------------------------------------------------------
interface ProviderMeta {
  id: LlmProvider;
  name: string;
  description: string;
  modelsBaseUrl: string | null;
  authStyle: 'bearer' | 'query';
  logoUrl: string;
}

const PROV_LOGOS: Record<string, string> = {
  openrouter: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openrouter.svg',
  openai: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openai.svg',
  gemini: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/gemini.svg',
  mistral: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/mistral.svg',
  fireworks: 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/fireworks.svg',
};

const BYOK_PROVIDERS: ProviderMeta[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Access 200+ models through one API.',
    modelsBaseUrl: 'https://openrouter.ai/api/v1',
    authStyle: 'bearer',
    logoUrl: PROV_LOGOS.openrouter,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o, GPT-4o-mini, and more.',
    modelsBaseUrl: 'https://api.openai.com/v1',
    authStyle: 'bearer',
    logoUrl: PROV_LOGOS.openai,
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: "Gemini 2.0 Flash, Pro, and more.",
    modelsBaseUrl: null,
    authStyle: 'query',
    logoUrl: PROV_LOGOS.gemini,
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    description: "Mistral's open-weight and flagship models.",
    modelsBaseUrl: 'https://api.mistral.ai/v1',
    authStyle: 'bearer',
    logoUrl: PROV_LOGOS.mistral,
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    description: 'Fast inference for Llama, Mistral, Qwen and more.',
    modelsBaseUrl: 'https://api.fireworks.ai/inference/v1',
    authStyle: 'bearer',
    logoUrl: PROV_LOGOS.fireworks,
  },
  {
    id: 'custom',
    name: 'Custom Endpoint',
    description: 'Any OpenAI-compatible API endpoint.',
    modelsBaseUrl: null,
    authStyle: 'bearer',
    logoUrl: '',
  },
];

// ---------------------------------------------------------------------------
// Fetch models directly from provider APIs (no proxy needed — these are CORS-friendly GET endpoints)
// ---------------------------------------------------------------------------
async function fetchModelsFromProvider(
  meta: ProviderMeta,
  apiKey: string,
  customEndpoint?: string,
): Promise<ModelInfo[]> {
  if (!apiKey) throw new Error('API key required');

  // Gemini: GET with API key as query param
  if (meta.id === 'gemini') {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini: ${res.status} ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    return (data.models ?? [])
      .filter((m: { name: string; supportedGenerationMethods?: string[] }) =>
        m.supportedGenerationMethods?.includes('generateContent'),
      )
      .map((m: { name: string; displayName?: string }) => ({
        id: m.name.replace('models/', ''),
        name: m.displayName ?? m.name,
        provider: 'gemini' as const,
      }));
  }

  // OpenAI-compatible: GET /models via Supabase Edge Function proxy to avoid CORS
  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'x-provider': meta.id,
    'Content-Type': 'application/json',
  };

  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (supabaseAnonKey) {
    headers['Authorization'] = `Bearer ${supabaseAnonKey}`;
  }

  if (meta.id === 'custom' && customEndpoint) {
    headers['x-endpoint'] = customEndpoint;
  }

  const res = await fetch(`${getEdgeFunctionUrl()}/models`, {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    const text = await res.text();
    let errMsg = text;
    try {
      const parsed = JSON.parse(text);
      const errVal = parsed.error || parsed;
      errMsg = typeof errVal === 'object'
        ? (typeof errVal.message === 'string' ? errVal.message : JSON.stringify(errVal))
        : String(errVal);
    } catch {
      // Use raw text
    }
    throw new Error(`${meta.name} (status ${res.status}): ${String(errMsg).slice(0, 200)}`);
  }

  const data = await res.json();
  const models = data.data ?? data.models ?? data;

  const list = Array.isArray(models) ? models : [models];
  const providerId = meta.id === 'custom' ? 'custom' : meta.id === 'openai' ? 'openrouter' : meta.id;

  return list
    .filter((m: unknown) => m && typeof m === 'object' && 'id' in (m as Record<string, unknown>))
    .map((m: { id: string; name?: string }) => ({
      id: typeof m.id === 'string' ? m.id : String(m.id ?? ''),
      name: typeof (m as any).name === 'string' ? (m as any).name : String(m.name ?? m.id ?? ''),
      provider: providerId as ModelInfo['provider'],
    }));
}

// ---------------------------------------------------------------------------
// Memoised model row
// ---------------------------------------------------------------------------
type SelectionMode = 'whitelist' | 'blacklist';

interface ModelRowProps {
  model: ModelInfo;
  enabled: boolean;
  mode: SelectionMode;
  onToggle: (id: string) => void;
}

const MODEL_LOGOS: [RegExp, string][] = [
  [/mistral/i, 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/mistral.svg'],
  [/gemini/i, 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/gemini.svg'],
  [/claude|sonnet|haiku|opus|fable/i, 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/anthropic.svg'],
  [/gpt/i, 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/openai.svg'],
  [/llama/i, 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/meta.svg'],
  [/deepseek/i, 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/deepseek.svg'],
  [/qwen/i, 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/qwen.svg'],
  [/fireworks/i, 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons/fireworks.svg'],
];

function getModelLogoUrl(model: ModelInfo): string | null {
  for (const [re, url] of MODEL_LOGOS) {
    if (re.test(model.id) || re.test(model.name)) return url;
  }
  return null;
}

const ModelRow = memo(function ModelRow({ model, enabled, mode, onToggle }: ModelRowProps) {
  const isWhitelist = mode === 'whitelist';
  const highlightClass = enabled
    ? isWhitelist
      ? 'border-primary bg-primary/5 text-foreground'
      : 'border-destructive bg-destructive/5 text-foreground'
    : 'border-border opacity-70 hover:opacity-90';

  const checkboxClass = enabled
    ? isWhitelist
      ? 'bg-primary border-primary'
      : 'bg-destructive border-destructive'
    : 'border-foreground/20';

  const logoUrl = getModelLogoUrl(model);

  return (
    <div className="pb-2 h-full">
      <Card
        hover
        padding="sm"
        onClick={() => onToggle(model.id)}
        className={`h-full text-left cursor-pointer transition-all rounded-none ${highlightClass}`}
      >
        <div className="flex items-center gap-3 min-w-0 h-full">
          {logoUrl && <img src={logoUrl} alt="" className="w-5 h-5 shrink-0 rounded theme-logo" />}
          <div
            className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${checkboxClass}`}
          >
            {enabled &&
              (isWhitelist ? (
                <Check size={12} className="text-on-primary" />
              ) : (
                <ShieldBan size={12} className="text-on-primary" />
              ))}
          </div>
          <span className="font-medium text-sm truncate">{model.name}</span>
          <span className="text-[10px] text-foreground/30 font-heading shrink-0 hidden sm:inline truncate max-w-[120px]">
            {model.id}
          </span>
          {!enabled && !isWhitelist && (
            <span className="text-[10px] text-emerald-400 font-heading shrink-0 ml-auto">available</span>
          )}
          {!enabled && isWhitelist && (
            <X size={14} className="text-foreground/20 shrink-0 ml-auto" />
          )}
          {enabled && !isWhitelist && (
            <X size={14} className="text-destructive/50 shrink-0 ml-auto" />
          )}
        </div>
      </Card>
    </div>
  );
});

// ==========================================================================
// Main setup screen
// ==========================================================================
export function SetupScreen({ onStart }: SetupScreenProps) {
  // -- Mode selection --
  const [mode, setMode] = useState<AccessMode | null>(null);

  // -- BYOK state --
  const [selectedProvider, setSelectedProvider] = useState<LlmProvider | null>(null);
  const [apiKey, setApiKey] = useLocalStorage('bm_apikey', '');
  const [customEndpoint, setCustomEndpoint] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const deferredSearch = useDeferredValue(modelSearch);

  // -- Shared config --
  const [systemPrompt, setSystemPrompt] = useState('');
  const [totalRounds, setTotalRounds] = useState(5);

  // -- Blacklist / allowed models (set of model IDs) --
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());

  // -- Step tracking --
  const [step, setStep] = useState<SetupStep>('mode');

  // -- intro anim only once per session --
  const [introStage, setIntroStage] = useState<'intro' | 'setup'>(() => (window as any).__introShown ? 'setup' : 'intro');

  useEffect(() => {
    if ((window as any).__introShown) { setIntroStage('setup'); return; }
    const t = setTimeout(() => {
      (window as any).__introShown = true;
      setIntroStage('setup');
    }, 1000);
    return () => clearTimeout(t);
  }, []);

  // -- Whitelist / blacklist mode --
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('whitelist');

  // ========== Initialize enabled IDs based on selection mode ==========
  const initEnabledIds = useCallback((allModels: ModelInfo[], mode: SelectionMode) => {
    if (mode === 'whitelist') {
      return new Set(allModels.map((m) => m.id));
    }
    return new Set<string>();
  }, []);

  // ========== BYOK mode handlers ==========
  const handleBYOKMode = useCallback(() => {
    setMode('byok');
    setStep('config');
  }, []);

  // ========== Demo mode handlers ==========
  const handleDemoMode = useCallback(async () => {
    setMode('demo');
    try {
      const m = await demoProvider.fetchModels();
      setModels(m);
      setEnabledIds(initEnabledIds(m, selectionMode));
      setStep('models');
    } catch {
      // Demo never fails
    }
  }, [selectionMode, initEnabledIds]);

  // ========== Fetch models from BYOK provider ==========
  const handleFetchModels = useCallback(async () => {
    if (!selectedProvider) return;
    setFetchingModels(true);
    setFetchError('');

    try {
      const meta = BYOK_PROVIDERS.find((p) => p.id === selectedProvider)!;
      const m = await fetchModelsFromProvider(
        meta,
        apiKey,
        selectedProvider === 'custom' ? customEndpoint : undefined,
      );
      setModels(m);
      setEnabledIds(initEnabledIds(m, selectionMode));
      setStep('models');
    } catch (err: any) {
      console.error('Fetch models error:', err);
      let errMsg = 'Failed to fetch models';
      if (err instanceof Error) {
        errMsg = err.message;
      } else if (err && typeof err === 'object') {
        try {
          errMsg = err.message || JSON.stringify(err);
        } catch {
          errMsg = Object.keys(err).map(k => `${k}: ${err[k]}`).join(', ');
        }
      } else if (typeof err === 'string') {
        errMsg = err;
      }
      setFetchError(errMsg);
    } finally {
      setFetchingModels(false);
    }
  }, [selectedProvider, apiKey, customEndpoint, selectionMode, initEnabledIds]);

  // ========== Toggle model ==========
  const toggleModel = useCallback((id: string) => {
    setEnabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // ========== Start match ==========
  const handleStart = useCallback(() => {
    const allowedModels =
      selectionMode === 'whitelist'
        ? models.filter((m) => enabledIds.has(m.id))
        : models.filter((m) => !enabledIds.has(m.id));

    if (allowedModels.length < 2) return;

    if (mode === 'demo') {
      onStart({
        mode: 'demo',
        allowedModels,
        systemPrompt,
        totalRounds,
      });
    } else if (mode === 'byok' && selectedProvider) {
      onStart({
        mode: 'byok',
        provider: selectedProvider,
        apiKey: apiKey || undefined,
        endpoint: selectedProvider === 'custom' ? customEndpoint : undefined,
        allowedModels,
        systemPrompt,
        totalRounds,
      });
    }
  }, [mode, selectedProvider, apiKey, customEndpoint, models, enabledIds, selectionMode, systemPrompt, totalRounds, onStart]);

  // ========== Memoised filtered list ==========
  const currentModels = models;

  const checkedCount = currentModels.filter((m) => enabledIds.has(m.id)).length;
  const poolSize = selectionMode === 'whitelist' ? checkedCount : currentModels.length - checkedCount;
  const canStart = poolSize >= 2;

  // Select all / deselect all
  const selectAll = useCallback(() => {
    if (selectionMode === 'whitelist') {
      setEnabledIds(new Set(currentModels.map((m) => m.id)));
    } else {
      setEnabledIds(new Set());
    }
  }, [currentModels, selectionMode]);

  const deselectAll = useCallback(() => {
    if (selectionMode === 'whitelist') {
      setEnabledIds(new Set());
    } else {
      setEnabledIds(new Set(currentModels.map((m) => m.id)));
    }
  }, [currentModels, selectionMode]);

  const filteredModels = useMemo(() => {
    if (!deferredSearch) return currentModels;
    const q = deferredSearch.toLowerCase();
    return currentModels.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q),
    );
  }, [currentModels, deferredSearch]);

  // ========== Render: Mode Selection ==========
  if (step === 'mode') {
    return (
      <div className="h-screen overflow-hidden flex flex-col items-center justify-center px-4 py-4 bg-background">
        <LogoRainCanvas />

        {/* Intro Stage Header */}
        <div 
          className={`z-20 fixed flex flex-col transition-all duration-700 ease-out rounded-xl ${
            introStage === 'intro'
              ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 items-center bg-surface/60 backdrop-blur-md px-8 py-6'
              : 'top-6 left-6 translate-x-0 translate-y-0 items-start bg-surface/60 backdrop-blur-md px-4 py-2'
          }`}
        >
          <h1 className={`font-heading font-bold uppercase tracking-wider text-foreground whitespace-nowrap transition-all duration-700 ${
            introStage === 'intro' ? 'text-4xl md:text-5xl' : 'text-xl'
          }`}>
            Blind Model Arena
          </h1>
          <p className={`font-sans italic text-sm text-foreground/50 transition-all duration-500 ${
            introStage === 'setup' ? 'opacity-100 mt-1' : 'opacity-0 h-0 overflow-hidden'
          }`}>
            To satisfy your "impartiality".
          </p>
        </div>

        {/* Main Options Grid */}
        <div 
          className={`z-10 relative grid gap-4 w-full max-w-md transition-all duration-700 delay-300 transform ${
            introStage === 'setup'
              ? 'opacity-100 translate-y-0 mt-20'
              : 'opacity-0 translate-y-4 pointer-events-none'
          }`}
        >
          <Card hover padding="lg" onClick={handleDemoMode} className="text-left rounded-xl border border-border bg-surface/70 backdrop-blur-md">
            <div className="flex items-start gap-4">
              <Sparkles size={24} className="text-primary shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="font-heading font-semibold text-lg mb-1">Demo</h3>
                <p className="text-sm text-foreground/60">
                  Try the arena instantly with simulated models and pre-written responses.
                  No API keys, no costs — just fun.
                </p>
              </div>
            </div>
          </Card>

          <Card hover padding="lg" onClick={handleBYOKMode} className="text-left rounded-xl border border-border bg-surface/70 backdrop-blur-md">
            <div className="flex items-start gap-4">
              <Key size={24} className="text-primary shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="font-heading font-semibold text-lg mb-1">Bring Your Own Key</h3>
                <p className="text-sm text-foreground/60">
                  Use your OpenAI, OpenRouter, Gemini, Mistral, or custom API keys. All traffic
                  goes through our secure proxy — no CORS issues, ever.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // ========== Render: BYOK config ==========
  if (mode === 'byok' && step === 'config') {
    return (
      <div className="h-screen overflow-hidden flex flex-col items-center justify-center px-4 py-4">
        <div className="w-full max-w-lg overflow-y-auto">
          <h2 className="font-heading text-2xl font-bold text-foreground mb-2">Connect Your Provider</h2>
          <p className="text-foreground/60 mb-8">
            Your API key is sent to our secure proxy and never stored on any server.
          </p>

          {/* Provider Selection */}
          <div className="space-y-3 mb-8">
            {BYOK_PROVIDERS.map((p) => (
              <Card
                key={p.id}
                hover
                padding="md"
                onClick={() => setSelectedProvider(p.id)}
                className={`text-left rounded-xl ${selectedProvider === p.id ? 'border-primary' : ''}`}
              >
                <div className="flex items-center gap-3">
                  {p.logoUrl && (
                    <img src={p.logoUrl} alt="" className="w-8 h-8 shrink-0 rounded theme-logo" />
                  )}
                  <div className="flex-1">
                    <span className="font-heading font-semibold">{p.name}</span>
                    <p className="text-sm text-foreground/60 mt-0.5">{p.description}</p>
                  </div>
                  {selectedProvider === p.id && (
                    <Check size={20} className="text-primary shrink-0" />
                  )}
                </div>
              </Card>
            ))}
          </div>

          {/* API Key */}
          <div className="space-y-4">
            <Input
              label="API Key"
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              hint="Stored locally in your browser"
            />

            {selectedProvider === 'custom' && (
              <Input
                label="Endpoint URL"
                type="url"
                placeholder="https://api.example.com/v1"
                value={customEndpoint}
                onChange={(e) => setCustomEndpoint(e.target.value)}
                hint="OpenAI-compatible API base URL"
              />
            )}

            {fetchError && (
              <p className="text-sm text-destructive flex items-center gap-1" role="alert">
                <AlertTriangle size={14} />
                {fetchError}
              </p>
            )}

            <Button
              onClick={handleFetchModels}
              disabled={!selectedProvider || (!apiKey && selectedProvider !== 'custom')}
              className="w-full"
            >
              {fetchingModels ? (
                <Spinner size={18} />
              ) : (
                <>
                  <Search size={18} />
                  Fetch Models
                </>
              )}
            </Button>
          </div>

          <button
            onClick={() => setStep('mode')}
            className="mt-6 text-sm text-foreground/50 hover:text-foreground cursor-pointer transition-colors"
          >
            ← Back to mode selection
          </button>
        </div>
      </div>
    );
  }

  // ========== Render: Model selection (shared) ==========
  return (
    <div className="h-screen overflow-hidden flex flex-col items-center px-4 py-3">
      <div className="w-full max-w-2xl flex flex-col h-full">
        <h2 className="font-heading text-2xl font-bold text-foreground mb-1">Select Models</h2>
        <p className="text-foreground/60 mb-1 text-sm">
          {selectionMode === 'whitelist'
            ? 'Enable the models you want in the pool. Each round, two will be randomly picked.'
            : 'Models you mark as blocked will be excluded. All others are fair game in the arena.'}
        </p>

        {/* Whitelist / Blacklist Toggle */}
        <div className="flex items-center gap-4 mb-2">
          <div className="relative inline-flex rounded-xl bg-muted p-0.5 border border-border">
            <div
              className={`absolute top-0.5 bottom-0.5 w-1/2 rounded-lg bg-primary transition-all duration-200 ${
                selectionMode === 'whitelist' ? 'left-0.5' : 'left-[calc(50%-0.125rem)]'
              }`}
            />
            <button
              onClick={() => setSelectionMode('whitelist')}
              className={`relative z-10 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors duration-200 ${
                selectionMode === 'whitelist' ? 'text-on-primary' : 'text-foreground/50 hover:text-foreground/70'
              }`}
            >
              Whitelist
            </button>
            <button
              onClick={() => setSelectionMode('blacklist')}
              className={`relative z-10 px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors duration-200 ${
                selectionMode === 'blacklist' ? 'text-on-primary' : 'text-foreground/50 hover:text-foreground/70'
              }`}
            >
              Blacklist
            </button>
          </div>

          {/* Bulk actions */}
          <button
            onClick={selectAll}
            className="text-xs text-foreground/50 hover:text-foreground cursor-pointer transition-colors"
          >
            {selectionMode === 'whitelist' ? 'Select all' : 'Clear blocks'}
          </button>
          <button
            onClick={deselectAll}
            className="text-xs text-foreground/50 hover:text-foreground cursor-pointer transition-colors"
          >
            {selectionMode === 'whitelist' ? 'Deselect all' : 'Block all'}
          </button>
        </div>

        {/* Search */}
        <Input
          placeholder="Search models…"
          value={modelSearch}
          onChange={(e) => setModelSearch(e.target.value)}
          className="mb-2"
        />

        {/* Virtualized model checklist */}
        <div className="flex-1 min-h-0 mb-2">
          {filteredModels.length > 0 ? (
            <VirtualList
              items={filteredModels}
              itemHeight={62}
              overscan={5}
              className="h-full"
              renderItem={(m) => (
                <ModelRow
                  model={m}
                  enabled={enabledIds.has(m.id)}
                  mode={selectionMode}
                  onToggle={toggleModel}
                />
              )}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-foreground/40">
                {deferredSearch ? 'No matching models found.' : 'No models loaded.'}
              </p>
            </div>
          )}
        </div>

        {/* Pool count */}
        <div className="flex items-center gap-2 mb-2 shrink-0">
          <Badge variant={poolSize >= 2 ? 'success' : 'warning'}>
            {poolSize} model{poolSize !== 1 ? 's' : ''} in pool
          </Badge>
          {poolSize < 2 && (
            <span className="text-sm text-foreground/50">
              {selectionMode === 'whitelist'
                ? `Enable at least ${2 - poolSize} more`
                : `Unblock at least ${2 - poolSize} more`}
            </span>
          )}
          {selectionMode === 'blacklist' && checkedCount > 0 && (
            <span className="text-xs text-foreground/40 ml-1">
              ({checkedCount} blocked)
            </span>
          )}
        </div>

        {/* Config */}
        <div className="space-y-2 mb-2 shrink-0">
          <Input
            label="System Prompt (optional)"
            placeholder="You are a helpful assistant…"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            hint="Same prompt sent to both models"
          />

          <div className="flex items-center gap-4">
            <label className="text-sm font-medium text-foreground">Rounds:</label>
            <div className="flex gap-2">
              {[3, 5, 7].map((n) => (
                <button
                  key={n}
                  onClick={() => setTotalRounds(n)}
                  className={`px-4 py-2 rounded-xl border border-border text-sm font-medium cursor-pointer transition-all
                    ${totalRounds === n
                      ? 'bg-primary text-on-primary'
                      : 'bg-muted text-foreground/70 hover:bg-muted/70'
                    }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Start */}
        <Button onClick={handleStart} disabled={!canStart} size="lg" className="w-full shrink-0">
          <Wand2 size={20} />
          Start Blind Match
        </Button>

        <button
          onClick={() => setStep(mode === 'demo' ? 'mode' : 'config')}
          className="mt-2 mb-1 text-sm text-foreground/50 hover:text-foreground cursor-pointer transition-colors block mx-auto shrink-0"
        >
          ← Back
        </button>
      </div>
    </div>
  );
}