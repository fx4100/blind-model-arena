import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key, x-provider, x-endpoint",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

async function transformGeminiSSE(reader: ReadableStreamDefaultReader<Uint8Array>, writer: WritableStreamDefaultWriter<Uint8Array>): Promise<void> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";

      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data: ")) continue;
        const js = t.slice(6);
        if (!js) continue;

        try {
          const json = JSON.parse(js);
          const cands = json.candidates || [];
          for (const c of cands) {
            const txt = c.content?.parts?.[0]?.text || "";
            if (txt) {
              const oai = JSON.stringify({ choices: [{ delta: { content: txt }, index: 0 }] });
              await writer.write(encoder.encode("data: " + oai + "\n\n"));
            }
          }
          if (cands.some((c: any) => c.finishReason)) {
            await writer.write(encoder.encode("data: [DONE]\n\n"));
          }
        } catch {
          // skip bad chunks
        }
      }
    }
  } finally {
    try { await writer.close(); } catch { /* writer already closed */ }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const provider = req.headers.get("x-provider") || "";
    const apiKey = req.headers.get("x-api-key") || "";
    const customEndpoint = req.headers.get("x-endpoint");

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing x-api-key header" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let targetBaseUrl = "";
    if (provider === "openai") {
      targetBaseUrl = "https://api.openai.com/v1";
    } else if (provider === "openrouter") {
      targetBaseUrl = "https://openrouter.ai/api/v1";
    } else if (provider === "mistral") {
      targetBaseUrl = "https://api.mistral.ai/v1";
    } else if (provider === "gemini") {
      targetBaseUrl = "https://generativelanguage.googleapis.com";
    } else if (provider === "fireworks") {
      targetBaseUrl = "https://api.fireworks.ai/inference/v1";
    }

    if (customEndpoint) {
      targetBaseUrl = customEndpoint;
    }

    if (!targetBaseUrl) {
      return new Response(JSON.stringify({ error: `Unsupported provider: ${provider}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const suffix = url.pathname
      .replace(/^\/functions\/v1\/llm-proxy/, "")
      .replace(/^\/llm-proxy/, "") || "/chat/completions";

    let fetchUrl = "";
    const fetchHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const init: RequestInit = {
      method: req.method,
      headers: fetchHeaders,
    };

    if (provider === "gemini") {
      if (suffix.includes("models")) {
        fetchUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
      } else {
        if (req.method === "POST") {
          const rawBody = JSON.parse(await req.text());
          const modelId = rawBody.model || url.searchParams.get("model") || "gemini-2.0-flash";
          const messages = rawBody.messages || [];
          const contents = messages
            .filter((m: any) => m.role !== "system")
            .map((m: any) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: m.content }],
            }));
          const geminiBody: Record<string, unknown> = { contents };
          const sysMsgs = messages.filter((m: any) => m.role === "system");
          if (sysMsgs.length > 0) {
            geminiBody.systemInstruction = {
              parts: [{ text: sysMsgs.map((m: any) => m.content).join("\n") }],
            };
          }
          init.body = JSON.stringify(geminiBody);
          fetchUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}&alt=sse`;
        } else {
          fetchUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        }
      }
    } else {
      fetchUrl = `${targetBaseUrl.replace(/\/+$/, "")}${suffix}`;
      fetchHeaders["Authorization"] = `Bearer ${apiKey}`;
      if (req.method === "POST") {
        init.body = await req.text();
      }
    }

    // 120s upstream fetch timeout (LLM APIs can be slow)
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 120000);
    init.signal = ac.signal;

    let forwardRes: Response;
    try {
      forwardRes = await fetch(fetchUrl, init);
    } finally {
      clearTimeout(to);
    }

    // Helper: build SSE response
    function sseRes(body: ReadableStream<Uint8Array> | null, status: number): Response {
      return new Response(body, {
        status,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // Gemini SSE -> OpenAI SSE transform (only for successful upstream)
    if (forwardRes.ok && provider === "gemini" && forwardRes.headers.get("content-type")?.includes("text/event-stream")) {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const reader = forwardRes.body?.getReader();
      if (!reader) {
        return new Response("No response body", { status: 500, headers: corsHeaders });
      }

      // Fire with .catch so rejections don't crash the function
      transformGeminiSSE(reader, writer)
        .catch((e) => {
          console.error("transform error:", e);
          try { writer.close(); } catch { /* ignore */ }
        });

      return sseRes(readable, forwardRes.status);
    }

    // Passthrough for all other SSE responses
    if (forwardRes.headers.get("content-type")?.includes("text/event-stream")) {
      return sseRes(forwardRes.body, forwardRes.status);
    }

    // Non-SSE response
    const resText = await forwardRes.text();
    return new Response(resText, {
      status: forwardRes.status,
      headers: {
        ...corsHeaders,
        "Content-Type": forwardRes.headers.get("content-type") || "application/json",
      },
    });

  } catch (err: any) {
    const errMsg = err?.message || String(err);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
