// Общие заглушки для тестов: фейковые Gemini, Serper и Upstash поверх globalThis.fetch.

export function sseStream(pieces, { delayMs = 0, signal } = {}) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const onAbort = () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        try { controller.error(err); } catch {}
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      for (const piece of pieces) {
        if (signal?.aborted) return;
        if (delayMs) await new Promise(r => setTimeout(r, delayMs));
        if (signal?.aborted) return;
        const chunk = { candidates: [{ content: { parts: [{ text: piece }] } }] };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\r\n\r\n`));
      }
      if (!signal?.aborted) {
        const last = { candidates: [{ content: { parts: [] }, finishReason: "STOP" }] };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(last)}\r\n\r\n`));
        controller.close();
      }
    }
  });
}

export function installFetch({ gemini, serper, redis } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url: u, body, headers: options.headers });
    if (u.includes("generativelanguage.googleapis.com")) return gemini(body, options);
    if (u.includes("google.serper.dev")) return serper(body, options);
    if (redis && u.startsWith("https://redis.test")) return redis(body, options);
    throw new Error(`Unexpected fetch ${u}`);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

export function memoryRedis() {
  const data = new Map();
  const handler = async body => {
    const [cmd, key, value] = body;
    if (cmd === "SET") { data.set(key, value); return Response.json({ result: "OK" }); }
    if (cmd === "GET") return Response.json({ result: data.has(key) ? data.get(key) : null });
    return Response.json({ error: "unknown" });
  };
  return { data, handler };
}

export function mockRes() {
  const res = {
    statusCode: 0, body: undefined, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(k, v) { this.headers[k] = v; }
  };
  return res;
}

export function aliceRequest(command, { state, timezone = "Asia/Tashkent", skillId = "skill-1", isNew = false } = {}) {
  return {
    method: "POST",
    body: {
      meta: { locale: "ru-RU", timezone, client_id: "test" },
      session: { new: isNew, session_id: "s1", skill_id: skillId, message_id: 1 },
      request: { command, original_utterance: command, type: "SimpleUtterance" },
      state: { session: state || {} },
      version: "1.0"
    }
  };
}

export const ENV_KEYS = [
  "GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_THINKING", "SERPER_API_KEY", "RESPONSE_DEADLINE_MS",
  "ALICE_SKILL_ID", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL",
  "KV_REST_API_TOKEN", "ASYNC_MODE", "USER_TIMEZONE", "USER_CITY", "SEARCH_LOCATION", "BACKGROUND_TIMEOUT_MS"
];

export function resetEnv(overrides = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, { GEMINI_API_KEY: "test-key", ...overrides });
}
