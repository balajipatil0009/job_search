import "dotenv/config";

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function list(value, fallback) {
  const raw = value === undefined || value === "" ? fallback : value;
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function jsonMap(value, fallback) {
  if (value === undefined || value === "") return fallback;
  try {
    const parsed = JSON.parse(String(value));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to fallback
  }
  return fallback;
}

const DEFAULT_ROLE_KEYWORDS = {
  fullstack:
    "full stack,fullstack,mern,mean,frontend,backend,react,node,node.js,javascript,typescript,next.js,express,nestjs,mongodb",
  devops:
    "devops,sre,site reliability,platform engineer,cloud engineer,kubernetes,docker,jenkins,terraform,ansible,ci/cd,aws,azure,gcp,prometheus,grafana",
  "tech-support":
    "technical support,tech support,it support,helpdesk,help desk,service desk,desktop support,support engineer,noc,system administrator",
  analyst:
    "data analyst,business analyst,bi analyst,mis executive,reporting analyst,power bi,tableau,sql analyst,product analyst,operations analyst",
  "customer-support":
    "customer support,customer care,customer service,voice process,non-voice,chat support,email support,bpo,call center,csr,customer success",
};

function slugEnv(slug) {
  return `ROLE_${slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_KEYWORDS`;
}

function buildRoleKeywords() {
  const out = {};
  for (const [slug, fallback] of Object.entries(DEFAULT_ROLE_KEYWORDS)) {
    out[slug] = list(process.env[slugEnv(slug)], fallback).map((s) => s.toLowerCase());
  }
  return out;
}

export const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID?.trim() || "",
  latestUser: (process.env.LATEST_USER?.trim() || "aka_bala").toLowerCase(),

  keywords: list(process.env.KEYWORDS, "react,node,full stack,flutter").map((s) =>
    s.toLowerCase(),
  ),
  location: process.env.LOCATION?.trim() || "India",
  minSalary: num(process.env.MIN_SALARY, 500000),
  includeUnknownSalary: bool(process.env.INCLUDE_UNKNOWN_SALARY, true),
  matchDescription: bool(process.env.MATCH_DESCRIPTION, false),
  himalayasMaxKeywords: num(process.env.HIMALAYAS_MAX_KEYWORDS, 0),
  levelKeywords: list(
    process.env.LEVEL_KEYWORDS,
    "fresher,junior,trainee,entry level,intern",
  ).map((s) => s.toLowerCase()),
  adzunaQueries: list(
    process.env.ADZUNA_QUERIES,
    "react developer,node.js developer,full stack developer,frontend developer,backend developer",
  ),

  seniorityBlocklist: list(
    process.env.SENIORITY_BLOCKLIST,
    "senior,sr,staff,lead,architect,principal,manager,director,head,vp",
  ).map((s) => s.toLowerCase()),
  typeAllowlist: list(
    process.env.TYPE_ALLOWLIST,
    "full-time,part-time,contract,intern",
  ).map((s) => s.toLowerCase()),
  indiaOnly: bool(process.env.INDIA_ONLY, false),
  experienceLevel: process.env.EXPERIENCE_LEVEL?.trim() || "",

  jdSnippetChars: num(process.env.JD_SNIPPET_CHARS, 220),
  enrichDetails: bool(process.env.ENRICH_DETAILS, true),
  enrichMaxPerRun: num(process.env.ENRICH_MAX_PER_RUN, 6),

  pollMinutes: num(process.env.POLL_INTERVAL_MINUTES, 30),
  maxPerRun: num(process.env.MAX_JOBS_PER_RUN, 8),
  maxPerRole: num(process.env.MAX_PER_ROLE, 4),
  fresherShare: num(process.env.FRESHER_SHARE, 0.5),
  messageDelayMs: num(process.env.MESSAGE_DELAY_MS, 2500),
  maxSendRetries: num(process.env.MAX_SEND_RETRIES, 3),

  dataFile: process.env.DATA_FILE?.trim() || "./data/seen.json",
  queueFile: process.env.QUEUE_FILE?.trim() || "./data/queue.json",
  triggerPort: num(process.env.TRIGGER_PORT, 0),
  triggerHost: process.env.TRIGGER_HOST?.trim() || "127.0.0.1",
  triggerToken: process.env.TRIGGER_TOKEN?.trim() || "",

  adzuna: {
    appId: process.env.ADZUNA_APP_ID?.trim() || "",
    appKey: process.env.ADZUNA_APP_KEY?.trim() || "",
    country: process.env.ADZUNA_COUNTRY?.trim() || "in",
  },

  // Role -> Telegram chat map, e.g. {"fullstack":"@grp1","devops":"@grp2"}.
  // Empty = legacy single-chat mode using TELEGRAM_CHAT_ID.
  roleGroups: jsonMap(process.env.ROLE_GROUPS, {}),
  roleKeywords: buildRoleKeywords(),

  once: false,
  dryRun: false,
};
