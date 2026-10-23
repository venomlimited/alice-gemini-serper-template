import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cutToLastSentence, fitAliceText, isExitPhrase, isFollowUp, isPing, isSearchIntent,
  mentionsPlace, safeHistory, toTts
} from "../lib/text.js";
import { buildSearchQuery, buildSystemPrompt, buildUserContext, resolveTimezone } from "../lib/context.js";
import { thinkingConfigFor } from "../lib/gemini.js";
import { settings } from "../lib/config.js";
import { resetEnv } from "./helpers.js";

test("fitAliceText укладывается в 1024 символа и чистит Markdown", () => {
  assert.equal(fitAliceText("**Привет**, сэр"), "Привет, сэр");
  const long = "Предложение номер один. ".repeat(100);
  const fitted = fitAliceText(long);
  assert.ok(fitted.length <= 1024);
  assert.ok(fitted.endsWith("."));
  assert.equal(fitAliceText(""), "Не удалось подготовить ответ.");
});

test("toTts убирает ссылки", () => {
  assert.equal(toTts("Смотрите https://example.com/x тут"), "Смотрите тут");
});

test("cutToLastSentence отдаёт только законченные предложения", () => {
  assert.equal(cutToLastSentence("Первое предложение. Второе недописан"), "Первое предложение.");
  assert.equal(cutToLastSentence("Без точки вообще"), "");
});

test("распознавание интентов", () => {
  assert.ok(isSearchIntent("какая погода завтра"));
  assert.ok(isSearchIntent("кто выиграл вчерашний матч"));
  assert.ok(!isSearchIntent("расскажи анекдот"));
  assert.ok(isPing("ping"));
  assert.ok(isExitPhrase("хватит"));
  assert.ok(isExitPhrase("Алиса, стоп!"));
  assert.ok(!isExitPhrase("хватит ли мне денег на отпуск"));
  assert.ok(isFollowUp("ну что"));
  assert.ok(isFollowUp("Ну что?"));
  assert.ok(!isFollowUp("что такое квазар"));
});

test("mentionsPlace отличает город от времени", () => {
  assert.ok(mentionsPlace("погода в москве"));
  assert.ok(mentionsPlace("погода в самарканде на завтра"));
  assert.ok(!mentionsPlace("погода в выходные"));
  assert.ok(!mentionsPlace("погода на завтра"));
  assert.ok(!mentionsPlace("какая погода сегодня"));
});

test("поисковый запрос дополняется городом пользователя", () => {
  resetEnv();
  const ctx = buildUserContext({ meta: { timezone: "Asia/Tashkent" } }, settings());
  assert.equal(buildSearchQuery("какая погода сегодня", ctx), "какая погода сегодня Ташкент");
  assert.equal(buildSearchQuery("погода в москве", ctx), "погода в москве");
  assert.equal(buildSearchQuery("погода в ташкенте", ctx), "погода в ташкенте");
  assert.equal(buildSearchQuery("последние новости apple", ctx), "последние новости apple");
});

test("часовой пояс: USER_TIMEZONE → запрос Алисы → Ташкент", () => {
  resetEnv();
  assert.equal(resolveTimezone({ meta: { timezone: "Europe/Moscow" } }, settings()), "Europe/Moscow");
  assert.equal(resolveTimezone({ meta: { timezone: "Not/AZone" } }, settings()), "Asia/Tashkent");
  assert.equal(resolveTimezone({}, settings()), "Asia/Tashkent");
  resetEnv({ USER_TIMEZONE: "Asia/Tashkent" });
  assert.equal(resolveTimezone({ meta: { timezone: "Europe/Moscow" } }, settings()), "Asia/Tashkent");
});

test("системный промпт содержит город и время", () => {
  resetEnv();
  const ctx = buildUserContext({ meta: { timezone: "Asia/Tashkent" } }, settings(), new Date("2026-10-23T09:05:00Z"));
  const prompt = buildSystemPrompt(ctx);
  assert.match(prompt, /Ташкент/);
  assert.match(prompt, /23 октября 2026/);
  assert.match(prompt, /14:05/);
  assert.doesNotMatch(prompt, /Москв/);
});

test("настройки размышлений под модель", () => {
  assert.deepEqual(thinkingConfigFor("gemini-3.5-flash-lite"), { thinkingLevel: "minimal" });
  assert.deepEqual(thinkingConfigFor("gemini-2.5-flash-lite"), { thinkingBudget: 0 });
  assert.equal(thinkingConfigFor("gemini-2.5-pro"), null);
  assert.equal(thinkingConfigFor("gemini-3.5-flash-lite", "off"), null);
  assert.deepEqual(thinkingConfigFor("gemini-4-argon", "low"), { thinkingLevel: "low" });
});

test("safeHistory фильтрует и обрезает", () => {
  const h = safeHistory([{ role: "user", text: "a".repeat(1000) }, { role: "x", text: "b" }, null]);
  assert.equal(h.length, 1);
  assert.equal(h[0].text.length, 400);
});
