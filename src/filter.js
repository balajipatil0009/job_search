import { normalizeType } from "./clean.js";

const TECH_SIGNAL =
  /(developer|engineer|software|programmer|mern|stack|frontend|front[\s-]?end|backend|back[\s-]?end|full[\s-]?stack|react|node|javascript|typescript|python|java|golang|flutter|android|ios|devops|cloud)\b/i;

// Per-role gate for level-only matches (fresher/junior/intern word alone).
// Each signal requires role-specific context — a bare "engineer" or
// "support" must NOT match, or Junior GTM/Network Engineers leak into
// the wrong channels.
const ROLE_SIGNALS = {
  fullstack:
    /(software|developer|programmer|mern|mean|full[\s-]?stack|frontend|front[\s-]?end|backend|back[\s-]?end|react|node|javascript|typescript|next|express|nestjs|mongodb)\b/i,
  devops:
    /(devops|devsecops|sre|kubernetes|docker|jenkins|terraform|ansible|ci\/?cd|prometheus|grafana|reliability|infrastructure[\s-]?as[\s-]?code|platform[\s-]?engineer|cloud[\s-]?engineer)\b/i,
  "tech-support":
    /(technical[\s-]?support|tech[\s-]?support|it[\s-]?support|helpdesk|help[\s-]?desk|service[\s-]?desk|desktop[\s-]?support|support[\s-]?engineer|support[\s-]?specialist|support[\s-]?executive|support[\s-]?representative|voice|chat[\s-]?support|email[\s-]?support|\bbpo\b|call[\s-]?cent(er|re)|\bcsr\b|customer[\s-]?success|client[\s-]?support|noc|sysadmin|system[\s-]?administrator|technician)\b/i,
  analyst:
    /(analyst|analytics|data[\s-]?scien(ce|tist)|data[\s-]?engineer|power[\s-]?bi|tableau|\bsql\b|excel|\bmis\b|reporting|business[\s-]?intelligence|\bbi\b|dashboard)\b/i,
  "ai-ml":
    /(machine[\s-]?learning|\bml\b|\bai\b|data[\s-]?scien(ce|tist)|deep[\s-]?learning|\bnlp\b|\bllm\b|genai|generative[\s-]?ai|computer[\s-]?vision|pytorch|tensorflow|hugging[\s-]?face|langchain|mlops|artificial[\s-]?intelligence|ai[\s-]?engineer)\b/i,
};

// Non-English-language postings are out of scope for the India feed.
const LANG_NEGATIVES = [/\bgerman\b/i, /\bfrench\b/i, /\bdutch\b/i, /\bspanish\b/i];

// Negative hints to reduce cross-role bleed when fanning out.
const ROLE_NEGATIVES = {
  fullstack: [
    /\bsenior\b/i,
    /\blead\b/i,
    /\bgtm\b/i,
    /\bsales\b/i,
    /\bhelpdesk\b/i,
    /\bpanel\b/i,
    /\bbpo\b/i,
    /\bvoice[\s-]?process\b/i,
    /\bcall[\s-]?cent(er|re)\b/i,
    ...LANG_NEGATIVES,
  ],
  devops: [
    /\bhelpdesk\b/i,
    /\bcall[\s-]?cent(er|re)\b/i,
    /\bbpo\b/i,
    /\bsupport[\s-]?engineer\b/i,
    /\bsupport[\s-]?specialist\b/i,
    /\bdata (analyst|engineer|scientist)\b/i,
    ...LANG_NEGATIVES,
  ],
  "tech-support": [
    /\bkubernetes\b/i,
    /\bterraform\b/i,
    /\bmern\b/i,
    /\bdata (analyst|engineer|scientist)\b/i,
    /\bmachine[\s-]?learning\b/i,
    ...LANG_NEGATIVES,
  ],
  analyst: [/\bcall[\s-]?cent(er|re)\b/i, /\bbpo\b/i, /\bvoice[\s-]?process\b/i, ...LANG_NEGATIVES],
  "ai-ml": [
    /\bhelpdesk\b/i,
    /\bcall[\s-]?cent(er|re)\b/i,
    /\bbpo\b/i,
    /\bvoice[\s-]?process\b/i,
    ...LANG_NEGATIVES,
  ],
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
