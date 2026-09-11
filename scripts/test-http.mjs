import { buildResponse } from "../src/http.js";

const ctx = {
  latestUser: "aka_bala",
  triggerToken: "",
  dryRun: false,
  paused: false,
  startRun: () => {},
  status: () => ({ queue: 3, running: false, paused: false }),
};

const q = (s) => new URLSearchParams(s);

const cases = [
  ["/health", "", 200],
  ["/latest", "user=aka_bala", 202],
  ["/latest", "user=someone", 401],
  ["/latest", "", 401],
  ["/status", "user=AKA_BALA", 200],
  ["/nope", "user=aka_bala", 404],
  ["/latest", "user=aka_bala&token=ignored-when-no-token-set", 202],
];

let pass = 0;
for (const [pathname, qs, expected] of cases) {
  const { code } = buildResponse({ pathname, searchParams: q(qs), ctx });
  const ok = code === expected;
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"} | ${pathname}?${qs} -> ${code} (want ${expected})`);
}

// token enforced when configured
const ctx2 = { ...ctx, triggerToken: "s3cret" };
const noTok = buildResponse({ pathname: "/latest", searchParams: q("user=aka_bala"), ctx: ctx2 });
const badTok = buildResponse({ pathname: "/latest", searchParams: q("user=aka_bala&token=nope"), ctx: ctx2 });
const goodTok = buildResponse({ pathname: "/latest", searchParams: q("user=aka_bala&token=s3cret"), ctx: ctx2 });
const hdrTok = buildResponse({
  pathname: "/latest",
  searchParams: q("user=aka_bala"),
  headers: { "x-trigger-token": "s3cret" },
  ctx: ctx2,
});
for (const [name, r, want] of [
  ["token missing", noTok, 401],
  ["token wrong", badTok, 401],
  ["token query ok", goodTok, 202],
  ["token header ok", hdrTok, 202],
]) {
  const ok = r.code === want;
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"} | ${name} -> ${r.code} (want ${want})`);
}

console.log(`${pass}/11 passed`);
