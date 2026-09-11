import { config } from "./config.js";
import { SeenStore } from "./store.js";
import { Queue } from "./queue.js";
import {
  keywordMatch,
  salaryOk,
  seniorityOk,
  typeOk,
  indiaOk,
  isFresher,
  titleKey,
} from "./filter.js";
import { fetchAdzuna } from "./sources/adzuna.js";
import { fetchHimalayas } from "./sources/himalayas.js";
import { enrichHimalayas } from "./sources/details.js";
import { sendMessage, formatJobMessage, getUpdates, getChat } from "./telegram.js";
import { authorizeLatest } from "./auth.js";
import { createTriggerServer } from "./http.js";

let paused = false;
let running = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run one poll+drain cycle; ignores overlapping triggers. */
async function triggerRun(store, queue) {
  if (running) return false;
  running = true;
  try {
    await runPost(store, queue);
    await drainQueue(queue);
  } finally {
    running = false;
  }
  return true;
}

function parseArgs() {
  const args = process.argv.slice(2);
  config.once = args.includes("--once");
  config.dryRun = args.includes("--dry");
}

async function collect() {
  const results = [];
  const adzunaReady = Boolean(config.adzuna.appId && config.adzuna.appKey);

  if (adzunaReady) {
    try {
      const jobs = await fetchAdzuna(config);
      console.log(`[source] Adzuna: ${jobs.length} jobs`);
      results.push(...jobs);
    } catch (err) {
      console.error(`[source] Adzuna failed: ${err.message}`);
    }
  } else {
    console.log("[source] Adzuna skipped (no ADZUNA_APP_ID / ADZUNA_APP_KEY)");
  }

  try {
    const jobs = await fetchHimalayas(config);
    console.log(`[source] Himalayas: ${jobs.length} jobs`);
    results.push(...jobs);
  } catch (err) {
    console.error(`[source] Himalayas failed: ${err.message}`);
  }

  return results;
}

async function enrichUnknownSalaries(jobs) {
  if (!config.enrichDetails) return jobs;
  const targets = jobs
    .filter((j) => j.source === "Himalayas" && !j.salaryMin && !j.salaryMax && j.companySlug)
    .slice(0, config.enrichMaxPerRun);
  for (const job of targets) await enrichHimalayas(job);
  if (targets.length) console.log(`[details] enriched ${targets.length} job(s)`);
  return jobs;
}

async function runPost(store, queue) {
  const jobs = await collect();

  const seenBatch = new Set();
  let pool = jobs
    .filter((j) => !store.has(j.id) && !queue.has(j.id))
    .filter((j) => keywordMatch(j, config.keywords, config.matchDescription, config.levelKeywords))
    .filter((j) => seniorityOk(j, config.seniorityBlocklist))
    .filter((j) => typeOk(j, config.typeAllowlist))
    .filter((j) => indiaOk(j, config.indiaOnly))
    .filter((j) => (seenBatch.has(j.id) ? false : (seenBatch.add(j.id), true)));

  pool = await enrichUnknownSalaries(pool);

  pool = pool.filter((j) => salaryOk(j, config.minSalary, config.includeUnknownSalary));

  const keys = new Set();
  pool = pool.filter((j) => {
    const key = titleKey(j);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });

  pool.sort((a, b) => (b.salaryMin ?? -1) - (a.salaryMin ?? -1));

  // Reserve part of each batch for fresher/entry-level roles so they
  // don't get crowded out by higher-paying mid/senior listings.
  const fresherQuota = Math.round(config.maxPerRun * config.fresherShare);
  const freshers = pool.filter(isFresher);
  const others = pool.filter((j) => !isFresher(j));

  const selected = [];
  selected.push(...freshers.slice(0, fresherQuota));
  selected.push(...others.slice(0, config.maxPerRun - selected.length));
  if (selected.length < config.maxPerRun) {
    selected.push(
      ...freshers.slice(fresherQuota, fresherQuota + (config.maxPerRun - selected.length)),
    );
  }

  if (!selected.length) {
    console.log("[run] no new matching jobs");
    return;
  }

  if (config.dryRun) {
    console.log(`\n===== DRY RUN: ${selected.length} separate message(s) =====\n`);
    selected.forEach((job, i) => {
      console.log(`--- job ${i + 1} ---`);
      console.log(formatJobMessage(job).replace(/<[^>]+>/g, ""));
      console.log();
    });
    return;
  }

  if (!config.telegramToken || !config.telegramChatId) {
    throw new Error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env");
  }

  const added = queue.push(selected);
  store.add(selected.map((j) => j.id));
  store.save();
  console.log(`[run] queued ${added} job(s) (queue depth ${queue.size()})`);
}

async function drainQueue(queue) {
  if (config.dryRun || !config.telegramToken || !config.telegramChatId) return;

  while (queue.size() > 0) {
    const item = queue.first();
    if (!item) break;
    const job = item.job;

    try {
      await sendMessage(config.telegramToken, config.telegramChatId, formatJobMessage(job));
      queue.remove(job.id);
      console.log(`[send] ok: ${job.title}`);
    } catch (err) {
      if (err.retryAfter) {
        console.log(`[send] rate limited, waiting ${err.retryAfter}s`);
        await sleep((Number(err.retryAfter) || 5) * 1000);
        continue;
      }
      item.attempts = (item.attempts || 0) + 1;
      queue.save();
      console.log(`[send] fail (${item.attempts}/${config.maxSendRetries}): ${err.message}`);
      if (item.attempts >= config.maxSendRetries) {
        queue.remove(job.id);
        console.log(`[send] dead-letter: ${job.title}`);
      }
    }

    await sleep(config.messageDelayMs + Math.floor(Math.random() * 800));
  }
}

