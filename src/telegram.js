import { config } from "./config.js";
import { cleanTitle, cleanCompany, normalizeLocation, formatSalary, typeLabel } from "./clean.js";

const API = "https://api.telegram.org";

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncate(s = "", n = 200) {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

/** One self-contained Telegram message per job. */
export function formatJobMessage(job) {
  const title = cleanTitle(job.title) || "Untitled role";
  const company = cleanCompany(job.company);
  const location = normalizeLocation(job.location);
  const salary = formatSalary(job);

  const lines = [
    `🎯 <b><a href="${escapeHtml(job.url)}">${escapeHtml(title)}</a></b>`,
    `🏢 ${escapeHtml(company)}`,
  ];
  if (location) lines.push(`📍 ${escapeHtml(location)}`);
  lines.push(`💰 ${escapeHtml(salary)}`);
  if (job.type) lines.push(`💼 ${escapeHtml(typeLabel(job.type))}`);
  if (job.jd) lines.push(`📝 ${escapeHtml(truncate(job.jd, config.jdSnippetChars))}`);
  if (job.url) lines.push(`🔗 Apply: ${escapeHtml(job.url)}`);
  lines.push(`🔎 ${escapeHtml(job.source)}`);
  return lines.join("\n");
}

function chunk(text, size = 3900) {
  const out = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n", size);
    if (cut < size * 0.5) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest);
  return out;
}

export async function sendMessage(token, chatId, text) {
  for (const part of chunk(text)) {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: part,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.ok === false) {
      const err = new Error(`Telegram ${res.status}: ${data?.description || "send failed"}`);
      if (data?.parameters?.retry_after) err.retryAfter = data.parameters.retry_after;
      throw err;
    }
  }
}

export async function getChat(token, chatId) {
  const res = await fetch(`${API}/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`);
  const data = await res.json().catch(() => null);
  if (!data?.ok) throw new Error(data?.description || `getChat HTTP ${res.status}`);
  return data.result;
}

export async function getUpdates(token, offset, timeout = 25) {
  const params = new URLSearchParams({
    timeout: String(timeout),
    offset: String(offset),
    allowed_updates: JSON.stringify(["message"]),
  });
  const res = await fetch(`${API}/bot${token}/getUpdates?${params}`);
  if (!res.ok) throw new Error(`Telegram getUpdates HTTP ${res.status}`);
  const data = await res.json();
  return data.result || [];
}
