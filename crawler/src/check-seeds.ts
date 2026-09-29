// Runs detection on the private seed list and compares it with the expected labels.
// Local use only. It prints site hosts, so it refuses to run in CI.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { isCI } from "../../scripts/env.ts";
import { DELAY_BETWEEN_SITES_MS } from "./config.ts";
import { checkSite, type SiteResult } from "./check-site.ts";

if (isCI) {
  console.error("crawler:seeds prints site hosts and must not run in CI.");
  process.exit(1);
}

// Seed labels, comma separated, for example "bootstrap, web-components".
//   bootstrap, web-components, qh-vanilla  uses that codebase
//   unclear                                follows QGDS without a recognised codebase
//   none                                   does not use QGDS
// Every seed needs a label. Leave out sites whose answer is not known.
const codebaseByLabel: Record<string, string> = {
  "bootstrap": "bootstrap",
  "web-components": "web_components",
  "qh-vanilla": "qh_vanilla",
};
const codebaseOrder = ["bootstrap", "web_components", "qh_vanilla"];

interface Expected { usesQgds: boolean; codebases: string[] }

// Throws on a missing label or one the check does not recognise.
function expectedFor(labelText: string): Expected {
  const labels = labelText.split(",").map((l) => l.trim().toLowerCase()).filter(Boolean);
  if (labels.length === 0) throw new Error("A seed has no label. Add one, or remove the seed if the answer is not known.");
  const unrecognised = labels.filter((l) => !(l in codebaseByLabel) && l !== "unclear" && l !== "none");
  if (unrecognised.length > 0) throw new Error(`Unrecognised seed label "${unrecognised.join(", ")}".`);
  if (labels.includes("none")) {
    if (labels.length > 1) throw new Error(`"none" cannot be combined with other labels.`);
    return { usesQgds: false, codebases: [] };
  }
  const codebases = codebaseOrder.filter((c) => labels.some((l) => codebaseByLabel[l] === c));
  if (labels.includes("unclear") && codebases.length > 0) throw new Error(`"unclear" cannot be combined with a codebase.`);
  return { usesQgds: true, codebases };
}

function readSeeds() {
  return readFileSync("seeds.txt", "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^https?:\/\//.test(line))
    .map((line) => {
      const [url, label = ""] = line.split("#").map((part) => part.trim());
      return { url, label, expected: expectedFor(label) };
    });
}

let seeds: ReturnType<typeof readSeeds>;
try {
  seeds = readSeeds();
} catch (err) {
  console.error(`seeds.txt: ${(err as Error).message}`);
  process.exit(1);
}

const describe = (r: SiteResult) =>
  r.status !== "ok" ? `${r.status} (${r.failure_type})` : r.uses_qgds ? r.codebases.join(", ") || "QGDS, codebase unclear" : "none";

const browser = await chromium.launch();
let matched = 0, mismatched = 0;
try {
  for (const [i, { url, label, expected }] of seeds.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_SITES_MS));
    const result = await checkSite(browser, url);
    const ok = result.status === "ok";
    let verdict: string;
    if (ok && result.uses_qgds === expected.usesQgds && result.codebases.join() === expected.codebases.join()) { verdict = "match"; matched++; }
    else { verdict = "MISMATCH"; mismatched++; }
    console.log(`${verdict.padEnd(10)} ${new URL(url).host.padEnd(40)} expected ${label.padEnd(15)} got ${describe(result)}  [${result.signals.join(" ")}] ${result.duration_ms}ms`);
  }
} finally {
  await browser.close();
}
console.log(`${matched} matched, ${mismatched} mismatched.`);
if (mismatched > 0) process.exit(1);
