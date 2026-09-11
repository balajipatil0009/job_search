import { authorizeLatest } from "../src/auth.js";

const allowed = "aka_bala";
const cases = [
  ["/latest user=aka_bala", "", "", true],
  ["/latest aka_bala", "", "", true],
  ["/latest @aka_bala", "", "", true],
  ["/latest", "aka_bala", "", true],
  ["/latest", "", "aka_bala", true],
  ["/latest user=someone", "", "", false],
  ["/latest user=aka_bala", "stranger", "", true],
  ["/latest", "", "", false],
  ["/latest user=AKA_BALA", "", "", true],
  ["/latest random", "", "", false],
];

let pass = 0;
for (const [text, from, chat, expected] of cases) {
  const got = authorizeLatest({
    text,
    fromUsername: from,
    chatUsername: chat,
    allowed,
  });
  const ok = got === expected;
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"} | "${text}" from=${from || "-"} -> ${got}`);
}
console.log(`${pass}/${cases.length} passed`);
