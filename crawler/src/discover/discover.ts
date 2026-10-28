// Finds Queensland Government sites missing from the site list.
//
//   npm run discover                       find and check new hostnames
//   npm run discover -- --recheck-days 30  also recheck hostnames checked more than 30 days ago
//   npm run discover -- --limit 20         check at most 20 hostnames, for testing
//
// 1. Asks the public certificate logs (crt.sh) for every qld.gov.au hostname with a current
//    certificate, and saves the list. crt.sh is reached on database port 5432, which many work
//    networks block. When it cannot be reached, the last saved list is used instead.
// 2. Drops hostnames already listed, rejected before, likely councils, and infrastructure.
// 3. Visits the rest in a browser, following robots.txt, one request per site.
// 4. Writes candidates to fixtures/discovery/candidates.csv for review. Mark each `add` or
//    `skip`, then run npm run discover:apply.
//
// Everything it writes is private and stays in fixtures/. Logs counts only.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import postgres from "postgres";
import { parseCsv, toCsv } from "../../../scripts/csv.ts";
import { serviceClient } from "../../../scripts/supabase.ts";
import { BLOCKED_RESOURCE_TYPES, DELAY_BETWEEN_SITES_MS, PAGE_TIMEOUT_MS, USER_AGENT, VIEWPORT } from "../config.ts";
import { checkRobots } from "../robots.ts";
import { classify, departmentsIn, parentOf, prefilter, ROOT_DOMAIN, type Outcome, type Visit } from "./rules.ts";

const DIR = "fixtures/discovery";
const CHECKED = `${DIR}/checked.csv`;
const EXCLUDED = `${DIR}/excluded.txt`;
const CANDIDATES = `${DIR}/candidates.csv`;
const HOSTNAMES = `${DIR}/hostnames.txt`;
const SITES = "fixtures/sites.csv";
const CHECKED_COLUMNS = ["host", "checked_at", "outcome", "reason", "final_url", "title", "department_in_footer"];
const PARALLEL_SITES = 4;

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const recheckDays = Number(arg("--recheck-days") ?? 180);
const limit = arg("--limit") ? Number(arg("--limit")) : Infinity;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");

// 0. Do not run alongside a crawl: both would visit the same sites.
const { data: latest } = await serviceClient().from("runs").select("status, started_at").eq("source", "web").order("started_at", { ascending: false }).limit(1);
if (latest?.[0]?.status === "running" && Date.now() - Date.parse(latest[0].started_at) < 6 * 3_600_000) {
  console.error("A website crawl is running. Run discover after it finishes, so sites are not visited twice at once.");
  process.exit(1);
}

