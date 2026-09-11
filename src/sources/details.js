import { callHimalayasTool } from "./himalayas.js";

function parseSalaryLine(line) {
  const body = line.replace(/\*\*Salary:\*\*/i, "").trim();
  const nums = [...body.matchAll(/([\d][\d,]{2,})/g)].map((m) => Number(m[1].replace(/,/g, "")));
  if (!nums.length) return null;
  const isINR = /₹|INR/i.test(body);
  return {
    text: body,
    min: Math.min(...nums),
    max: Math.max(...nums),
    currency: isINR ? "INR" : null,
  };
}

function extractJD(text) {
  const idx = text.search(/##\s*Job Description/i);
  const section = idx >= 0 ? text.slice(idx) : text;
  return section
    .replace(/##[^\n]*\n?/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s*[-*]\s*/gm, "• ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

/**
 * Pull full job details (real salary + JD) for a Himalayas listing.
 * Used only for jobs with unknown salary, capped per run by the caller.
 */
export async function enrichHimalayas(job) {
  if (!job.companySlug || !job.jobSlug) return job;
  try {
    const text = await callHimalayasTool("get_job_details", {
      company_slug: job.companySlug,
      job_slug: job.jobSlug,
    });
    if (!text) return job;

    const companyLine = text.split("\n").find((l) => l.includes("🏢"));
    if (companyLine) {
      const bm = companyLine.match(/\*\*(.+?)\*\*/);
      const c = (bm ? bm[1] : companyLine.replace(/^[^\p{L}\p{N}]+/u, ""))
        .replace(/\*\*/g, "")
        .trim();
      if (c) job.company = c;
    }

    const salLine = text
      .split("\n")
      .find((l) => /\*\*Salary:\*\*/i.test(l));
    if (salLine && !job.salaryMin && !job.salaryMax) {
      const sal = parseSalaryLine(salLine);
      if (sal) {
        job.salaryMin = sal.min;
        job.salaryMax = sal.max;
        job.salaryText = sal.text;
        if (sal.currency) job.currency = sal.currency;
      }
    }

    const jd = extractJD(text);
    if (jd && jd.length > 60) job.jd = jd;
    return job;
  } catch (err) {
    console.error(`[details] ${job.title} failed: ${err.message}`);
    return job;
  }
}
