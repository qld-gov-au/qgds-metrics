// Crawls every active site and stores one web run in Supabase.
//
//   npm run crawl                  all active sites, stored as a run
//   npm run crawl -- --resume      finish the latest incomplete run: only sites without a result
//   npm run crawl -- --limit 3     first 3 sites, for testing. Not stored, because a
//                                  partial crawl would distort totals and trends.
//
// Short network drops are expected on a laptop, so saves are retried, and sites that
// failed for network reasons get one more attempt after the main pass.
//
// Logs counts, durations and error types only. Site-level detail goes to Supabase.
// Progress lines are printed locally, never in CI.
import { execFileSync } from "node:child_process";
import { chromium, type Browser } from "playwright";
import { isCI } from "../../scripts/env.ts";
import { isMissingTable, serviceClient } from "../../scripts/supabase.ts";
import { DELAY_BETWEEN_SITES_MS, USER_AGENT } from "./config.ts";
import { checkSite, type SiteResult } from "./check-site.ts";
import { runOutcome } from "./run-outcome.ts";

const limitIndex = process.argv.indexOf("--limit");
const limit = limitIndex > -1 ? Number(process.argv[limitIndex + 1]) : null;
const resume = process.argv.includes("--resume");
if (limit !== null && !(Number.isInteger(limit) && limit > 0)) {
  console.error("--limit needs a positive whole number.");
  process.exit(1);
}
if (limit !== null && resume) {
  console.error("--limit and --resume cannot be used together.");
  process.exit(1);
}

// Waits between save attempts. About two minutes in total, enough to ride out a Wi-Fi reconnect.
const SAVE_RETRY_WAITS_MS = [5_000, 10_000, 20_000, 40_000, 60_000];
// Failures that are more likely the crawler's network than the site, so worth one more attempt.
const RETRY_FAILURE_TYPES = new Set(["timeout", "dns", "other"]);
const PROGRESS_EVERY = 25;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const supabase = serviceClient();

function collectorVersion(): string | null {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

type Site = { id: string; url: string };

async function activeSites(): Promise<Site[]> {
  const sites: Site[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("sites").select("id, url").eq("active", true).order("url").range(from, from + pageSize - 1);
    if (error) throw new Error(isMissingTable(error) ? "The sites table does not exist. Run npm run db:migrate first." : `Reading sites failed: ${error.code}`);
    sites.push(...data);
    if (data.length < pageSize) return sites;
  }
}

type SavedResult = { site_id: string; status: string; failure_type: string | null };

async function savedResults(runId: string): Promise<SavedResult[]> {
  const rows: SavedResult[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from("site_results").select("site_id, status, failure_type").eq("run_id", runId).range(from, from + pageSize - 1);
    if (error) throw new Error(`Reading results failed: ${error.code}`);
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

async function setRunStatus(runId: string, status: "running" | "succeeded" | "failed"): Promise<void> {
  const finished_at = status === "running" ? null : new Date().toISOString();
  for (const wait of [0, ...SAVE_RETRY_WAITS_MS]) {
    await sleep(wait);
    const { error } = await supabase.from("runs").update({ status, finished_at }).eq("id", runId);
    if (!error) return;
  }
  console.error(`Could not mark the run ${status}. Check it with npm run crawl:status.`);
}

// Saves one result, retrying through short network drops. An upsert, so a retry after a
// save that reached the database but lost its reply does not create a duplicate.
const saveErrors = new Map<string, number>();
async function saveResult(runId: string, siteId: string, result: SiteResult): Promise<boolean> {
  let lastCode = "unknown";
  for (const wait of [0, ...SAVE_RETRY_WAITS_MS]) {
    await sleep(wait);
    try {
      const { error } = await supabase.from("site_results").upsert({ run_id: runId, site_id: siteId, ...result }, { onConflict: "run_id,site_id" });
      if (!error) return true;
      lastCode = error.code || "network";
      // Data and schema errors will not fix themselves, so stop retrying.
      if (/^(22|23|42)/.test(error.code ?? "")) break;
    } catch (err) {
      lastCode = (err as Error).name || "network";
    }
  }
  saveErrors.set(lastCode, (saveErrors.get(lastCode) ?? 0) + 1);
  return false;
}

function progress(done: number, total: number, failed: number, skipped: number, startedAt: number): void {
  if (isCI || done % PROGRESS_EVERY !== 0 || done === total) return;
  const perSite = (Date.now() - startedAt) / done;
  console.log(`${done} of ${total} sites checked (${Math.round((100 * done) / total)}%), ${failed} failed, ${skipped} skipped, about ${Math.ceil(((total - done) * perSite) / 60_000)} min left.`);
}

// Checks each site and saves its result. Returns sites worth one more attempt.
async function crawl(browser: Browser, runId: string | null, sites: Site[]): Promise<Site[]> {
  const startedAt = Date.now();
  const retry: Site[] = [];
  let failed = 0, skipped = 0;
  for (const [i, site] of sites.entries()) {
    if (i > 0) await sleep(DELAY_BETWEEN_SITES_MS);
    const result = await checkSite(browser, site.url);
    if (result.status === "failed") failed++;
    if (result.status === "skipped") skipped++;
    const saved = runId ? await saveResult(runId, site.id, result) : true;
    if (!saved || (result.status === "failed" && RETRY_FAILURE_TYPES.has(result.failure_type ?? ""))) retry.push(site);
    progress(i + 1, sites.length, failed, skipped, startedAt);
  }
  return retry;
}

// Choose the run and the sites to check.
const startedAt = Date.now();
let allSites: Site[];
try {
  allSites = await activeSites();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
if (limit !== null) allSites = allSites.slice(0, limit);
if (allSites.length === 0) {
  console.error("No active sites to crawl. Add some with npm run sites:import.");
  process.exit(1);
}
let sites = allSites;
let runId: string | null = null;

if (resume) {
  const { data, error } = await supabase.from("runs").select("id, status, started_at").eq("source", "web").order("started_at", { ascending: false }).limit(1);
  if (error) {
    console.error(`Reading runs failed: ${error.code}`);
    process.exit(1);
  }
  const latest = data?.[0];
  if (!latest || latest.status === "succeeded") {
    console.log("The latest web run already succeeded. Nothing to resume. Use npm run crawl for a new run.");
    process.exit(0);
  }
  runId = latest.id;
  const done = new Set((await savedResults(latest.id)).map((r) => r.site_id));
  sites = allSites.filter((s) => !done.has(s.id));
  const when = new Date(latest.started_at).toLocaleString("en-AU", { timeZone: "Australia/Brisbane" });
  console.log(`Resuming the run started ${when}: ${done.size} sites already saved, ${sites.length} to check.`);
  await setRunStatus(latest.id, "running");
} else if (limit === null) {
  const { data, error } = await supabase
    .from("runs")
    .insert({ source: "web", user_agent: USER_AGENT, collector_version: collectorVersion() })
    .select("id")
    .single();
  if (error) {
    console.error(`Could not create run: ${error.code}`);
    process.exit(1);
  }
  runId = data.id;
} else {
  console.log(`Test crawl of ${sites.length} site(s). Results are not stored.`);
}

// Mark the run failed if the process is stopped part way. It can be finished with --resume.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    if (runId) {
      await setRunStatus(runId, "failed");
      console.error(`Stopped by ${signal}. Run marked failed. Finish it with npm run crawl -- --resume.`);
    }
    process.exit(1);
  });
}