// Inputs: the site list, earlier checks and earlier rejections.
if (!existsSync(SITES)) {
  console.error(`No site list at ${SITES}. Run npm run data:pull first.`);
  process.exit(1);
}
mkdirSync(DIR, { recursive: true });
const sites = parseCsv(readFileSync(SITES, "utf8")).filter((r) => r.url);
const listedSites = sites.map((r) => ({ host: bare(new URL(r.url).hostname), path: new URL(r.url).pathname.replace(/\/$/, ""), row: r }));
const listed = new Set(listedSites.map((s) => s.host));
const excluded = new Set(existsSync(EXCLUDED) ? readFileSync(EXCLUDED, "utf8").split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#")) : []);
const departmentNames = [...new Set(sites.map((r) => r.department).filter(Boolean))];
const checked = new Map((existsSync(CHECKED) ? parseCsv(readFileSync(CHECKED, "utf8")) : []).map((r) => [r.host, r]));

// 1. Hostnames from the certificate logs.
console.log("Step 1 of 3: asking the certificate logs for current hostnames.");
let hostnames: string[] = [];
const sql = postgres({ host: "crt.sh", port: 5432, database: "certwatch", username: "guest", max: 1, connect_timeout: 30, idle_timeout: 5, ssl: false, prepare: false });
try {
  const rows = await sql.unsafe(
    `SELECT DISTINCT lower(cai.name_value) AS name FROM certificate_and_identities cai
     WHERE plainto_tsquery('certwatch', $1) @@ identities(cai.certificate)
       AND cai.name_value ILIKE $2 AND cai.name_type = 'san:dNSName'
       AND x509_notAfter(cai.certificate) > now()
     LIMIT 200000`,
    [ROOT_DOMAIN, `%.${ROOT_DOMAIN}`],
  );
  hostnames = [...new Set(rows.map((r) => bare(String(r.name).replace(/^\*\./, ""))).filter((n) => /^[a-z0-9.-]+$/.test(n) && n.endsWith(`.${ROOT_DOMAIN}`)))].sort();
  writeFileSync(HOSTNAMES, `# Saved ${new Date().toISOString()} from crt.sh\n${hostnames.join("\n")}\n`);
  console.log(`Saved ${hostnames.length} hostnames for next time.`);
} catch (err) {
  const code = (err as { code?: string }).code ?? (err as Error).name;
  if (!existsSync(HOSTNAMES)) {
    console.error(`The certificate logs could not be reached (${code}) and there is no saved list yet. Run discover once from a network that allows database connections, such as home internet or a phone hotspot.`);
    process.exit(1);
  }
  const text = readFileSync(HOSTNAMES, "utf8");
  const saved = text.match(/^# Saved (\S+)/)?.[1];
  const days = saved ? Math.floor((Date.now() - Date.parse(saved)) / 86_400_000) : null;
  hostnames = text.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  console.log(`The certificate logs could not be reached (${code}). Many work networks block them. Using the saved list of ${hostnames.length} hostnames${days !== null ? ` from ${days} day(s) ago` : ""}.`);
  if (days === null || days > 60) console.log("The saved list is old. To refresh it, run discover from a network that allows database connections, such as home internet or a phone hotspot.");
} finally {
  await sql.end({ timeout: 2 }).catch(() => {});
}

// 2. Drop what does not need a visit.
const reasons = new Map<string, number>();
const fresh = (host: string) => { const c = checked.get(host); return c && Date.now() - Date.parse(c.checked_at) < recheckDays * 86_400_000; };
const toCheck = hostnames.filter((h) => {
  const p = prefilter(h, { listed, excluded });
  if (!p.keep) { reasons.set(p.reason, (reasons.get(p.reason) ?? 0) + 1); return false; }
  if (fresh(h)) { reasons.set("Checked recently", (reasons.get("Checked recently") ?? 0) + 1); return false; }
  return true;
}).slice(0, limit);
console.log(`Found ${hostnames.length} hostnames. ${toCheck.length} to check. Left out: ${[...reasons].map(([r, n]) => `${n} ${r.toLowerCase()}`).join(", ") || "none"}.`);

// 3. Visit each one in a browser. Each result is saved as it comes, so a stopped run loses nothing.
async function visitHost(browser: Browser, host: string): Promise<Record<string, string>> {
  const context = await browser.newContext({ userAgent: USER_AGENT, viewport: VIEWPORT });
  await context.route("**/*", (route) => (BLOCKED_RESOURCE_TYPES.has(route.request().resourceType()) ? route.abort() : route.continue()));
  const page = await context.newPage();
  let result: { outcome: Outcome; reason: string } = { outcome: "not_live", reason: "Not checked" };
  let visit: Visit | null = null, departments: string[] = [];
  try {
    // Try the bare hostname, then www, and keep the first that answers.
    for (const [i, url] of [`https://${host}/`, `https://www.${host}/`].entries()) {
      if (i > 0) await sleep(DELAY_BETWEEN_SITES_MS);
      const robots = await checkRobots(url, page);
      if (robots !== "allowed") { result = { outcome: "robots", reason: robots === "disallowed" ? "robots.txt disallows crawling" : "robots.txt unreachable" }; break; }
      try {
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
        await page.waitForTimeout(2000);
        // Footer text is matched against department names in memory and never stored.
        const page_ = await page.evaluate(() => {
          const f = document.querySelector("footer, [role=contentinfo], qgds-footer, .footer, #footer");
          return { title: (document.title || "").trim().slice(0, 120), textLength: (document.body?.innerText || "").trim().length, hasPassword: !!document.querySelector("input[type=password]"), footer: (f as HTMLElement | null)?.innerText || document.body?.innerText.slice(-3000) || "" };
        });
        departments = departmentsIn(page_.footer, departmentNames);
        visit = { status: response?.status() ?? null, finalUrl: page.url(), title: page_.title, textLength: page_.textLength, hasPassword: page_.hasPassword };
      } catch (err) {
        const m = (err as Error).message;
        visit = { status: null, finalUrl: null, title: "", textLength: 0, hasPassword: false, error: /NAME_NOT_RESOLVED/.test(m) ? "Address not found" : /Timeout/.test(m) ? "Timed out" : /CERT|SSL/.test(m) ? "Certificate error" : "Connection failed" };
      }
      result = classify(visit, host, { listed });
      if (result.outcome !== "not_live") break;
    }
  } finally {
    await context.close();
  }
  return { host, checked_at: new Date().toISOString(), outcome: result.outcome, reason: result.reason, final_url: visit?.finalUrl ?? "", title: visit?.title ?? "", department_in_footer: departments[0] ?? "" };
}

if (toCheck.length > 0) {
  console.log(`Step 2 of 3: checking ${toCheck.length} hostnames in a browser. This takes about 3 seconds each.`);
  if (!existsSync(CHECKED)) writeFileSync(CHECKED, toCsv(CHECKED_COLUMNS, []));
  const browser = await chromium.launch();
  const queue = [...toCheck];
  let done = 0;
  const startedAt = Date.now();
  await Promise.all(Array.from({ length: PARALLEL_SITES }, async () => {
    while (queue.length) {
      const host = queue.shift()!;
      const row = await visitHost(browser, host).catch(() => ({ host, checked_at: new Date().toISOString(), outcome: "not_live", reason: "Check failed", final_url: "", title: "", department_in_footer: "" }));
      checked.set(host, row);
      appendFileSync(CHECKED, toCsv(CHECKED_COLUMNS, [row]).split("\r\n").slice(1).join("\r\n"));
      if (++done % 50 === 0) console.log(`${done} of ${toCheck.length} checked, about ${Math.ceil(((toCheck.length - done) * (Date.now() - startedAt)) / done / 60_000)} min left.`);
      await sleep(DELAY_BETWEEN_SITES_MS);
    }
  }));
  await browser.close();
}

// 4. Write the review file: every checked public site or sign-in app not yet listed or rejected.
console.log("Step 3 of 3: writing the review file.");
const previous = new Map((existsSync(CANDIDATES) ? parseCsv(readFileSync(CANDIDATES, "utf8")) : []).map((r) => [r.checked_host, r]));
const seenUrls = new Set<string>();
const candidates = [...checked.values()]
  .filter((c) => (c.outcome === "public_site" || c.outcome === "sign_in") && !listed.has(c.host) && !excluded.has(c.host))
  .map((c) => {
    // For a sign-in page, record the app's own address, never the sign-in page.
    const url = c.outcome === "sign_in" || !c.final_url ? `https://${c.host}/` : c.final_url;
    const parent = parentOf(c.host, listedSites)?.row;
    return {
      decision: previous.get(c.host)?.decision ?? "",
      url,
      kind: c.outcome === "sign_in" ? "app" : "website",
      organisation: parent?.organisation ?? "",
      department: c.department_in_footer || parent?.department || "",
      brand_tier: parent?.brand_tier ?? "",
      title: c.title,
      reason: c.outcome === "sign_in" ? c.reason : "Public website",
      checked_host: c.host,
    };
  })
  .filter((c) => { const key = bare(new URL(c.url).hostname) + new URL(c.url).pathname.replace(/\/$/, ""); if (listed.has(bare(new URL(c.url).hostname)) || seenUrls.has(key)) return false; seenUrls.add(key); return true; })
  .sort((a, b) => a.kind.localeCompare(b.kind) || a.url.localeCompare(b.url));
writeFileSync(CANDIDATES, toCsv(["decision", "url", "kind", "organisation", "department", "brand_tier", "title", "reason", "checked_host"], candidates));

const outcomes = new Map<string, number>();
for (const host of toCheck) { const o = checked.get(host)?.outcome ?? "not_live"; outcomes.set(o, (outcomes.get(o) ?? 0) + 1); }
if (toCheck.length) console.log(`Checked ${toCheck.length}: ${[...outcomes].map(([o, n]) => `${n} ${o.replace(/_/g, " ")}`).join(", ")}.`);
console.log(`${candidates.length} candidate(s) to review in ${CANDIDATES} (${candidates.filter((c) => c.kind === "website").length} websites, ${candidates.filter((c) => c.kind === "app").length} sign-in apps).`);
if (candidates.length) console.log("Open it, set decision to add or skip for each row, save, then run: npm run discover:apply");
