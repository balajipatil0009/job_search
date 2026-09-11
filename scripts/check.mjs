import "dotenv/config";

const t = process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
const c = process.env.TELEGRAM_CHAT_ID?.trim() || "";
console.log("TELEGRAM_BOT_TOKEN set:", !!t, "| length:", t.length, "| format ok:", /^\d+:[\w-]+$/.test(t));
console.log("TELEGRAM_CHAT_ID:", c || "(missing)");
console.log("ADZUNA creds set:", !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY));
console.log("MIN_SALARY:", process.env.MIN_SALARY, "| KEYWORDS:", process.env.KEYWORDS);

if (t) {
  const r = await fetch(`https://api.telegram.org/bot${t}/getMe`);
  const j = await r.json();
  console.log("getMe:", j.ok ? `OK @${j.result.username}` : `FAIL -> ${j.description}`);
}
