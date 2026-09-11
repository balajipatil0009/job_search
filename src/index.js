import { config } from "./config.js";
import { SeenStore } from "./store.js";
import { Queue } from "./queue.js";
import {
  keywordMatch,
  matchRoles,
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

/** Multi-group mode when ROLE_GROUPS is non-empty; else legacy single chat. */
function useRoles() {
  return Object.keys(config.roleGroups || {}).length > 0;
}

function roleChat(role) {
  return config.roleGroups?.[role] || config.telegramChatId || "";
}

/** Dedupe key per (job, chat) so fan-out to N groups posts N times, once each. */
function seenKey(jobId, targetChat) {
  return useRoles() ? Queue.key(jobId, targetChat) : jobId;
}

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
  const multi = useRoles();

  const seenBatch = new Set();
  let pool = jobs
    .filter((j) => seniorityOk(j, config.seniorityBlocklist))
    .filter((j) => typeOk(j, config.typeAllowlist))
    .filter((j) => indiaOk(j, config.indiaOnly));

  if (multi) {
    // Fetch-once, route locally: keep jobs matching ANY configured role.
    pool = pool.filter(
      (j) => matchRoles(j, config.roleKeywords, config.matchDescription, config.levelKeywords).length > 0,
    );
  } else {
    pool = pool.filter((j) =>
      keywordMatch(j, config.keywords, config.matchDescription, config.levelKeywords),
    );
  }

  pool = pool
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

  // Fan-out: one routed copy per (job, role). Seen/queue keys are per-chat
  // so the same job can go to N groups without cross-suppression.
  let routed = [];
  if (multi) {
    for (const job of pool) {
      const roles = matchRoles(job, config.roleKeywords, config.matchDescription, config.levelKeywords);
      for (const role of roles) {
        const targetChat = roleChat(role);
        if (!targetChat) continue;
        if (store.has(seenKey(job.id, targetChat))) continue;
        if (queue.has(job.id, targetChat)) continue;
        routed.push({ ...job, _role: role, _targetChat: targetChat });
      }
    }
    // Per-role caps (+ fresher share) so one role can't starve the others.
    const capped = [];
    for (const role of Object.keys(config.roleGroups || {})) {
      const list = routed.filter((j) => j._role === role);
      const fresherQuota = Math.round(config.maxPerRole * config.fresherShare);
      const freshers = list.filter(isFresher);
      const others = list.filter((j) => !isFresher(j));
      const picked = [];
      picked.push(...freshers.slice(0, fresherQuota));
      picked.push(...others.slice(0, config.maxPerRole - picked.length));
      if (picked.length < config.maxPerRole) {
        picked.push(
          ...freshers.slice(fresherQuota, fresherQuota + (config.maxPerRole - picked.length)),
        );
      }
      capped.push(...picked);
    }
    routed = capped;
  } else {
    pool = pool.filter((j) => !store.has(j.id) && !queue.has(j.id));

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
    routed = selected.map((j) => ({ ...j, _targetChat: config.telegramChatId }));
  }

  const selected = routed;
  if (!selected.length) {
    console.log("[run] no new matching jobs");
    return;
  }

  if (config.dryRun) {
    if (multi) {
      const byRole = {};
      for (const j of selected) byRole[j._role] = (byRole[j._role] || 0) + 1;
      console.log(`\n===== DRY RUN: ${selected.length} routed message(s) ${JSON.stringify(byRole)} =====\n`);
    } else {
      console.log(`\n===== DRY RUN: ${selected.length} separate message(s) =====\n`);
    }
    selected.forEach((job, i) => {
      console.log(`--- job ${i + 1}${job._role ? ` [${job._role} -> ${job._targetChat}]` : ""} ---`);
      console.log(formatJobMessage(job).replace(/<[^>]+>/g, ""));
      console.log();
    });
    return;
  }

  if (!config.telegramToken || (!config.telegramChatId && !multi)) {
    throw new Error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (or ROLE_GROUPS) in .env");
  }

  const fallback = multi ? "" : config.telegramChatId;
  const added = queue.push(selected, fallback);
  store.add(selected.map((j) => seenKey(j.id, j._targetChat || fallback)));
  store.save();
  console.log(`[run] queued ${added} job(s) (queue depth ${queue.size()} ${JSON.stringify(queue.sizeByChat())})`);
}

