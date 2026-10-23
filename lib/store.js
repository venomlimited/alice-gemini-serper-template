// Хранилище результатов для режима «ещё думаю»: Upstash Redis через REST API, без зависимостей.
// Работает с переменными UPSTASH_REDIS_REST_URL/TOKEN или KV_REST_API_URL/TOKEN (интеграция Vercel).

const KEY_PREFIX = "alice:job:";
const TTL_SECONDS = 600;

export function storeConfigured(cfg) {
  return Boolean(cfg.redisUrl && cfg.redisToken);
}

async function redis(cfg, command, timeoutMs = 800) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(cfg.redisUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.redisToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`REDIS_HTTP_${response.status}`);
    const data = await response.json();
    if (data?.error) throw new Error("REDIS_ERROR");
    return data?.result;
  } finally {
    clearTimeout(timer);
  }
}

export async function saveJob(cfg, id, value) {
  await redis(cfg, ["SET", KEY_PREFIX + id, JSON.stringify(value), "EX", TTL_SECONDS], 3000);
}

export async function loadJob(cfg, id, timeoutMs = 800) {
  const raw = await redis(cfg, ["GET", KEY_PREFIX + id], timeoutMs);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
