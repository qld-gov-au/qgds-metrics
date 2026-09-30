// Crawls every active site and stores one web run in Supabase.
//
//   npm run crawl                  all active sites, stored as a run
//   npm run crawl -- --limit 3     first 3 sites, for testing. Not stored, because a
//                                  partial crawl would distort totals and trends.
//
// Logs counts, durations and error types only. Site-level detail goes to Supabase.
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { isMissingTable, serviceClient } from "../../scripts/supabase.ts";
import { DELAY_BETWEEN_SITES_MS, USER_AGENT } from "./config.ts";
import { checkSite, type SiteResult } from "./check-site.ts";
import { runOutcome } from "./run-outcome.ts";

const limitIndex = process.argv.indexOf("--limit");
const limit = limitIndex > -1 ? Number(process.argv[limitIndex + 1]) : null;
if (limit !== null && !(Number.isInteger(limit) && limit > 0)) {
  console.error("--limit needs a positive whole number.");
  process.exit(1);
}

function collectorVersion(): string | null {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const supabase = serviceClient();

async function activeSites(): Promise<{ id: string; url: string }[]> {
  const sites: { id: string; url: string }[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("sites").select("id, url").eq("active", true).order("url").range(from, from + pageSize - 1);
    if (error) throw new Error(isMissingTable(error) ? "The sites table does not exist. Apply db/migrations first." : `Reading sites failed: ${error.code}`);
    sites.push(...data);
    if (data.length < pageSize) return sites;
  }
}

async function finishRun(runId: string, status: "succeeded" | "failed"): Promise<void> {
  const { error } = await supabase.from("runs").update({ status, finished_at: new Date().toISOString() }).eq("id", runId);
  if (error) console.error(`Could not mark run ${status}: ${error.code}`);
}

const started = Date.now();
let sites: { id: string; url: string }[];
try {
  sites = await activeSites();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
if (limit !== null) sites = sites.slice(0, limit);
if (sites.length === 0) {
  console.error("No active sites to crawl. Add some with npm run sites:import.");
  process.exit(1);
}

const store = limit === null;
if (!store) console.log(`Test crawl of ${sites.length} site(s). Results are not stored.`);

const { data: run, error: runError } = !store ? { data: null, error: null } : await supabase
  .from("runs")
  .insert({ source: "web", user_agent: USER_AGENT, collector_version: collectorVersion() })
  .select("id")
  .single();
if (runError) {
  console.error(`Could not create run: ${runError.code}`);
  process.exit(1);
}

// Mark the run failed if the process is stopped part way.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    if (!run) process.exit(1);
    await finishRun(run.id, "failed");
    console.error(`Stopped by ${signal}. Run marked failed.`);
    process.exit(1);
  });
}

const tally = { ok: 0, usingQgds: 0, failed: 0, skipped: 0, writeErrors: 0 };
const failureTypes = new Map<string, number>();
const browser = await chromium.launch();
try {
  for (const [i, site] of sites.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_SITES_MS));
    const result: SiteResult = await checkSite(browser, site.url);
    tally[result.status]++;
    if (result.uses_qgds) tally.usingQgds++;
    if (result.failure_type) failureTypes.set(result.failure_type, (failureTypes.get(result.failure_type) ?? 0) + 1);

    if (run) {
      const { error } = await supabase.from("site_results").insert({ run_id: run.id, site_id: site.id, ...result });
      if (error) tally.writeErrors++;
    }
  }
} finally {
  await browser.close();
}

const outcome = runOutcome({ total: sites.length, failed: tally.failed, writeErrors: tally.writeErrors });
if (run) await finishRun(run.id, outcome.status);

const seconds = Math.round((Date.now() - started) / 1000);
const failures = [...failureTypes].map(([type, n]) => `${n} ${type}`).join(", ");
console.log(
  `Crawled ${sites.length} site(s) in ${seconds}s: ${tally.ok} checked (${tally.usingQgds} using QGDS), ` +
    `${tally.failed} failed, ${tally.skipped} skipped${failures ? ` (${failures})` : ""}.`,
);
if (outcome.status === "failed") {
  console.error(`${outcome.reason} ${run ? "Run marked failed." : ""}`.trim());
  process.exit(1);
}
if (run) console.log("Run succeeded.");
