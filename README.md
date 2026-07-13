<p align="center">
  <img src="public/readme-logo.png" alt="BLIND MODEL ARENA." width="480" />
</p>

<p align="center">
  <strong>To satisfy your "impartiality".</strong>
</p>

<p align="center">
  A premium, privacy-first web application for unbiased, side-by-side blind comparisons of Large Language Models. 
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-18.3-61dafb?style=flat-square&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-v4-06b6d4?style=flat-square&logo=tailwindcss" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Vite-7.2-646cff?style=flat-square&logo=vite" alt="Vite" />
  <img src="https://img.shields.io/badge/Vercel_Edge-Proxy-000000?style=flat-square&logo=vercel" alt="Vercel" />
</p>

---

## 💡 The Core Concept

When evaluating Large Language Models, human judgment is easily clouded by **brand bias**, **anchoring**, and the **halo effect**. Knowing that a response comes from a flagship model like GPT-4 or Claude 3.5 Sonnet changes our expectations and skews our score. 

**Blind Model Arena** solves this. It sets up an impartial testing ground:
1. Two anonymous models (randomly selected from your custom pool) receive the same prompt.
2. Responses stream side-by-side in real-time.
3. You read and vote on the better response, completely blind.
4. Only after voting are the model identities revealed, along with detailed performance statistics.

---

## 🎮 Game Modes

### 1. 🧪 Demo Mode
Jump in instantly with zero setup and no API keys.
* **Simulated Pool:** Compare top-tier simulated models (like GPT-4o, Claude 3.5 Sonnet, and Gemini 2.0 Flash) streaming from a curated set of high-quality responses.
* **AMD GPU Integration:** The model list also includes the live `gpt-oss-20b` AMD GPU model, allowing users to select and test self-hosted GPU inference directly.

### 2. 🔑 Bring Your Own Key (BYOK)
Connect your own API key to compare live models directly. Supported providers include:
* **OpenRouter** (Access to 200+ models via a single key)
* **OpenAI** (GPT-4o, GPT-4o-mini, o1)
* **Google Gemini** (Gemini 2.0 Flash/Pro)
* **Mistral AI** (Mistral Large/Saba)
* **Fireworks AI** (High-speed Llama & Qwen models)
* **Custom Endpoint** (Any OpenAI-compatible API)

### ⚡ 3. Catch the Speeder (Survival Minigame)
A high-stakes speed-guessing game designed to test human perception of inference latencies.
* **Setup:** The same model architecture runs on two different backends: Fireworks Cloud API and a local self-hosted AMD GPU running `llama.cpp` + ROCm.
* **Gameplay:** Watch the concurrent SSE streams, and guess which side finished first. 
* **Mechanics:** You start with **3 hearts**—each wrong guess costs one heart. Position assignments are randomized every round to prevent layout bias.

---

## 🔒 Privacy-First Design

Unlike other model arenas, **Blind Model Arena does not collect your prompts, conversations, or LLM responses.** We believe that your prompts and interactions are strictly private. 

* **No Text Collection:** Our database logs exclude all prompt texts, system instructions, and assistant responses.
* **Minimal Statistics:** We persist only the anonymous match/round sequence, the models involved, and the final preference vote to calculate model win rates.
* **Local-First Keys:** Your API keys are stored solely in your browser's `localStorage`. They are sent over HTTPS to the secure edge proxy only to authorize outgoing requests, and are never logged or stored on any server.

---

## 🛠️ System Architecture

```
                       ┌──────────────────────┐
                       │    Browser (React)   │
                       └──────────┬───────────┘
                                  │
                       HTTPS /api/llm-proxy (SSE)
                                  │
                       ┌──────────▼───────────┐
                       │ Vercel Edge Function │
                       └──────────┬───────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
┌────────▼────────┐      ┌────────▼────────┐      ┌────────▼────────┐
│   OpenAI API    │      │  OpenRouter API │      │  Self-Hosted    │
│  (Cloud Host)   │      │  (Cloud Host)   │      │  AMD GPU Server │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

* **Vercel Edge Function Proxy:** Handles outgoing requests to bypass browser CORS policies and keep API keys hidden from client-side network inspectors.
* **SSE Normalizer:** Automatically translates vendor-specific streaming protocols (such as Gemini's custom SSE structure) into unified, OpenAI-compatible server-sent events.
* **Smooth Rendering:** Utilizes requestAnimationFrame and a 50ms throttled state buffer to prevent DOM rendering bottlenecks during high-throughput token streams.

---

## 🚀 Local Development

Clone the repository and install dependencies:

```bash
# Install dependencies
npm install

# Start the local development server (proxies API requests to the remote edge server)
npm run dev
```

### Environment Variables
For production deployments (e.g., in Vercel environment variables) or when setting up the serverless proxy, configure the following keys:

| Variable | Description | Required |
| :--- | :--- | :---: |
| `FIREWORKS_API_KEY` | Fireworks AI key (used for Catch the Speeder mode) | Yes* |
| `AMD_ENDPOINT` | Self-hosted AMD GPU server URL running llama.cpp | Yes* |
| `AMD_API_KEY` | API Key authorization for the AMD GPU server | No |
| `SUPABASE_URL` | Supabase project URL (optional/not needed) | No |
| `SUPABASE_ANON_KEY` | Supabase anonymous API key (optional/not needed) | No |

*\*Only required to support the live "Catch the Speeder" and AMD live GPU demo features.*

---

## 📦 Deployment

### Frontend Build & Deployment
Compile the optimized production build:
```bash
npm run build
```
Deploy the resulting `/dist` folder directly to **Vercel**, **Netlify**, or **Cloudflare Pages**. 

When deploying on Vercel, the Edge Function in the `/api` directory is automatically detected and routed, serving as the secure proxy for API key authentication and streaming normalizations.
