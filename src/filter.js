import { normalizeType } from "./clean.js";

const TECH_SIGNAL =
  /(developer|engineer|software|programmer|mern|stack|frontend|front[\s-]?end|backend|back[\s-]?end|full[\s-]?stack|react|node|javascript|typescript|python|java|golang|flutter|android|ios|devops|cloud)\b/i;

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

/** Fuzzy dedupe key: normalized title + company prefix. */
export function titleKey(job) {
  const t = (job.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const c = (job.company || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${t}|${c.slice(0, 24)}`;
}
