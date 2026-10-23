import { randomUUID } from "node:crypto";
import { waitUntil as vercelWaitUntil } from "@vercel/functions";

import { settings } from "../lib/config.js";
import { buildSearchQuery, buildSystemPrompt, buildUserContext } from "../lib/context.js";
import { streamGemini } from "../lib/gemini.js";
import { searchWeb } from "../lib/search.js";
import { loadJob, saveJob, storeConfigured } from "../lib/store.js";
import {
  appendHistory,
  cutToLastSentence,
  fitAliceText,
  isExitPhrase,
  isFollowUp,
  isPing,
  isSearchIntent,
  safeHistory,
  toTts
} from "../lib/text.js";

const MIN_PARTIAL_CHARS = 40;

const PHRASES = {
  greeting: "К вашим услугам, сэр. Чем могу помочь?",
  goodbye: "Всегда к вашим услугам, сэр. До связи.",
  pong: "Джарвис на связи.",
  thinking: "Минуту, сэр, наведу справки. Скажите «ну что», и я доложу.",
  stillThinking: "Ещё работаю над этим, сэр. Спросите через пару секунд.",
  lost: "Боюсь, ответ где-то затерялся, сэр. Повторите, пожалуйста, вопрос."
};

function aliceResponse(text, endSession = false, history = [], extraState = {}) {
  const finalText = fitAliceText(text);
  return {
    version: "1.0",
    response: {
      text: finalText,
      tts: toTts(finalText),
      end_session: endSession
    },
    session_state: { history: safeHistory(history), ...extraState }
  };
}

function errorCode(error) {
  if (error?.name === "AbortError") return "TIME_BUDGET_EXHAUSTED";
  return String(error?.message || "UNKNOWN");
}

function errorForUser(code) {
  switch (code) {
    case "MISSING_GEMINI_KEY":
      return "Сервер пока не настроен. Проверьте переменную GEMINI_API_KEY в настройках Vercel.";
    case "GEMINI_KEY_REJECTED":
      return "Не удалось подключиться к Gemini. Проверьте API-ключ в настройках Vercel.";
    case "GEMINI_QUOTA":
      return "Сейчас превышен лимит запросов к Gemini. Попробуйте немного позже, сэр.";
    case "GEMINI_MODEL_NOT_FOUND":
    case "INVALID_MODEL_NAME":
      return "Модель Gemini не найдена. Проверьте переменную GEMINI_MODEL в настройках Vercel.";
    case "GEMINI_BLOCKED":
      return "Боюсь, на этот запрос я ответить не могу, сэр. Попробуйте спросить иначе.";
    case "TIME_BUDGET_EXHAUSTED":
      return "Не успел подготовить ответ, сэр. Попробуйте спросить ещё раз, чуть короче.";
    default:
      return "Не получилось получить ответ от нейросети. Попробуйте ещё раз чуть позже, сэр.";
  }
}

function validPending(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.id !== "string" || !/^[0-9a-f-]{36}$/i.test(value.id)) return null;
  return {
    id: value.id,
    question: String(value.question || "").slice(0, 400),
    startedAt: Number(value.startedAt) || 0
  };
}

function raceDeadline(promise, ms) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve({ status: "timeout" }), Math.max(0, ms));
  });
  return Promise.race([
    promise.then(value => ({ status: "done", value }), error => ({ status: "error", error })),
    timeout
  ]).finally(() => clearTimeout(timer));
}

/**
 * Запускает поиск (если нужен) и стриминговую генерацию.
 * progress.text наполняется по мере прихода ответа — его можно отдать частично.
 */
function startGeneration({ text, history, ctx, cfg, startedAt, background }) {
  const controller = new AbortController();
  const progress = { text: "", firstTokenAt: 0, searchMs: 0, searched: false };
  const elapsed = () => Date.now() - startedAt;

  // В обычном режиме дедлайн контролирует raceDeadline, здесь только страховка от зависания.
  const hardLimit = background ? cfg.backgroundTimeoutMs : cfg.deadlineMs - elapsed() + 1000;
  const timer = setTimeout(() => controller.abort(), Math.max(200, hardLimit));

  const promise = (async () => {
    try {
      let searchContext = "";
      if (cfg.serperKey && isSearchIntent(text)) {
        const budget = background
          ? cfg.serperTimeoutMs
          : Math.min(cfg.serperTimeoutMs, cfg.deadlineMs - elapsed() - cfg.geminiReserveMs);
        const t0 = Date.now();
        searchContext = await searchWeb(buildSearchQuery(text, ctx), budget, cfg, controller.signal);
        progress.searchMs = Date.now() - t0;
        progress.searched = Boolean(searchContext);
      }
      return await streamGemini({
        text,
        history,
        searchContext,
        systemPrompt: buildSystemPrompt(ctx),
        cfg,
        signal: controller.signal,
        progress
      });
    } finally {
      clearTimeout(timer);
    }
  })();
  promise.catch(() => {}); // результат обрабатывается в другом месте; без этого Node ругается на unhandled rejection

  return { promise, progress, abort: () => controller.abort() };
}