// Main pass, then one more attempt for sites that failed for network reasons or could not be saved.
const browser = await chromium.launch();
try {
  const retry = await crawl(browser, runId, sites);
  if (retry.length > 0) {
    if (!isCI) console.log(`Retrying ${retry.length} site(s) that failed for network reasons or could not be saved.`);
    await sleep(30_000);
    await crawl(browser, runId, retry);
  }
} finally {
  await browser.close();
}

const minutes = Math.round((Date.now() - startedAt) / 60_000);
if (!runId) {
  console.log(`Test crawl finished in ${minutes} min.`);
  process.exit(0);
}

// Judge the whole run from what is saved, so a resumed run counts every site.
const results = await savedResults(runId).catch(() => null);
if (!results) {
  await setRunStatus(runId, "failed");
  console.error("Could not read the saved results to check the run. Run marked failed. Finish it with npm run crawl -- --resume.");
  process.exit(1);
}
const saved = new Set(results.map((r) => r.site_id));
const unsaved = allSites.filter((s) => !saved.has(s.id)).length;
const count = (status: string) => results.filter((r) => r.status === status).length;
const failureTypes = new Map<string, number>();
for (const r of results) if (r.failure_type) failureTypes.set(r.failure_type, (failureTypes.get(r.failure_type) ?? 0) + 1);

const outcome = runOutcome({ total: allSites.length, failed: count("failed"), writeErrors: unsaved });
await setRunStatus(runId, outcome.status);

const failures = [...failureTypes].map(([type, n]) => `${n} ${type}`).join(", ");
console.log(
  `Crawled ${allSites.length} site(s) in ${minutes} min: ${count("ok")} checked, ` +
    `${count("failed")} failed, ${count("skipped")} skipped${failures ? ` (${failures})` : ""}.`,
);
if (saveErrors.size > 0) console.log(`Save errors after retries: ${[...saveErrors].map(([code, n]) => `${n} ${code}`).join(", ")}.`);
if (outcome.status === "failed") {
  console.error(`${outcome.reason} Run marked failed. Finish it with npm run crawl -- --resume.`);
  process.exit(1);
}
console.log("Run succeeded.");
