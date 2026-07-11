import { useState, useCallback, useMemo, useDeferredValue, memo, useEffect, useRef } from 'react';
import { AlertTriangle, Check, Key, Search, ShieldBan, Sparkles, Sun, Moon, Wand2, X, Zap } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Spinner } from '../ui/Spinner';
import { VirtualList } from '../ui/VirtualList';
import { demoProvider } from '../../providers/demo';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import type { AccessMode, GameMode, LlmProvider, ModelInfo, MatchConfig } from '../../types';
import { LogoRainCanvas } from './LogoRainCanvas';
import { getEdgeFunctionUrl } from '../../services/api';

interface SetupScreenProps {
  onStart: (config: MatchConfig) => void;
  toggleTheme: () => void;
  theme: 'light' | 'dark';
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
export function SetupScreen({ onStart, toggleTheme, theme }: SetupScreenProps) {
  // -- Mode selection --
  const [mode, setMode] = useState<AccessMode | null>(null);
  const [customGameMode, setCustomGameMode] = useState<GameMode>('standard');

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

  // -- Speed mode state --
  const [speedExpanded, setSpeedExpanded] = useState(false);
  const [speedError, setSpeedError] = useState('');
  const [speedLoading, setSpeedLoading] = useState(false);

  // -- Blacklist / allowed models (set of model IDs) --
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());

  // -- Step tracking --
  const [step, setStep] = useState<SetupStep>('mode');

  // -- intro anim only once per session --
  const [introStage, setIntroStage] = useState<'intro' | 'setup'>(() => (window as any).__introShown ? 'setup' : 'intro');

  const ps2Ref = useRef<HTMLCanvasElement>(null);
  const partsRef = useRef<Particle[]>([]);
  const imgsRef = useRef<HTMLImageElement[]>([]);
  const imgsReady = useRef(false);

  interface Particle {
    x: number; y: number; vx: number; vy: number; rot: number; rv: number; imgIdx: number; mid: string; op: number;
  }

  const radius = 20;
  const MAX_PARTS = 50;

  // -- Whitelist / blacklist mode --
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('whitelist');

