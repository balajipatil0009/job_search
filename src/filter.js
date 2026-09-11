import { normalizeType } from "./clean.js";

const TECH_SIGNAL =
  /(developer|engineer|software|programmer|mern|stack|frontend|front[\s-]?end|backend|back[\s-]?end|full[\s-]?stack|react|node|javascript|typescript|python|java|golang|flutter|android|ios|devops|cloud)\b/i;

// Per-role gate for level-only matches (fresher/junior/intern word alone).
// Dev roles reuse TECH_SIGNAL; support/analyst roles need their own signal
// or those jobs would be dropped by the shared gate.
const ROLE_SIGNALS = {
  fullstack:
    /(developer|engineer|software|programmer|mern|mean|stack|frontend|front[\s-]?end|backend|back[\s-]?end|full[\s-]?stack|react|node|javascript|typescript|next|express|mongodb)\b/i,
  devops:
    /(devops|sre|platform|cloud|kubernetes|docker|jenkins|terraform|ansible|aws|azure|gcp|ci\/?cd|prometheus|grafana|reliability)\b/i,
  "tech-support":
    /(support|helpdesk|help[\s-]?desk|service[\s-]?desk|desktop|noc|sysadmin|system administrator|network|technician)\b/i,
  analyst:
    /(analyst|analytics|power[\s-]?bi|tableau|sql|excel|mis|reporting|business intelligence|\bbi\b|dashboard)\b/i,
  "customer-support":
    /(customer|support|voice|non[\s-]?voice|chat|bpo|call[\s-]?cent(er|re)|csr|client support|customer success|helpdesk)\b/i,
};

// Negative hints to reduce cross-role bleed when fanning out.
const ROLE_NEGATIVES = {
  fullstack: [/\bsenior\b/i, /\blead\b/i],
  devops: [/\bhelpdesk\b/i, /\bcall center\b/i, /\bbpo\b/i],
  "tech-support": [/\bkubernetes\b/i, /\bterraform\b/i],
  analyst: [/\bcall center\b/i, /\bbpo\b/i],
  "customer-support": [/\bkubernetes\b/i, /\bterraform\b/i, /\bmern\b/i, /\breact\b.*\bnode\b/i],
};

export function keywordMatch(job, keywords, matchDescription = false, levelKeywords = []) {
  if (!keywords.length) return true;
  const primary = `${job.title} ${job.company}`.toLowerCase();
  const levels = levelKeywords.map((l) => l.toLowerCase());
  const roles = keywords.filter((k) => !levels.includes(k));

  if (roles.some((k) => primary.includes(k))) return true;

  // A fresher/junior/intern word only counts for a tech role.
  if (levels.some((k) => primary.includes(k)) && TECH_SIGNAL.test(job.title || "")) {
    return true;
  }

  if (matchDescription) {
    const desc = `${job.description || ""} ${job.jd || ""}`.toLowerCase();
    return roles.some((k) => desc.includes(k));
  }
  return false;
}

/**
 * Salary gate: a job must pay MORE than minSalary (strict).
 * Jobs with unknown salary are allowed when includeUnknown is true.
 */
export function salaryOk(job, minSalary, includeUnknown) {
  if (!minSalary || minSalary <= 0) return true;
  const min = job.salaryMin ?? job.salaryMax;
  if (min == null) return includeUnknown;
  return min > minSalary;
}

/** Drop senior/leadership titles the community can't use. */
export function seniorityOk(job, blocklist) {
  if (!blocklist.length) return true;
  const title = (job.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return !blocklist.some((w) => new RegExp(`\\b${w}\\b`, "i").test(title));
}

/**
 * Employment-type allowlist. Empty = allow all.
 * Unknown/blank types are always allowed (then tagged when rendered).
 */
export function typeOk(job, allowlist) {
  if (!allowlist.length) return true;
  const t = normalizeType(job.type);
  if (!t) return true;
  return allowlist.map(normalizeType).includes(t);
}

export function indiaOk(job, indiaOnly) {
  if (!indiaOnly) return true;
  return /india/i.test(job.location || "");
}

/** Heuristic: does the title look like an entry-level role? */
export function isFresher(job) {
  return /\b(fresher|junior|trainee|entry[\s-]?level|graduate|intern|internship)\b/i.test(
    job.title || "",
  );
}

/**
 * Role router: fetch-once, route locally. Returns all matching role slugs
 * (fan-out). A job with no role match returns [].
 */
export function matchRoles(job, roleKeywords = {}, matchDescription = false, levelKeywords = []) {
  const slugs = Object.keys(roleKeywords || {});
  if (!slugs.length) return [];
  const levels = (levelKeywords || []).map((l) => l.toLowerCase());
  const primary = `${job.title || ""} ${job.company || ""}`.toLowerCase();
  const desc = `${job.description || ""} ${job.jd || ""}`.toLowerCase();
  const out = [];
  for (const slug of slugs) {
    const kws = (roleKeywords[slug] || []).map((k) => String(k).toLowerCase());
    if (!kws.length) continue;
    const roles = kws.filter((k) => !levels.includes(k));
    let hit = roles.some((k) => k && primary.includes(k));
    if (!hit) {
      const signal = ROLE_SIGNALS[slug];
      if (levels.some((k) => k && primary.includes(k)) && signal?.test(job.title || "")) {
        hit = true;
      }
    }
    if (!hit && matchDescription) {
      hit = roles.some((k) => k && desc.includes(k));
    }
    if (!hit) continue;
    const negs = ROLE_NEGATIVES[slug] || [];
    if (negs.some((re) => re.test(job.title || ""))) continue;
    out.push(slug);
  }
  return out;
}

/** Fuzzy dedupe key: normalized title + company prefix. */
export function titleKey(job) {
  const t = (job.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const c = (job.company || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${t}|${c.slice(0, 24)}`;
}
