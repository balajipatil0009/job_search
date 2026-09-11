function stripHtml(html = "") {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function mapJob(r) {
  return {
    id: `adzuna:${r.id}`,
    source: "Adzuna",
    title: r.title || "",
    company: r.company?.display_name || "",
    location: r.location?.display_name || r.location?.area?.join(", ") || "",
    type: r.contract_time || r.contract_type || "",
    salaryMin: r.salary_min ?? null,
    salaryMax: r.salary_max ?? null,
    salaryText:
      r.salary_min || r.salary_max
        ? `${r.salary_min ? "₹" + r.salary_min.toLocaleString("en-IN") : "?"} - ${
            r.salary_max ? "₹" + r.salary_max.toLocaleString("en-IN") : "?"
          }`
        : null,
    currency: "INR",
    url: r.redirect_url || "",
    description: stripHtml(r.description).slice(0, 700),
    jd: stripHtml(r.description).slice(0, 700),
    posted: r.created || null,
  };
}

/**
 * Adzuna India job search. Runs one targeted query per role phrase
 * (far more relevant than a broad OR query), then dedupes.
 * Docs/keys: https://developer.adzuna.com/
 */
export async function fetchAdzuna(cfg) {
  const { appId, appKey, country } = cfg.adzuna;
  if (!appId || !appKey) return [];

  const queries =
    cfg.adzunaQueries?.length > 0
      ? cfg.adzunaQueries
      : cfg.keywords.map((k) => `${k} developer`);

  const seen = new Set();
  const jobs = [];

  for (const what of queries) {
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      results_per_page: "50",
      what,
      where: cfg.location,
      sort_by: "date",
      max_days_old: "7",
      "content-type": "application/json",
    });
    try {
      const res = await fetch(
        `https://api.adzuna.com/v1/api/jobs/${country}/search/1?${params}`,
      );
      if (!res.ok) {
        console.error(`[adzuna] "${what}" HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      let added = 0;
      for (const r of data.results || []) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        jobs.push(mapJob(r));
        added++;
      }
      console.log(`[adzuna] "${what}": ${added} new`);
    } catch (err) {
      console.error(`[adzuna] "${what}" failed: ${err.message}`);
    }
  }
  return jobs;
}
