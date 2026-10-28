// Applies review decisions from fixtures/discovery/candidates.csv.
//
//   npm run discover:apply
//
// Rows marked `add` are appended to fixtures/sites.csv. Rows marked `skip` are remembered in
// fixtures/discovery/excluded.txt, so discover never suggests them again. Blank rows stay in
// the review file for later. Nothing is written unless every decision is valid.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseCsv, toCsv } from "../../../scripts/csv.ts";

const CANDIDATES = "fixtures/discovery/candidates.csv";
const EXCLUDED = "fixtures/discovery/excluded.txt";
const SITES = "fixtures/sites.csv";
const SITE_COLUMNS = ["url", "organisation", "department", "brand_tier", "kind", "needs_review", "active"];
const TIERS = ["master_brand", "sub_brand", "co_brand", "endorsed", "stand_alone", ""];

if (!existsSync(CANDIDATES)) {
  console.error(`No review file at ${CANDIDATES}. Run npm run discover first.`);
  process.exit(1);
}
const sitesText = readFileSync(SITES, "utf8");
if (sitesText.split(/\r?\n/)[0].trim() !== SITE_COLUMNS.join(",")) {
  console.error(`${SITES} does not have the expected columns. Nothing was changed.`);
  process.exit(1);
}

const candidates = parseCsv(readFileSync(CANDIDATES, "utf8"));
const problems: string[] = [];
candidates.forEach((c, i) => {
  const d = c.decision.toLowerCase();
  if (!["add", "skip", ""].includes(d)) problems.push(`Line ${i + 2}: decision must be add, skip or blank.`);
  if (d === "add" && !TIERS.includes(c.brand_tier.toLowerCase().replace(/[\s-]+/g, "_"))) problems.push(`Line ${i + 2}: brand_tier is not one of ${TIERS.filter(Boolean).join(", ")}.`);
  if (d === "add" && !["website", "app"].includes(c.kind.toLowerCase())) problems.push(`Line ${i + 2}: kind must be website or app.`);
});
if (problems.length) {
  console.error(`${problems.length} problem(s). Nothing was changed.\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

const add = candidates.filter((c) => c.decision.toLowerCase() === "add");
const skip = candidates.filter((c) => c.decision.toLowerCase() === "skip");
const keep = candidates.filter((c) => !c.decision.trim());

const listed = new Set(parseCsv(sitesText).map((r) => new URL(r.url).href));
const newRows = add
  .filter((c) => !listed.has(new URL(c.url).href))
  .map((c) => ({
    url: new URL(c.url).href,
    organisation: c.organisation,
    department: c.department,
    brand_tier: c.brand_tier.toLowerCase().replace(/[\s-]+/g, "_"),
    kind: c.kind.toLowerCase(),
    // Rows with missing details stay flagged for review in the site list.
    needs_review: c.organisation && c.department && c.brand_tier ? "no" : "yes",
    active: "yes",
  }));
if (newRows.length) appendFileSync(SITES, (sitesText.endsWith("\n") ? "" : "\r\n") + toCsv(SITE_COLUMNS, newRows).split("\r\n").slice(1).join("\r\n"));
if (skip.length) appendFileSync(EXCLUDED, skip.map((c) => c.checked_host.toLowerCase()).join("\n") + "\n");
writeFileSync(CANDIDATES, toCsv(["decision", "url", "kind", "organisation", "department", "brand_tier", "title", "reason", "checked_host"], keep));

console.log(`Added ${newRows.length} site(s) to ${SITES}${add.length > newRows.length ? ` (${add.length - newRows.length} already listed)` : ""}. Skipped ${skip.length}. ${keep.length} still to review.`);
if (newRows.length) console.log(`${newRows.filter((r) => r.needs_review === "yes").length} added row(s) are marked needs_review because details are missing.\nNext: npm run sites:import -- ${SITES} && npm run data:push`);
