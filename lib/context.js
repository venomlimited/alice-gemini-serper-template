import { isLocalTopic, mentionsPlace } from "./text.js";

const PERSONA = [
  "Ты — Джарвис, персональный ИИ-ассистент, работающий через голосовую колонку.",
  "Твой стиль: безупречно вежливый британский дворецкий с технологичным умом. Обращайся к пользователю «сэр».",
  "Говори спокойно, уверенно и чуть иронично; сухой, тонкий юмор уместен, но без клоунады.",
  "Отвечай по-русски, кратко: обычно 1–3 предложения, удобных для прослушивания. Без Markdown, списков, ссылок и длинных вступлений.",
  "Числа, даты и единицы измерения пиши так, чтобы их было удобно произносить.",
  "Если переданы результаты поиска, опирайся на них и не выдумывай факты.",
  "Если не знаешь ответа, признай это с достоинством, например: «Боюсь, этими данными я не располагаю, сэр»."
].join(" ");

export function isValidTimezone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Часовой пояс: переменная USER_TIMEZONE → часовой пояс устройства из запроса Алисы → Asia/Tashkent.
export function resolveTimezone(body, cfg) {
  if (isValidTimezone(cfg.userTimezoneOverride)) return cfg.userTimezoneOverride;
  const fromAlice = body?.meta?.timezone;
  if (isValidTimezone(fromAlice)) return fromAlice;
  return cfg.defaultTimezone;
}

export function formatNow(timezone, now = new Date()) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(now);
}

export function buildUserContext(body, cfg, now = new Date()) {
  const timezone = resolveTimezone(body, cfg);
  return {
    name: cfg.userName,
    city: cfg.userCity,
    country: cfg.userCountry,
    timezone,
    nowText: formatNow(timezone, now)
  };
}

export function buildSystemPrompt(ctx) {
  const who = ctx.name ? `Ты помогаешь пользователю по имени ${ctx.name}.` : "";
  const where = ctx.city
    ? `Пользователь находится в городе ${ctx.city}${ctx.country ? ` (${ctx.country})` : ""}. ` +
      `Если вопрос зависит от места (погода, время, новости, цены, заведения) и другой город не назван, имей в виду ${ctx.city}.`
    : "";
  const when = `Сейчас ${ctx.nowText} (часовой пояс ${ctx.timezone}). Используй это для вопросов о дате и времени.`;
  return [PERSONA, who, where, when].filter(Boolean).join(" ");
}

// В локальных вопросах без названного города добавляем город пользователя в запрос к поиску.
export function buildSearchQuery(text, ctx) {
  const query = String(text ?? "").trim();
  if (!ctx?.city) return query;
  const cityStem = ctx.city.toLowerCase().slice(0, 6);
  if (query.toLowerCase().includes(cityStem)) return query;
  if (isLocalTopic(query) && !mentionsPlace(query)) return `${query} ${ctx.city}`;
  return query;
}