async function drainQueue(queue) {
  if (config.dryRun || !config.telegramToken) return;
  if (!useRoles() && !config.telegramChatId) return;

  // Round-robin across chats: stays under 20/min/group and 1/sec/chat,
  // and one throttled group doesn't block the others.
  let cursor = 0;
  let idleRounds = 0;
  while (queue.size() > 0) {
    if (!useRoles()) {
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
      continue;
    }
    const chats = Object.values(config.roleGroups || {});
    const pending = chats.filter((c) => queue.firstFor(c));
    if (!pending.length) break;
    const chatId = pending[cursor % pending.length];
    cursor += 1;
    const item = queue.firstFor(chatId);
    if (!item) {
      idleRounds += 1;
      if (idleRounds > pending.length * 2) break;
      continue;
    }
    idleRounds = 0;
    const job = item.job;
    const target = item.targetChat || chatId;

    try {
      await sendMessage(config.telegramToken, target, formatJobMessage(job));
      queue.remove(job.id, target);
      console.log(`[send] ok -> ${target}: ${job.title}`);
    } catch (err) {
      if (err.retryAfter) {
        console.log(`[send] rate limited (${target}), waiting ${err.retryAfter}s`);
        await sleep((Number(err.retryAfter) || 5) * 1000);
        continue;
      }
      item.attempts = (item.attempts || 0) + 1;
      queue.save();
      console.log(`[send] fail (${item.attempts}/${config.maxSendRetries}) -> ${target}: ${err.message}`);
      if (item.attempts >= config.maxSendRetries) {
        queue.remove(job.id, target);
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
  const roles = useRoles() ? ` (${Object.keys(config.roleGroups).join(", ")})` : "";
  return [
    "<b>Job alerts bot</b>" + roles,
    `/latest user=${config.latestUser} - fetch & post new jobs now`,
    "/status - show settings + queue depth per group",
    "/pause - stop auto-posting",
    "/resume - resume auto-posting",
    "/clearqueue [role] - empty the pending queue (optionally one role)",
    "/help - this message",
  ].join("\n");
}

/** Accept any configured chat (ROLE_GROUPS values) by numeric id OR @username. */
function isTargetChat(chat) {
  const allowed = useRoles()
    ? Object.values(config.roleGroups || {})
    : [config.telegramChatId];
  const id = String(chat.id);
  const username = (chat.username || "").toLowerCase();
  return allowed.some((t) => {
    if (!t) return true;
    return id === String(t) || username === String(t).toLowerCase().replace(/^@/, "");
  });
}

function roleFromArg(text) {
  const parts = text.trim().split(/\s+/).slice(1);
  const slug = (parts[0] || "").toLowerCase();
  if (slug && config.roleGroups?.[slug]) return slug;
  return "";
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
          const byChat = queue.sizeByChat();
          const detail = useRoles()
            ? ` • ${Object.entries(config.roleGroups).map(([r, c]) => `${r}:${byChat[c] || 0}`).join(" ")}`
            : "";
          await sendMessage(
            config.telegramToken,
            msg.chat.id,
            `Every ${config.pollMinutes}m • min ₹${config.minSalary} • queue ${queue.size()}${detail} • ${paused ? "PAUSED" : "ACTIVE"}`,
          );
        } else if (cmd === "/pause") {
          paused = true;
          await sendMessage(config.telegramToken, msg.chat.id, "⏸ Paused.");
        } else if (cmd === "/resume") {
          paused = false;
          await sendMessage(config.telegramToken, msg.chat.id, "▶️ Resumed.");
        } else if (cmd === "/clearqueue") {
          const slug = roleFromArg(msg.text);
          if (slug) {
            queue.clear(roleChat(slug));
            await sendMessage(config.telegramToken, msg.chat.id, `🧹 Queue cleared (${slug}).`);
          } else {
            queue.clear();
            await sendMessage(config.telegramToken, msg.chat.id, "🧹 Queue cleared.");
          }
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
      queueByChat: queue.sizeByChat(),
      roles: useRoles() ? Object.keys(config.roleGroups) : [],
      pollMinutes: config.pollMinutes,
      maxPerRun: config.maxPerRun,
      maxPerRole: config.maxPerRole,
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
  if (useRoles()) {
    console.log(`[roles] multi-group: ${Object.entries(config.roleGroups).map(([r, c]) => `${r}->${c}`).join(", ")}`);
  } else {
    console.log("[roles] single-chat mode (ROLE_GROUPS empty)");
  }

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
    const chatsToCheck = useRoles()
      ? Object.entries(config.roleGroups)
      : [["default", config.telegramChatId]];
    for (const [label, chatId] of chatsToCheck) {
      if (!chatId) continue;
      try {
        const chat = await getChat(config.telegramToken, chatId);
        console.log(`[chat] ${label} ${chatId} -> ${chat.type}: ${chat.title || chat.username || ""}`);
        if (chat.type === "channel") {
          console.log("[chat] NOTE: a channel cannot send commands; use the HTTP endpoint instead.");
        }
      } catch (err) {
        console.error(`[chat] getChat failed (${label} ${chatId}):`, err.message);
      }
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
