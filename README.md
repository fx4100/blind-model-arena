# Blind Model Arena

Compare LLMs side-by-side in a blind test. Vote for the best response without knowing which model generated it.

## Features

- **Blind comparison** — two models respond to the same prompt, you vote blind
- **BYOK** — bring your own API key (OpenAI, OpenRouter, Gemini, Mistral, Fireworks AI, or any OpenAI-compatible endpoint)
- **Demo mode** — try instantly with simulated models
- **Streaming** — real-time response streaming via SSE
- **Token stats** — per-round token counts, TPS, and timing

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS v4
- Supabase (Edge Function proxy + DB)

## Development

```bash
npm install
npm run dev
```

## Deploy

Frontend: `npx vite build` → deploy to Vercel/Netlify.

Set env vars:
- `VITE_SUPABASE_URL` — your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — your Supabase anon key
- `VITE_EDGE_FUNCTION_URL` — your edge function URL

Edge function: `npx supabase functions deploy llm-proxy`
