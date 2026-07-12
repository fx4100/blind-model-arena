export const config = { runtime: "edge" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key, x-provider, x-endpoint",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const AMD_KEY = process.env.AMD_API_KEY || "";
const AMD_URL = (process.env.AMD_ENDPOINT || "").replace(/\/+$/, "");
const FW_KEY = process.env.FIREWORKS_API_KEY || "";
const SB_URL = process.env.SUPABASE_URL || "";
const SB_KEY = process.env.SUPABASE_ANON_KEY || "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function sse(body: ReadableStream | null, status: number) {
  return new Response(body, { status, headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } });
}

async function transformGemini(reader: ReadableStreamDefaultReader<Uint8Array>, writer: WritableStreamDefaultWriter<Uint8Array>) {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const l of lines) {
        const t = l.trim();
        if (!t.startsWith("data: ")) continue;
        const s = t.slice(6);
        if (!s) continue;
        try {
          const j = JSON.parse(s);
          for (const c of (j.candidates || [])) {
            const txt = c.content?.parts?.[0]?.text || "";
            if (txt) await writer.write(enc.encode("data: " + JSON.stringify({ choices: [{ delta: { content: txt }, index: 0 }] }) + "\n\n"));
          }
          if (j.candidates?.some((c: any) => c.finishReason)) await writer.write(enc.encode("data: [DONE]\n\n"));
        } catch {}
      }
    }
  } finally { try { await writer.close(); } catch {} }
}

async function handleHealth() {
  const r: Record<string, boolean> = {};
  if (AMD_URL) {
    try {
      const res = await fetch(AMD_URL + "/models", {
        headers: { "Authorization": `Bearer ${AMD_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      r.amd = res.ok;
    } catch { r.amd = false; }
  }
  if (FW_KEY) {
    try {
      const res = await fetch("https://api.fireworks.ai/inference/v1/models", {
        headers: { "Authorization": `Bearer ${FW_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      r.fireworks = res.ok;
    } catch { r.fireworks = false; }
  }
  return json(r);
}

async function handleSupabase(table: string, req: Request) {
  if (!SB_URL || !SB_KEY) return json({ error: "Supabase not set" }, 500);
  const body = await req.text();
  const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SB_KEY, "Authorization": `Bearer ${SB_KEY}`, "Prefer": "return=representation" },
    body,
  });
  const txt = await res.text();
  return new Response(txt, { status: res.status, headers: { ...CORS, "Content-Type": res.headers.get("content-type") || "application/json" } });
}

async function handleChat(req: Request) {
  const prov = req.headers.get("x-provider") || "";
  const ep = req.headers.get("x-endpoint");
  const uk = req.headers.get("x-api-key") || "";

  let key = uk;
  if (!key) {
    if (prov === "custom") key = AMD_KEY;
    else if (prov === "firework" || prov === "fireworks") key = FW_KEY;
  }
  if (!key) return json({ error: "No API key" }, 400);

  let base = "";
  const p = prov;
  if (p === "custom") base = ep || AMD_URL;
  else if (p === "firework" || p === "fireworks") base = "https://api.fireworks.ai/inference/v1";
  else if (p === "openai") base = "https://api.openai.com/v1";
  else if (p === "openrouter") base = "https://openrouter.ai/api/v1";
  else if (p === "mistral") base = "https://api.mistral.ai/v1";
  else if (p === "gemini") base = "https://generativelanguage.googleapis.com";
  if (!base) return json({ error: `Unknown provider: ${p}` }, 400);

  const bodyText = await req.text();

  // Gemini: transform body format + use key as query param
  if (p === "gemini") {
    const parsed = JSON.parse(bodyText);
    const mdl = parsed.model || "gemini-2.0-flash";
    const msgs = parsed.messages || [];
    const contents = msgs.filter((m: any) => m.role !== "system").map((m: any) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const gb: any = { contents };
    const sys = msgs.filter((m: any) => m.role === "system");
    if (sys.length) gb.systemInstruction = { parts: [{ text: sys.map((m: any) => m.content).join("\n") }] };
    const init: RequestInit = { method: "POST", body: JSON.stringify(gb) };
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 120000);
    init.signal = ac.signal;
    let up: Response;
    try { up = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${mdl}:generateContent?key=${key}&alt=sse`, init); } finally { clearTimeout(to); }
    if (up.ok && up.headers.get("content-type")?.includes("text/event-stream")) {
      const { readable, writable } = new TransformStream();
      const w = writable.getWriter();
      const r = up.body?.getReader();
      if (!r) return json({ error: "No body" }, 500);
      transformGemini(r, w).catch(() => { try { w.close(); } catch {} });
      return sse(readable, up.status);
    }
    const txt = await up.text();
    return new Response(txt, { status: up.status, headers: { ...CORS, "Content-Type": up.headers.get("content-type") || "application/json" } });
  }

  // Standard OpenAI-compatible
  const init: RequestInit = { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` }, body: bodyText };
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 120000);
  init.signal = ac.signal;
  let up: Response;
  try { up = await fetch(base + "/chat/completions", init); } finally { clearTimeout(to); }
  if (up.headers.get("content-type")?.includes("text/event-stream")) return sse(up.body, up.status);
  const txt = await up.text();
  return new Response(txt, { status: up.status, headers: { ...CORS, "Content-Type": up.headers.get("content-type") || "application/json" } });
}

// Model listing — forwards GET /models to the upstream
async function handleModels(req: Request): Promise<Response> {
  const prov = req.headers.get("x-provider") || "";
  const ep = req.headers.get("x-endpoint");
  const uk = req.headers.get("x-api-key") || "";

  let key = uk;
  if (!key) {
    if (prov === "custom") key = AMD_KEY;
    else if (prov === "firework" || prov === "fireworks") key = FW_KEY;
  }
  if (!key) return json({ error: "No API key" }, 400);

  let base = "";
  const p = prov;
  if (p === "custom") base = ep || AMD_URL;
  else if (p === "firework" || p === "fireworks") base = "https://api.fireworks.ai/inference/v1";
  else if (p === "openai") base = "https://api.openai.com/v1";
  else if (p === "openrouter") base = "https://openrouter.ai/api/v1";
  else if (p === "mistral") base = "https://api.mistral.ai/v1";
  else if (p === "gemini") {
    // Gemini uses key as query param
    const up = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, { signal: AbortSignal.timeout(10000) });
    const txt = await up.text();
    return new Response(txt, { status: up.status, headers: { ...CORS, "Content-Type": up.headers.get("content-type") || "application/json" } });
  }
  if (!base) return json({ error: `Unknown provider: ${p}` }, 400);

  const up = await fetch(base + "/models", {
    headers: { "Authorization": `Bearer ${key}` },
    signal: AbortSignal.timeout(10000),
  });
  const txt = await up.text();
  return new Response(txt, { status: up.status, headers: { ...CORS, "Content-Type": up.headers.get("content-type") || "application/json" } });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const a = new URL(req.url).searchParams.get("action");
    if (a === "health") return handleHealth();
    if (a === "models") return handleModels(req);
    if (a === "supabase") {
      const t = new URL(req.url).searchParams.get("table") || "";
      if (t === "matches" || t === "rounds") return handleSupabase(t, req);
      return json({ error: "Invalid table" }, 400);
    }
    return handleChat(req);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  }
}
