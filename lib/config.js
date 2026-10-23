// Все настройки в одном месте. Значения читаются при каждом запросе,
// чтобы их можно было менять переменными окружения Vercel без правки кода.

export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

// Алиса ждёт ответ навыка 4,5 с, включая сеть в обе стороны.
// Свой дедлайн держим заметно раньше, чтобы осталось время на доставку ответа.
export const ALICE_TIMEOUT_MS = 4500;

export const MAX_ALICE_TEXT = 1024;
export const MAX_HISTORY_MESSAGES = 6;
export const MAX_HISTORY_MESSAGE_CHARS = 400;
export const MAX_OUTPUT_TOKENS = 200;

function numberFromEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function settings() {
  return {
    // Через сколько мс после получения запроса навык обязан ответить.
    deadlineMs: numberFromEnv("RESPONSE_DEADLINE_MS", 3300, 1500, 4200),
    // Лимит на поиск Serper в обычном режиме и в фоновом.
    serperTimeoutMs: numberFromEnv("SERPER_TIMEOUT_MS", 1200, 300, 3000),
    serperBackgroundTimeoutMs: 2500,
    // Сколько резервировать под Gemini, прежде чем решиться на поиск.
    geminiReserveMs: numberFromEnv("GEMINI_RESERVE_MS", 1600, 500, 3500),
    // Сколько максимум ждать Gemini в фоновом режиме «ещё думаю».
    backgroundTimeoutMs: numberFromEnv("BACKGROUND_TIMEOUT_MS", 20000, 5000, 55000),

    geminiKey: process.env.GEMINI_API_KEY || "",
    geminiModel: String(process.env.GEMINI_MODEL || DEFAULT_MODEL).trim(),
    geminiThinking: String(process.env.GEMINI_THINKING || "auto").trim().toLowerCase(),

    serperKey: process.env.SERPER_API_KEY || "",
    searchCountry: String(process.env.SEARCH_COUNTRY || "uz").trim().toLowerCase(),
    searchLanguage: String(process.env.SEARCH_LANGUAGE || "ru").trim().toLowerCase(),
    // Необязательно: точное имя локации в формате Google, например "Tashkent,Tashkent,Uzbekistan".
    searchLocation: String(process.env.SEARCH_LOCATION || "").trim(),

    userName: String(process.env.USER_NAME || "Михаил").trim(),
    userCity: String(process.env.USER_CITY || "Ташкент").trim(),
    userCountry: String(process.env.USER_COUNTRY || "Узбекистан").trim(),
    // Если задан, перекрывает часовой пояс из запроса Алисы.
    userTimezoneOverride: String(process.env.USER_TIMEZONE || "").trim(),
    defaultTimezone: "Asia/Tashkent",

    // Если задан, навык отвечает только на запросы с этим skill_id.
    skillId: String(process.env.ALICE_SKILL_ID || "").trim(),

    redisUrl: String(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "").trim(),
    redisToken: String(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "").trim(),
    asyncMode: String(process.env.ASYNC_MODE || "auto").trim().toLowerCase()
  };
}