  // — image loader (one-shot) —
  useEffect(() => {
    if (step !== 'models' || imgsReady.current) return;
    const isDark = document.documentElement.classList.contains('dark');
    const c = isDark ? '383c4a' : 'd0d0d0';
    const oai = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 260" fill="#' + c + '"><path d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z"/></svg>');
    const urls = [oai, ...['googlegemini','anthropic','mistralai','deepseek','meta','qwen'].map(s => `https://cdn.simpleicons.org/${s}/${c}`)];
    let ld = 0;
    for (let i = 0; i < urls.length; i++) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { if (++ld >= urls.length) imgsReady.current = true; };
      img.onerror = () => { if (++ld >= urls.length) imgsReady.current = true; };
      img.src = urls[i];
      imgsRef.current[i] = img;
    }
  }, [step]);

  function logoFor(m: ModelInfo): number {
    const t = m.id.toLowerCase() + m.name.toLowerCase();
    if (/gpt|o\d/.test(t)) return 0;
    if (/gemini/.test(t)) return 1;
    if (/claude|sonnet|haiku|opus|fable/.test(t)) return 2;
    if (/mistral/.test(t)) return 3;
    if (/deepseek/.test(t)) return 4;
    if (/llama|meta/.test(t)) return 5;
    if (/qwen/.test(t)) return 6;
    return Math.floor(Math.random() * 7);
  }

  // — particle syncer (reacts to selection changes) —
  useEffect(() => {
    if (step !== 'models') return;
    const shown = selectionMode === 'whitelist'
      ? models.filter(m => enabledIds.has(m.id))
      : models.filter(m => !enabledIds.has(m.id));
    if (shown.length === 0) { partsRef.current = []; return; }

    const parts = partsRef.current;
    const ids = new Set(shown.map(m => m.id));
    const cw = window.innerWidth;
    const ch = window.innerHeight;

    // Mark particles no longer in the set as dying
    for (let i = parts.length - 1; i >= 0; i--) {
      if (!ids.has(parts[i].mid) && parts[i].op >= 1) {
        parts[i].op = 0.98;
      }
    }

    // Add particles for newly shown models
    for (const m of shown) {
      if (parts.length >= MAX_PARTS) break;
      const idx = parts.findIndex(p => p.mid === m.id);
      if (idx >= 0) {
        if (parts[idx].op < 1) parts[idx].op = 1; // resurrect dying particle
        continue;
      }
      const side = Math.random() < 0.5 ? -1 : 1;
      const spd = 7 + Math.random() * 8;
      parts.push({
        x: side === -1 ? -radius : cw + radius,
        y: Math.random() * ch,
        vx: side * spd,
        vy: (-2 + Math.random() * 4) * 3,
        rot: Math.random() * Math.PI * 2,
        rv: (Math.random() - 0.5) * 0.15,
        imgIdx: logoFor(m),
        mid: m.id,
        op: 1,
      });
    }
  }, [step, enabledIds, models, selectionMode]);

  // — animation loop (persistent) —
  useEffect(() => {
    if (step !== 'models') { partsRef.current = []; return; }
    const canvas = ps2Ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    let aid: number;
    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cw = canvas.width, ch = canvas.height;
      const listEl = canvas.parentElement?.querySelector('.max-w-2xl');
      const obs = listEl ? listEl.getBoundingClientRect() : null;
      const pts = partsRef.current;

      // positions & wall bounce
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy; p.rot += p.rv;

        if (p.x < radius) { p.x = radius; p.vx = -p.vx * 0.85; }
        else if (p.x > cw - radius) { p.x = cw - radius; p.vx = -p.vx * 0.85; }
        if (p.y < radius && p.vy < 0) { p.y = radius; p.vy = -p.vy * 0.85; }
        if (p.y > ch - radius) { p.y = ch - radius; p.vy = -p.vy * 0.85; }

        if (obs && p.x + radius > obs.left && p.x - radius < obs.right && p.y + radius > obs.top && p.y - radius < obs.bottom) {
          const dl = p.x - obs.left, dr = obs.right - p.x;
          if (dl < dr) { p.x = obs.left - radius; p.vx = -p.vx * 0.6; }
          else { p.x = obs.right + radius; p.vx = -p.vx * 0.6; }
          p.vy *= 0.6;
        }
      }

      // particle-particle collision
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dx = pts[j].x - pts[i].x;
          const dy = pts[j].y - pts[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = radius * 2;
          if (dist >= minDist || dist < 0.01) continue;
          const nx = dx / dist, ny = dy / dist;
          const overlap = minDist - dist;
          pts[i].x -= nx * overlap * 0.5;
          pts[i].y -= ny * overlap * 0.5;
          pts[j].x += nx * overlap * 0.5;
          pts[j].y += ny * overlap * 0.5;
          const dvx = pts[j].vx - pts[i].vx;
          const dvy = pts[j].vy - pts[i].vy;
          const dvn = dvx * nx + dvy * ny;
          if (dvn < 0) {
            pts[i].vx += dvn * nx * 0.85;
            pts[i].vy += dvn * ny * 0.85;
            pts[j].vx -= dvn * nx * 0.85;
            pts[j].vy -= dvn * ny * 0.85;
          }
        }
      }

      // draw
      for (const p of pts) {
        ctx.save();
        ctx.globalAlpha = p.op;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.drawImage(imgsRef.current[p.imgIdx], -radius, -radius, radius * 2, radius * 2);
        ctx.restore();
      }

      // fade out dying particles
      for (let i = pts.length - 1; i >= 0; i--) {
        if (pts[i].op < 1) {
          pts[i].op -= 0.025;
          if (pts[i].op <= 0) pts.splice(i, 1);
        }
      }

      aid = requestAnimationFrame(loop);
    };

    const wait = () => {
      if (imgsReady.current && partsRef.current.length > 0) loop();
      else { aid = requestAnimationFrame(wait); }
    };
    aid = requestAnimationFrame(wait);

    return () => {
      cancelAnimationFrame(aid);
      window.removeEventListener('resize', resize);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [step]);

  useEffect(() => {
    if ((window as any).__introShown) { setIntroStage('setup'); return; }
    const t = setTimeout(() => {
      (window as any).__introShown = true;
      setIntroStage('setup');
    }, 1000);
    return () => clearTimeout(t);
  }, []);

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
    setCustomGameMode('standard');
    try {
      const m = await demoProvider.fetchModels();
      setModels(m);
      setEnabledIds(initEnabledIds(m, selectionMode));
      setStep('models');
    } catch {
      // Demo never fails
    }
  }, [selectionMode, initEnabledIds]);

  // ========== Speed mode handlers ==========
  const handleSpeedMode = useCallback(async (rounds: number) => {
    setSpeedError('');
    setSpeedLoading(true);
    try {
      const amdUrl = import.meta.env.VITE_AMD_ENDPOINT?.replace(/\/+$/, '');
      const amdKey = import.meta.env.VITE_AMD_API_KEY;
      if (amdUrl && amdKey) {
        const res = await fetch(amdUrl + '/models', {
          headers: { Authorization: `Bearer ${amdKey}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
      }
    } catch {
      setSpeedLoading(false);
      setSpeedError('AMD GPU is not available. Try again later or ask for fix.');
      return;
    }
    setSpeedLoading(false);
    try {
      const m = await demoProvider.fetchModels();
      onStart({
        mode: 'demo',
        gameMode: 'speed',
        allowedModels: [m[0]],
        systemPrompt: 'Dont respond more than 3 paragraphs, be concise and short.',
        totalRounds: rounds,
      });
    } catch {
      // Demo never fails
    }
  }, [onStart]);

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
    const isSpeed = customGameMode === 'speed';
    const allowedModels =
      selectionMode === 'whitelist'
        ? models.filter((m) => enabledIds.has(m.id))
        : models.filter((m) => !enabledIds.has(m.id));

    if (isSpeed ? allowedModels.length < 1 : allowedModels.length < 2) return;

    if (mode === 'demo') {
      onStart({
        mode: 'demo',
        gameMode: customGameMode,
        allowedModels,
        systemPrompt,
        totalRounds: isSpeed ? 7 : totalRounds,
      });
    } else if (mode === 'byok' && selectedProvider) {
      onStart({
        mode: 'byok',
        gameMode: 'standard',
        provider: selectedProvider,
        apiKey: apiKey || undefined,
        endpoint: selectedProvider === 'custom' ? customEndpoint : undefined,
        allowedModels,
        systemPrompt,
        totalRounds,
      });
    }
  }, [mode, selectedProvider, apiKey, customEndpoint, models, enabledIds, selectionMode, systemPrompt, totalRounds, customGameMode, onStart]);

  // ========== Memoised filtered list ==========
  const currentModels = models;

  const isSpeed = customGameMode === 'speed';
  const checkedCount = currentModels.filter((m) => enabledIds.has(m.id)).length;
  const poolSize = selectionMode === 'whitelist' ? checkedCount : currentModels.length - checkedCount;
  const canStart = isSpeed ? poolSize >= 1 : poolSize >= 2;

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
      <div className="fixed inset-0 flex flex-col items-center pt-24 sm:pt-20 px-4 bg-background">
        <LogoRainCanvas />

        <button
          onClick={toggleTheme}
          className="fixed top-6 right-6 z-50 p-2.5 rounded-xl border border-border bg-surface/60 backdrop-blur-md text-foreground hover:bg-muted/70 transition-all cursor-pointer shadow-sm flex items-center justify-center"
          aria-label="Toggle Theme"
        >
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>

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
          className={`z-10 relative grid gap-4 w-full max-w-md overflow-y-auto transition-all duration-700 delay-300 transform ${
            introStage === 'setup'
              ? 'opacity-100 translate-y-0'
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

          <div className={`rounded-xl border bg-surface/70 backdrop-blur-md overflow-hidden transition-all duration-200 ${speedExpanded ? '' : 'border-border hover:border-destructive cursor-pointer'}`}>
            <div
              onClick={speedExpanded ? undefined : () => setSpeedExpanded(true)}
              className={`px-6 py-5 ${speedExpanded ? '' : 'cursor-pointer'}`}
            >
              <div className="flex items-start gap-4">
                <Zap size={24} className="text-destructive shrink-0 mt-1" />
                <div className="flex-1">
                  <h3 className="font-heading font-semibold text-lg mb-1">Catch the Speeder</h3>
                  <p className="text-sm text-foreground/60">
                    Same model, two backends. Watch text streaming speed and guess which one is faster.
                    Survival mode — 3 hearts.
                  </p>
                </div>
              </div>
              {speedExpanded && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-sm font-medium text-foreground/70 mb-3">Rounds:</p>
                  {speedLoading ? (
                    <div className="flex items-center justify-center py-3">
                      <Spinner size={18} />
                    </div>
                  ) : speedError ? (
                    <p className="text-sm text-destructive flex items-center gap-1">
                      <AlertTriangle size={14} />
                      {speedError}
                    </p>
                  ) : (
                    <div className="flex gap-2">
                      {[3, 5, 7, 10].map((n) => (
                        <button
                          key={n}
                          onClick={() => handleSpeedMode(n)}
                          className="flex-1 px-4 py-3 rounded-xl border border-border text-sm font-medium cursor-pointer transition-all bg-muted text-foreground/70 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

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
      <canvas ref={ps2Ref} className="fixed inset-0 pointer-events-none z-0" />
      <div className="w-full max-w-2xl flex flex-col h-full relative z-10">
        <h2 className="font-heading text-2xl font-bold text-foreground mb-1">
          {isSpeed ? 'Select Model' : 'Select Models'}
        </h2>
        <p className="text-foreground/60 mb-1 text-sm">
          {isSpeed
            ? 'Pick at least one model for response variety. Both backends run the same model — speed depends on the provider.'
            : selectionMode === 'whitelist'
              ? 'Enable the models you want in the pool. Two of those will be randomly picked.'
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
        <div className="flex-1 min-h-[100px] mb-2">
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
          <Badge variant={poolSize >= (isSpeed ? 1 : 2) ? 'success' : 'warning'}>
            {poolSize} model{poolSize !== 1 ? 's' : ''} in pool
          </Badge>
          {poolSize < (isSpeed ? 1 : 2) && (
            <span className="text-sm text-foreground/50">
              {isSpeed
                ? 'Select at least 1 model'
                : selectionMode === 'whitelist'
                  ? `Enable at least ${2 - poolSize} more`
                  : `Unblock at least ${2 - poolSize} more`}
            </span>
          )}
          {selectionMode === 'blacklist' && checkedCount > 0 && !isSpeed && (
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

          {isSpeed ? (
            <div className="flex items-center gap-2 text-sm text-foreground/50">
              <Zap size={14} />
              <span>7 rounds · 3 hearts · no unsure</span>
            </div>
          ) : (
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
          )}
        </div>

        {/* Start */}
        <Button onClick={handleStart} disabled={!canStart} size="lg" className="w-full shrink-0">
          {isSpeed ? <Zap size={20} /> : <Wand2 size={20} />}
          {isSpeed ? 'Start Speed Match' : 'Start Blind Match'}
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