function logTiming(fields) {
  // Только служебные метрики: ни текста пользователя, ни ключей.
  console.log(JSON.stringify({ event: "alice_request", ...fields }));
}

export function createHandler({ waitUntil = vercelWaitUntil } = {}) {
  return async function handler(req, res) {
    if (req.method === "GET") {
      // Этот же адрес удобно дёргать мониторингом раз в 5 минут, чтобы функция не «засыпала».
      return res.status(200).json({
        ok: true,
        service: "alice-gemini-serper",
        message: "Webhook is ready. Yandex Dialogs should send POST requests to /api."
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const startedAt = Date.now();
    const cfg = settings();
    const body = req.body && typeof req.body === "object" ? req.body : {};

    if (cfg.skillId && body?.session?.skill_id !== cfg.skillId) {
      console.warn("Rejected request with unexpected skill_id");
      return res.status(403).json({ error: "Forbidden" });
    }

    const original = String(body?.request?.original_utterance || "").trim();
    const text = String(body?.request?.command || original).trim();
    const sessionState = body?.state?.session || {};
    const history = safeHistory(sessionState.history);
    const pending = validPending(sessionState.pending);
    const send = payload => res.status(200).json(payload);

    // Проверка доступности от Яндекса: отвечаем сразу, без внешних вызовов.
    if (isPing(original)) return send(aliceResponse(PHRASES.pong, false, history));

    if (isExitPhrase(text)) return send(aliceResponse(PHRASES.goodbye, true, []));

    const asyncEnabled = cfg.asyncMode !== "off" && storeConfigured(cfg) && typeof waitUntil === "function";

    // Пользователь спрашивает «ну что?» — отдаём результат фоновой генерации.
    if (pending && asyncEnabled && (!text || isFollowUp(text))) {
      const remaining = cfg.deadlineMs - (Date.now() - startedAt);
      const job = await loadJob(cfg, pending.id, Math.max(300, Math.min(1200, remaining))).catch(() => null);

      if (job?.status === "done" && job.answer) {
        logTiming({ outcome: "pending_delivered", totalMs: Date.now() - startedAt });
        return send(aliceResponse(job.answer, false, appendHistory(history, pending.question, job.answer)));
      }
      if (job?.status === "error") {
        logTiming({ outcome: "pending_error", code: job.code, totalMs: Date.now() - startedAt });
        return send(aliceResponse(errorForUser(job.code), false, history));
      }
      if (Date.now() - pending.startedAt < cfg.backgroundTimeoutMs + 5000) {
        return send(aliceResponse(PHRASES.stillThinking, false, history, { pending }));
      }
      return send(aliceResponse(PHRASES.lost, false, history));
    }
    // Если пришёл новый вопрос, незабранный фоновый ответ просто отбрасываем.

    if (!text) return send(aliceResponse(PHRASES.greeting, false, history));

    const ctx = buildUserContext(body, cfg);
    const job = startGeneration({ text, history, ctx, cfg, startedAt, background: asyncEnabled });
    const outcome = await raceDeadline(job.promise, cfg.deadlineMs - (Date.now() - startedAt));

    const metrics = () => ({
      model: cfg.geminiModel,
      totalMs: Date.now() - startedAt,
      searchMs: job.progress.searchMs || undefined,
      firstTokenMs: job.progress.firstTokenAt ? job.progress.firstTokenAt - startedAt : undefined
    });

    if (outcome.status === "done") {
      logTiming({ outcome: "ok", ...metrics() });
      return send(aliceResponse(outcome.value, false, appendHistory(history, text, outcome.value)));
    }

    if (outcome.status === "error") {
      const code = errorCode(outcome.error);
      logTiming({ outcome: "error", code, ...metrics() });
      return send(aliceResponse(errorForUser(code), false, history));
    }

    // Дедлайн. Вариант 1: режим «ещё думаю» — дорабатываем в фоне и сохраняем результат.
    if (asyncEnabled) {
      const id = randomUUID();
      waitUntil(
        job.promise
          .then(
            answer => saveJob(cfg, id, { status: "done", answer }),
            error => saveJob(cfg, id, { status: "error", code: errorCode(error) })
          )
          .catch(() => console.warn("Failed to save background result"))
      );
      logTiming({ outcome: "deferred", ...metrics() });
      return send(aliceResponse(PHRASES.thinking, false, history, {
        pending: { id, question: text.slice(0, 400), startedAt: Date.now() }
      }));
    }

    // Вариант 2: отдаём то, что модель успела написать, до последнего законченного предложения.
    job.abort();
    const partial = cutToLastSentence(job.progress.text);
    if (partial.length >= MIN_PARTIAL_CHARS) {
      logTiming({ outcome: "partial", ...metrics() });
      return send(aliceResponse(partial, false, appendHistory(history, text, partial)));
    }

    logTiming({ outcome: "timeout", ...metrics() });
    return send(aliceResponse(errorForUser("TIME_BUDGET_EXHAUSTED"), false, history));
  };
}

export default createHandler();

export { aliceResponse, errorForUser, fitAliceText, isSearchIntent, safeHistory };
