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

// Seed labels to the codebases the crawler should report.
const expectedByLabel: Record<string, string[] | null> = {
  "bootstrap": ["bootstrap"],
  "web-components": ["web_components"],
  "qh-vanilla": ["qh_vanilla"],
  "none": [],
  "unknown": null, // Recorded, not compared.
};

const seeds = readFileSync("seeds.txt", "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => /^https?:\/\//.test(line))
  .map((line) => {
    const [url, label = "unknown"] = line.split("#").map((part) => part.trim());
    return { url, label };
  });

const describe = (r: SiteResult) =>
  r.status !== "ok" ? `${r.status} (${r.failure_type})` : r.uses_qgds ? r.codebases.join(", ") || "QGDS, codebase unclear" : "none";

const browser = await chromium.launch();
let matched = 0, mismatched = 0, unlabelled = 0;
try {
  for (const [i, { url, label }] of seeds.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_SITES_MS));
    const result = await checkSite(browser, url);
    const expected = expectedByLabel[label] ?? null;
    const actual = result.status === "ok" ? result.codebases : null;
    let verdict: string;
    if (expected === null) { verdict = "unlabelled"; unlabelled++; }
    else if (actual !== null && actual.join() === expected.join()) { verdict = "match"; matched++; }
    else { verdict = "MISMATCH"; mismatched++; }
    console.log(`${verdict.padEnd(10)} ${new URL(url).host.padEnd(40)} expected ${label.padEnd(15)} got ${describe(result)}  [${result.signals.join(" ")}] ${result.duration_ms}ms`);
  }
} finally {
  await browser.close();
}
console.log(`${matched} matched, ${mismatched} mismatched, ${unlabelled} unlabelled.`);
if (mismatched > 0) process.exit(1);
