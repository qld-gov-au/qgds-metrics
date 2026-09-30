// Loads the list of sites to crawl.
//
//   npm run sites:import -- fixtures/sites.csv   the full list, with organisation, department,
//                                                brand_tier, kind and active columns
//   npm run sites:import -- seeds.txt            adds URLs only, one per line
//
// A CSV is treated as the complete list: sites in the database but not in the file are
// set inactive, never deleted, so their history is kept. Nothing is written unless every
// row is valid. Logs counts only.
import { readFileSync } from "node:fs";
import { parseCsv } from "../scripts/csv.ts";
import { isMissingTable, serviceClient } from "../scripts/supabase.ts";

const BRAND_TIERS = ["master_brand", "sub_brand", "co_brand", "endorsed", "stand_alone"];
const KINDS = ["website", "app"];
const REQUIRED_COLUMNS = ["url", "organisation", "department", "brand_tier", "kind", "active"];

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run sites:import -- <file.csv | file.txt>");
  process.exit(1);
}

function normaliseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    for (const key of [...url.searchParams.keys()]) if (key.startsWith("utm_")) url.searchParams.delete(key);
    return url.href;
  } catch {
    return null;
  }
}

interface SiteRow { url: string; organisation: string | null; department: string | null; brand_tier: string | null; kind: string; active: boolean }

function fromCsv(text: string): { sites: SiteRow[]; needsReview: number } {
  const records = parseCsv(text);
  const missing = REQUIRED_COLUMNS.filter((c) => records.length > 0 && !(c in records[0]));
  if (missing.length) throw new Error(`Missing column(s): ${missing.join(", ")}.`);
  const problems: string[] = [];
  const sites: SiteRow[] = [];
  const seen = new Set<string>();
  records.forEach((r, i) => {
    const line = i + 2;
    const url = normaliseUrl(r.url);
    const tier = r.brand_tier.toLowerCase().replace(/[\s-]+/g, "_");
    const kind = r.kind.toLowerCase() || "website";
    const active = r.active.toLowerCase();
    if (!url) problems.push(`Line ${line}: invalid URL.`);
    else if (seen.has(url)) problems.push(`Line ${line}: duplicate URL.`);
    if (tier && !BRAND_TIERS.includes(tier)) problems.push(`Line ${line}: brand_tier must be one of ${BRAND_TIERS.join(", ")}.`);
    if (!KINDS.includes(kind)) problems.push(`Line ${line}: kind must be website or app.`);
    if (!["yes", "no", ""].includes(active)) problems.push(`Line ${line}: active must be yes or no.`);
    if (url) seen.add(url);
    sites.push({ url: url ?? "", organisation: r.organisation || null, department: r.department || null, brand_tier: tier || null, kind, active: active !== "no" });
  });
  if (problems.length) throw new Error(`${problems.length} problem(s). Nothing was imported.\n  ${problems.slice(0, 20).join("\n  ")}`);
  const needsReview = records.filter((r) => (r.needs_review ?? "").toLowerCase() === "yes").length;
  return { sites, needsReview };
}

const supabase = serviceClient();
const fail = (error: { code?: string } | null, action: string) => {
  console.error(isMissingTable(error) ? "A table is missing. Run npm run db:migrate first." : `${action} failed: ${error?.code}`);
  process.exit(1);
};

const text = readFileSync(file, "utf8");
if (file.toLowerCase().endsWith(".csv")) {
  let parsed: ReturnType<typeof fromCsv>;
  try {
    parsed = fromCsv(text);
  } catch (err) {
    console.error(`${file}: ${(err as Error).message}`);
    process.exit(1);
  }
  const { sites, needsReview } = parsed;

  const { data: existing, error: readError } = await supabase.from("sites").select("url, active");
  if (readError) fail(readError, "Reading sites");
  const inFile = new Set(sites.map((s) => s.url));
  const known = new Set((existing ?? []).map((s) => s.url as string));

  for (let i = 0; i < sites.length; i += 500) {
    const { error } = await supabase.from("sites").upsert(sites.slice(i, i + 500), { onConflict: "url" });
    if (error) fail(error, "Saving sites");
  }
  const toDeactivate = (existing ?? []).filter((s) => s.active && !inFile.has(s.url as string)).map((s) => s.url as string);
  if (toDeactivate.length) {
    const { error } = await supabase.from("sites").update({ active: false }).in("url", toDeactivate);
    if (error) fail(error, "Deactivating sites");
  }

  const added = sites.filter((s) => !known.has(s.url)).length;
  const blank = (key: keyof SiteRow) => sites.filter((s) => s.active && !s[key]).length;
  console.log(
    `Imported ${sites.length} site(s): ${added} new, ${sites.length - added} updated, ${sites.filter((s) => !s.active).length} inactive in the file. ` +
      `${toDeactivate.length} site(s) not in the file set inactive.`,
  );
  console.log(`Active sites without a department: ${blank("department")}, without a brand tier: ${blank("brand_tier")}.`);
  if (needsReview) console.log(`${needsReview} row(s) are still marked needs_review. Review them, then import again.`);
} else {
  const urls = [...new Set(text.split("\n").map((l) => normaliseUrl(l.split("#")[0].trim())).filter((u): u is string => u !== null))];
  const { data, error } = await supabase.from("sites").upsert(urls.map((url) => ({ url })), { onConflict: "url", ignoreDuplicates: true }).select("id");
  if (error) fail(error, "Import");
  console.log(`Read ${urls.length} URL(s). Added ${data!.length} new site(s), ${urls.length - data!.length} already present.`);
}
