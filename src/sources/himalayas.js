const MCP_URL = "https://mcp.himalayas.app/mcp";

const LABEL_RE =
  /^(key skills|skills|requirements|apply.*|company page|tech stack|benefits|salary|location|experience|education)\s*:?\s*$/i;

function sseData(raw) {
  const line = raw.split("\n").find((l) => l.startsWith("data:"));
  return line ? line.replace(/^data:\s*/, "") : raw;
}

export async function callHimalayasTool(name, args) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body,
  });
  if (!res.ok) throw new Error(`Himalayas HTTP ${res.status}`);
  const data = JSON.parse(sseData(await res.text()));
  return data.result?.content?.map((c) => c.text).join("\n") || "";
}

function parseSalary(block) {
  const line = block
    .split("\n")
    .find(
      (l) =>
        /competitive salary/i.test(l) ||
        /[\$₹€£]\s?[\d,]{3,}/.test(l) ||
        /\b(INR|USD|EUR|GBP)\b/.test(l),
    );
  if (!line) return { text: "Not disclosed", min: null, max: null };

  const nums = [...line.matchAll(/([\$₹€£]?)\s?([\d][\d,]{2,})/g)].map((m) =>
    Number(m[2].replace(/,/g, "")),
  );
  const text = line.replace(/\s+/g, " ").replace(/^[^\w$₹€£]+/, "").trim();
  return {
    text,
    min: nums.length ? Math.min(...nums) : null,
    max: nums.length ? Math.max(...nums) : null,
  };
}

function stripLeading(value = "") {
  return value.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

function parseHimalayasText(text) {
  const blocks = text
    .split(/\n\s*---\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.includes("Apply on Himalayas"));

  const jobs = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    // title = bold on the first line
    const titleMatch = lines[0].match(/\*\*(.+?)\*\*/);
    const title = titleMatch ? titleMatch[1].trim() : stripLeading(lines[0]);

    // company = the 🏢 line (bold in detail view, plain in search results)
    let company = "Unknown";
    const companyLine = lines.find((l) => l.includes("🏢"));
    if (companyLine) {
      const bm = companyLine.match(/\*\*(.+?)\*\*/);
      const cleaned = (bm ? bm[1] : stripLeading(companyLine)).replace(/\*\*/g, "").trim();
      if (cleaned && !LABEL_RE.test(cleaned)) company = cleaned;
    }

    const urlMatch = block.match(/Apply on Himalayas:\*\*\s*(https?:\/\/\S+)/);
    if (!urlMatch) continue;
    const url = urlMatch[1];
    const slugMatch = url.match(/companies\/([^/]+)\/jobs\/([^?/#]+)/);

    const bulletLine = lines.find((l) => l.includes("•")) || "";
    const segs = bulletLine.split("•").map((s) => s.trim());
    const type = segs[0] ? stripLeading(segs[0]) : "";
    const location = segs.length > 1 ? stripLeading(segs[segs.length - 1]) : "";

    const sal = parseSalary(block);
    const isINR = /₹|INR/i.test(sal.text);

    jobs.push({
      id: `himalayas:${url}`,
      source: "Himalayas",
      title,
      company,
      location,
      type,
      salaryMin: sal.min,
      salaryMax: sal.max,
      salaryText: sal.text,
      currency: isINR ? "INR" : null,
      url,
      companySlug: slugMatch?.[1] || null,
      jobSlug: slugMatch?.[2] || null,
      description: block.replace(/\s+/g, " ").slice(0, 800),
      jd: "",
      posted: null,
    });
  }
  return jobs;
}

/** Himalayas remote jobs (no API key needed). */
export async function fetchHimalayas(cfg) {
  const keywords =
    cfg.himalayasMaxKeywords > 0 ? cfg.keywords.slice(0, cfg.himalayasMaxKeywords) : cfg.keywords;
  const all = [];
  for (const keyword of keywords) {
    try {
      const args = { keyword, country: cfg.location };
      if (cfg.experienceLevel) args.experience = cfg.experienceLevel;
      const text = await callHimalayasTool("search_jobs", args);
      all.push(...parseHimalayasText(text));
    } catch (err) {
      console.error(`[himalayas] "${keyword}" failed: ${err.message}`);
    }
  }
  return all;
}
