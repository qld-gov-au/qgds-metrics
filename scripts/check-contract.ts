// Checks the data contract: the example snapshot matches the JSON schema, and
// schema.sql runs on Postgres and enforces its rules. Uses in-memory Postgres
// (PGlite), so it needs no database or secrets.
import { readdirSync, readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { PGlite } from "@electric-sql/pglite";

const addFormats = addFormatsModule as unknown as typeof addFormatsModule.default;
const read = (path: string) => readFileSync(new URL(`../contract/${path}`, import.meta.url), "utf8");

let failures = 0;
let passes = 0;
function expect(label: string, ok: boolean): void {
  if (ok) passes++;
  else {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

// Snapshot JSON schema

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(read("snapshot.schema.json")));
const example = JSON.parse(read("examples/snapshot.example.json"));
const variant = (change: (s: any) => void) => {
  const copy = structuredClone(example);
  change(copy);
  return validate(copy);
};

expect("example snapshot is valid", validate(example));
expect("snapshot with no runs is valid", validate({ schema_version: "1.0", generated_at: "2026-01-01T00:00:00Z", web: null, figma: null }));
expect("null component_actions is valid", variant((s) => (s.figma.component_actions = null)));
expect("null detach rate is valid", variant((s) => Object.assign(s.figma.component_actions.totals, { insertions: 0, detach_rate: null })));
expect("unknown codebase is rejected", !variant((s) => (s.web.sites[0].codebases = ["unknown"])));
expect("negative detach rate is rejected", !variant((s) => (s.figma.component_actions.totals.detach_rate = -0.1)));
expect("missing component_actions is rejected", !variant((s) => delete s.figma.component_actions));
expect("unexpected field is rejected", !variant((s) => (s.web.sites[0].page_title = "x")));

// Example totals must agree with the example sites

const t = example.web.totals;
const sites = example.web.sites;
expect("example sites_scanned matches sites", t.sites_scanned === sites.length);
expect("example sites_checked + sites_failed = sites_scanned", t.sites_checked + t.sites_failed === t.sites_scanned);
expect("example sites_using_qgds matches sites", t.sites_using_qgds === sites.filter((s: any) => s.uses_qgds).length);

// Database schema

const db = new PGlite();
await db.exec(read("schema.sql"));
const id = async (sql: string) => ((await db.query<{ id: string }>(sql)).rows[0]).id;
const run = await id("insert into runs (source) values ('web') returning id");
const siteA = await id("insert into sites (url, organisation) values ('https://site-a.example', 'example-agency') returning id");
const siteB = await id("insert into sites (url) values ('https://site-b.example') returning id");
const figmaRun = await id("insert into runs (source) values ('figma') returning id");

async function accepts(label: string, sql: string, params: unknown[]) {
  try {
    await db.query(sql, params);
    expect(label, true);
  } catch {
    expect(label, false);
  }
}
async function rejects(label: string, sql: string, params: unknown[]) {
  try {
    await db.query(sql, params);
    expect(label, false);
  } catch {
    expect(label, true);
  }
}

const result = "insert into site_results (run_id, site_id, status, failure_type, uses_qgds, codebases) values ($1, $2, $3, $4, $5, $6)";
await accepts("ok site result", result, [run, siteA, "ok", null, true, ["bootstrap", "web_components"]]);
await rejects("unknown codebase", result, [run, siteB, "ok", null, true, ["unknown"]]);
await rejects("failed without failure_type", result, [run, siteB, "failed", null, null, []]);
await rejects("ok with failure_type", result, [run, siteB, "ok", "dns", true, []]);
await rejects("ok without uses_qgds", result, [run, siteB, "ok", null, null, []]);
await rejects("failed with uses_qgds", result, [run, siteB, "failed", "dns", false, []]);
await rejects("failed with codebases", result, [run, siteB, "failed", "dns", null, ["bootstrap"]]);
await accepts("failed site result", result, [run, siteB, "failed", "timeout", null, []]);
await rejects("duplicate site in a run", result, [run, siteB, "failed", "timeout", null, []]);

const usage = "insert into figma_usage (run_id, asset_type, asset_key, asset_name, usages) values ($1, $2, $3, 'name', $4)";
await accepts("figma usage row", usage, [figmaRun, "component", "k1", 3]);
await rejects("unknown asset_type", usage, [figmaRun, "icon", "k2", 1]);
await rejects("negative usages", usage, [figmaRun, "style", "k3", -1]);

const action = "insert into figma_component_actions (run_id, component_key, component_name, week, detachments) values ($1, 'k1', 'name', $2, $3)";
await accepts("component action row", action, [figmaRun, "2025-12-22", 2]);
await rejects("duplicate component week", action, [figmaRun, "2025-12-22", 0]);
await rejects("negative detachments", action, [figmaRun, "2025-12-29", -1]);

await db.close();

// Migrations must produce the same schema as the contract

async function describeSchema(sql: string[]): Promise<string> {
  const pg = new PGlite();
  for (const statement of sql) await pg.exec(statement);
  const parts = await Promise.all([
    pg.query(`select table_name, column_name, data_type, is_nullable, column_default
              from information_schema.columns where table_schema = 'public' order by 1, 2`),
    pg.query(`select c.relname, pg_get_constraintdef(k.oid) as def from pg_constraint k
              join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' order by 1, 2`),
    pg.query(`select tablename, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`),
    pg.query(`select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and relkind = 'r' order by 1`),
  ]);
  await pg.close();
  return JSON.stringify(parts.map((p) => p.rows));
}

const migrationsDir = new URL("../db/migrations/", import.meta.url);
const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(new URL(f, migrationsDir), "utf8"));
expect("db/migrations exist", migrations.length > 0);
expect("db/migrations produce the contract schema", (await describeSchema(migrations)) === (await describeSchema([read("schema.sql")])));

if (failures > 0) {
  console.error(`Contract check failed: ${failures} failed, ${passes} passed.`);
  process.exit(1);
}
console.log(`Contract check passed: ${passes} checks.`);