function startScheduler(store, queue) {
  const ms = config.pollMinutes * 60 * 1000;
  console.log(`[scheduler] polling every ${config.pollMinutes} minute(s)`);
  triggerRun(store, queue).catch((e) => console.error("[run]", e.message));

  setInterval(() => {
    if (paused) return;
    triggerRun(store, queue).catch((e) => console.error("[run]", e.message));
  }, ms);
}

function helpText() {
  return [
    "<b>Job alerts bot</b>",
    `/latest user=${config.latestUser} - fetch & post new jobs now`,
    "/status - show settings + queue depth",
    "/pause - stop auto-posting",
    "/resume - resume auto-posting",
    "/clearqueue - empty the pending queue",
    "/help - this message",
  ].join("\n");
}

/** Accept the configured chat by numeric id OR @username. */
function isTargetChat(chat) {
  const target = (config.telegramChatId || "").toLowerCase();
  if (!target) return true;
  const id = String(chat.id);
  const username = (chat.username || "").toLowerCase();
  return id === config.telegramChatId || username === target.replace(/^@/, "");
}

async function startCommands(store, queue) {
  if (!config.telegramToken || config.dryRun) return;
  let offset = 0;
  console.log("[bot] command listener started");
  for (;;) {
    try {
      const updates = await getUpdates(config.telegramToken, offset);
      for (const u of updates) {
        offset = u.update_id + 1;
        const msg = u.message;
        if (!msg?.text) continue;
        if (!isTargetChat(msg.chat)) continue;

        const cmd = msg.text.trim().split(/\s+/)[0].toLowerCase().split("@")[0];
        if (cmd === "/help" || cmd === "/start") {
          await sendMessage(config.telegramToken, msg.chat.id, helpText());
        } else if (cmd === "/status") {
          await sendMessage(
            config.telegramToken,
            msg.chat.id,
            `Every ${config.pollMinutes}m • min ₹${config.minSalary} • queue ${queue.size()} • ${paused ? "PAUSED" : "ACTIVE"}`,
          );
        } else if (cmd === "/pause") {
          paused = true;
          await sendMessage(config.telegramToken, msg.chat.id, "⏸ Paused.");
        } else if (cmd === "/resume") {
          paused = false;
          await sendMessage(config.telegramToken, msg.chat.id, "▶️ Resumed.");
        } else if (cmd === "/clearqueue") {
          queue.clear();
          await sendMessage(config.telegramToken, msg.chat.id, "🧹 Queue cleared.");
        } else if (cmd === "/latest") {
          const authorized = authorizeLatest({
            text: msg.text,
            fromUsername: msg.from?.username || "",
            chatUsername: msg.chat?.username || "",
            allowed: config.latestUser,
          });

          if (!authorized) {
            await sendMessage(
              config.telegramToken,
              msg.chat.id,
              `⛔ Not authorized. Use: /latest user=${config.latestUser}`,
            );
            continue;
          }

          await triggerRun(store, queue);
        }
      }
    } catch (err) {
      console.error("[bot] listener error:", err.message);
      await sleep(5000);
    }
  }
}

function startHttp(store, queue) {
  if (!config.triggerPort) return;

  const server = createTriggerServer({
    latestUser: config.latestUser,
    triggerToken: config.triggerToken,
    dryRun: config.dryRun,
    get paused() {
      return paused;
    },
    startRun: () => {
      triggerRun(store, queue).catch((e) => console.error("[http] run", e.message));
    },
    status: () => ({
      paused,
      running,
      queue: queue.size(),
      pollMinutes: config.pollMinutes,
      maxPerRun: config.maxPerRun,
      minSalary: config.minSalary,
      latestUser: config.latestUser,
    }),
  });

  server.listen(config.triggerPort, config.triggerHost, () => {
    console.log(`[http] listening on http://${config.triggerHost}:${config.triggerPort}`);
  });
}

async function main() {
  parseArgs();
  const store = new SeenStore(config.dataFile);
  const queue = new Queue(config.queueFile);
  store.prune();

  if (config.dryRun) {
    console.log("[mode] dry run");
    await runPost(store, queue);
    return;
  }
  if (config.once) {
    await runPost(store, queue);
    await drainQueue(queue);
    return;
  }

  if (config.telegramToken) {
    try {
      const chat = await getChat(config.telegramToken, config.telegramChatId);
      console.log(`[chat] ${chat.type}: ${chat.title || chat.username || ""}`);
      if (chat.type === "channel") {
        console.log("[chat] NOTE: a channel cannot send commands; use the HTTP endpoint instead.");
      }
    } catch (err) {
      console.error("[chat] getChat failed:", err.message);
    }
  }

  startScheduler(store, queue);
  startHttp(store, queue);
  await startCommands(store, queue);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
