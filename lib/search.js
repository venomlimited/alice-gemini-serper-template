// Поиск через Serper. Любая ошибка или таймаут → пустая строка: навык отвечает без поиска.

async function fetchWithTimeout(url, options, timeoutMs, outerSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, timeoutMs));
  const onOuterAbort = () => controller.abort();
  outerSignal?.addEventListener?.("abort", onOuterAbort, { once: true });
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener?.("abort", onOuterAbort);
  }
}

function hostOf(link) {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function searchWeb(query, timeoutMs, cfg, signal) {
  if (!cfg.serperKey || timeoutMs < 300) return "";

  const payload = { q: query, gl: cfg.searchCountry, hl: cfg.searchLanguage, num: 3 };
  if (cfg.searchLocation) payload.location = cfg.searchLocation;

  try {
    const response = await fetchWithTimeout(
      "https://google.serper.dev/search",
      {
        method: "POST",
        headers: { "X-API-KEY": cfg.serperKey, "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      },
      timeoutMs,
      signal
    );

    if (!response.ok) {
      console.warn("Serper request failed with HTTP", response.status);
      return "";
    }
    const data = await response.json().catch(() => ({}));

    // Ссылки модели не нужны (голосовой ответ), оставляем только домен как указание на источник.
    const items = (Array.isArray(data.organic) ? data.organic : [])
      .slice(0, 3)
      .map((item, i) => {
        const title = String(item.title || "").slice(0, 160);
        const snippet = String(item.snippet || "").slice(0, 320);
        const host = hostOf(item.link);
        return `${i + 1}. ${title}: ${snippet}${host ? ` (источник: ${host})` : ""}`.trim();
      });

    const box = data.answerBox?.answer || data.answerBox?.snippet;
    if (box) items.unshift(`Краткий ответ поисковика: ${String(box).slice(0, 320)}`);
    return items.join("\n");
  } catch {
    console.warn("Serper request did not finish in time; continuing without search.");
    return "";
  }
}
