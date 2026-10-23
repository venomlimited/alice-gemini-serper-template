import { MAX_ALICE_TEXT, MAX_HISTORY_MESSAGES, MAX_HISTORY_MESSAGE_CHARS } from "./config.js";

function normalizeSpaces(value) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Убирает разметку, которую модель иногда всё же присылает, — Алиса её озвучит.
export function stripMarkdown(value) {
  return String(value ?? "")
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*#+\s+/gm, "");
}

export function fitAliceText(value) {
  const text = normalizeSpaces(stripMarkdown(value));

  if (text.length <= MAX_ALICE_TEXT) return text || "Не удалось подготовить ответ.";

  const candidate = text.slice(0, MAX_ALICE_TEXT - 1);
  const sentenceEnd = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("? ")
  );
  if (sentenceEnd >= 300) return candidate.slice(0, sentenceEnd + 1).trim();

  const lastSpace = candidate.lastIndexOf(" ");
  return (lastSpace > 200 ? candidate.slice(0, lastSpace) : candidate).trim() + "…";
}

// Текст для синтеза речи: без ссылок и символов, которые Алиса читает вслух.
export function toTts(text) {
  const tts = normalizeSpaces(
    String(text ?? "")
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/www\.\S+/gi, "")
      .replace(/[*_#`~|<>]/g, " ")
      .replace(/…/g, "...")
  );
  return tts.slice(0, MAX_ALICE_TEXT);
}

// Обрезает недописанный (стриминговый) ответ до последнего законченного предложения.
export function cutToLastSentence(value) {
  const text = normalizeSpaces(stripMarkdown(value));
  let end = -1;
  const re = /[.!?…](?=\s|$)/g;
  let match;
  while ((match = re.exec(text)) !== null) end = match.index;
  return end >= 0 ? text.slice(0, end + 1).trim() : "";
}

export function isSearchIntent(text) {
  return /\b(latest|today|current|news|weather|price|exchange rate|recent|search|look up)\b|сегодня|сейчас|завтра|вчера|последн|новост|погод|температур|прогноз|курс|найди|поищи|актуальн|сколько стоит|цена|цены|свежие данные|счёт матча|счет матча|кто выиграл|результат матча|расписание|пробк/i.test(text);
}

// Темы, где важно место: если город не назван, добавляем город пользователя в поисковый запрос.
export function isLocalTopic(text) {
  return /погод|температур|прогноз|дожд|снег|ветер|осадк|жар[аы]|холодн|пробк|рядом|поблизости|недалеко|ближайш|аптек|ресторан|кафе|кинотеатр|афиш|weather|forecast|near me/i.test(text);
}

const NOT_A_PLACE = new Set([
  "выходные", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье",
  "течение", "ближайшие", "ближайшее", "начале", "конце", "середине", "этом", "этот", "эту",
  "следующем", "следующий", "следующую", "прошлом", "прошлый", "полдень", "полночь", "обед",
  "обеденное", "час", "часов", "минуту", "целом", "общем", "итоге", "дороге", "городе", "мире",
  "интернете", "сети", "среднем", "течении", "утро", "вечер", "ночь", "сравнении"
]);

// Грубая эвристика: «погода в москве» → город назван; «погода в выходные» → нет.
export function mentionsPlace(text) {
  const re = /(?:^|\s)(?:в|во|на)\s+([а-яёa-z-]{3,})/gi;
  let match;
  while ((match = re.exec(text)) !== null) {
    const word = match[1].toLowerCase();
    if (/^(завтра|сегодня|неделе|неделю|месяц|месяце|год|году|улице|улицу)$/.test(word)) continue;
    if (!NOT_A_PLACE.has(word)) return true;
  }
  return false;
}

export function isPing(text) {
  return /^ping$/i.test(String(text ?? "").trim());
}

export function isExitPhrase(text) {
  return /^(алиса[, ]+)?(хватит|стоп|выход|выйти|выйди|закончи(ть)?|заверши(ть)?|отбой|до свидания|пока|всё спасибо|все спасибо|спасибо всё|спасибо все|спасибо хватит)[.!]?$/i
    .test(normalizeSpaces(String(text ?? "").replace(/[,!.?]/g, " ")));
}

// Короткие реплики, которыми пользователь спрашивает «ну что, готово?».
export function isFollowUp(text) {
  return /^(ну\s+)?(что|и что|что там|как там|ну как|готово|готов|продолжай|продолжи|дальше|слушаю|жду|да|давай|рассказывай|докладывай|ну)$/i
    .test(normalizeSpaces(String(text ?? "").replace(/[,!.?]/g, " ")));
}

export function safeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(item => item && (item.role === "user" || item.role === "model") && typeof item.text === "string")
    .slice(-MAX_HISTORY_MESSAGES)
    .map(item => ({ role: item.role, text: item.text.slice(0, MAX_HISTORY_MESSAGE_CHARS) }));
}

export function appendHistory(history, question, answer) {
  return safeHistory([
    ...safeHistory(history),
    { role: "user", text: String(question) },
    { role: "model", text: String(answer) }
  ]);
}
