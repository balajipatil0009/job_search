/** Text/number cleanup shared by sources and the formatter. */

export function normalizeText(input = "") {
  return String(input)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    // common UTF-8-read-as-latin1 mojibake
    .replace(/â€™|â€˜/g, "'")
    .replace(/â€œ|â€\u009d|â€/g, '"')
    .replace(/â€“|â€”/g, "-")
    .replace(/â€¦/g, "...")
    .replace(/â€¢/g, "-")
    .replace(/â[\u0080-\u00ff]?/g, "-")
    .replace(/[\u0080-\u009f]/g, "")
    .replace(/\s*-\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanTitle(title = "") {
  return normalizeText(title)
    .replace(/\s*[|·]\s*$/, "")
    .trim();
}

export function normalizeType(type = "") {
  const t = normalizeText(type).toLowerCase().replace(/[_\s]+/g, "-");
  if (!t) return "";
  if (/full-?time/.test(t)) return "full-time";
  if (/part-?time/.test(t)) return "part-time";
  if (/intern/.test(t)) return "intern";
  if (/contract|freelance|temporary|temp/.test(t)) return "contract";
  if (/permanent/.test(t)) return "full-time";
  return t;
}

export function typeLabel(type = "") {
  const t = normalizeType(type);
  return (
    {
      "full-time": "Full-time",
      "part-time": "Part-time",
      contract: "Freelance/Contract",
      intern: "Internship",
    }[t] || (t ? normalizeText(type) : "")
  );
}

export function normalizeLocation(loc = "") {
  const t = normalizeText(loc);
  if (!t) return "";
  if (/worldwide/i.test(t)) return "🌍 Worldwide remote";
  const parts = t.split(",").map((s) => s.trim()).filter(Boolean);
  const hasIndia = /india/i.test(t);
  if (hasIndia && parts.length >= 2) return "🌍 Remote (India eligible)";
  if (hasIndia && parts.length === 1) return "India";
  return t;
}

/** Pretty INR/other salary. Adzuna India is INR -> show LPA. */
export function formatSalary(job) {
  const min = job.salaryMin;
  const max = job.salaryMax;
  const text = normalizeText(job.salaryText || "");
  const isINR = job.currency === "INR" || /₹|INR/i.test(text);

  if (min || max) {
    if (isINR) {
      const f = (v) => (v == null ? "?" : String(Math.round((v / 100000) * 10) / 10).replace(/\.0$/, ""));
      return `₹${f(min)}-${f(max)} LPA`;
    }
    if (text) return text;
    return `$${(min || max).toLocaleString("en-US")}`;
  }

  if (text) {
    if (/competitive/i.test(text)) return "Competitive (unverified)";
    if (/not disclosed/i.test(text)) return "Unverified";
    return text;
  }
  return "Unverified";
}

/** Company display value; never a label like "Key Skills:". */
export function cleanCompany(company = "") {
  const c = normalizeText(company)
    .replace(/[^\p{L}\p{N}\s&'().,-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!c || /^(key skills|skills|requirements|company page|tech stack|benefits)\s*:?\s*$/i.test(c)) {
    return "Unknown";
  }
  return c;
}
