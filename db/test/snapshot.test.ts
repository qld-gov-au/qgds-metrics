import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { buildSnapshot, detachRate, type FigmaActionRow, type SiteResultRow } from "../snapshot.ts";

const addFormats = addFormatsModule as unknown as typeof addFormatsModule.default;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync(new URL("../../contract/snapshot.schema.json", import.meta.url), "utf8")));
const assertValid = (snapshot: unknown) => assert.ok(validate(snapshot), JSON.stringify(validate.errors));

const RUN_1 = "00000000-0000-4000-8000-000000000001";
const RUN_2 = "00000000-0000-4000-8000-000000000002";
const FIGMA = "00000000-0000-4000-8000-000000000003";
const runs = [
  { id: RUN_2, started_at: "2026-01-08T00:00:00Z", finished_at: "2026-01-08T00:05:00Z" },
  { id: RUN_1, started_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:05:00Z" },
];
const result = (run_id: string, url: string, r: Partial<SiteResultRow>): SiteResultRow => ({
  run_id, url, organisation: null, department: null, brand_tier: null, kind: "website", status: "ok", failure_type: null, uses_qgds: false, codebases: [], ...r,
});
const results: SiteResultRow[] = [
  result(RUN_1, "https://site-a.example/", { uses_qgds: true, codebases: ["bootstrap"] }),
  result(RUN_1, "https://site-b.example/", {}),
  result(RUN_2, "https://site-b.example/", { uses_qgds: true, codebases: [] }),
  result(RUN_2, "https://site-a.example/", { uses_qgds: true, codebases: ["bootstrap", "web_components"], organisation: "example-agency" }),
  result(RUN_2, "https://site-c.example/", { status: "failed", failure_type: "timeout", uses_qgds: null }),
  result(RUN_2, "https://site-d.example/", { status: "skipped", failure_type: "robots_disallowed", uses_qgds: null }),
];
const empty = { generatedAt: "2026-01-09T00:00:00Z", webRuns: [], webResults: [], figmaRun: null, figmaUsage: [], figmaActions: [], figmaTotals: [] };

test("no runs gives null sections and a valid snapshot", () => {
  const s = buildSnapshot(empty);
  assert.equal(s.web, null);
  assert.equal(s.figma, null);
  assertValid(s);
});

test("web section uses the latest run and computes totals", () => {
  const s = buildSnapshot({ ...empty, webRuns: runs, webResults: results });
  assertValid(s);
  assert.equal(s.web?.run.id, RUN_2);
  assert.deepEqual(s.web?.totals, {
    sites_scanned: 4, sites_checked: 2, sites_failed: 2, sites_using_qgds: 2,
    by_codebase: { bootstrap: 1, web_components: 1, qh_vanilla: 0, unclear: 1 },
  });
  assert.deepEqual(s.web?.sites.map((x) => x.url), ["https://site-a.example/", "https://site-b.example/", "https://site-c.example/", "https://site-d.example/"]);
});

test("history lists every run oldest first", () => {
  const s = buildSnapshot({ ...empty, webRuns: runs, webResults: results });
  assert.deepEqual(s.web?.history.map((h) => h.run_id), [RUN_1, RUN_2]);
  assert.equal(s.web?.history[0].totals.sites_using_qgds, 1);
  assert.equal(s.web?.history[1].totals.sites_using_qgds, 2);
});

test("detach rate rounds to 4 places, is null with no insertions and is not capped", () => {
  assert.equal(detachRate(3, 1), 0.3333);
  assert.equal(detachRate(0, 5), null);
  assert.equal(detachRate(2, 5), 2.5);
});

test("Figma section sums actions by week and component", () => {
  const action = (component_key: string, week: string, insertions: number, detachments: number): FigmaActionRow => ({
    component_key, component_name: `Example ${component_key}`, component_group: null, week, insertions, detachments,
  });
  const s = buildSnapshot({
    ...empty,
    figmaRun: { id: FIGMA, started_at: "2026-01-09T00:00:00Z", finished_at: "2026-01-09T00:01:00Z" },
    figmaUsage: [
      { asset_type: "component", asset_key: "k1", asset_name: "Example button", asset_group: null, usages: 5, teams_using: 1, files_using: 2 },
      { asset_type: "style", asset_key: "k2", asset_name: "Example colour", asset_group: "FILL", usages: 3, teams_using: 1, files_using: 1 },
    ],
    figmaActions: [action("k1", "2026-01-05", 10, 1), action("k1", "2025-12-29", 0, 2), action("k3", "2026-01-05", 0, 0)],
  });
  assertValid(s);
  const actions = s.figma?.component_actions;
  assert.equal(actions?.period_start, "2025-12-29");
  assert.equal(actions?.period_end, "2026-01-05");
  assert.deepEqual(actions?.totals, { insertions: 10, detachments: 3, detach_rate: 0.3 });
  assert.deepEqual(actions?.by_week.map((w) => w.detach_rate), [null, 0.1]);
  assert.deepEqual(actions?.by_component.map((c) => [c.key, c.detachments]), [["k1", 3], ["k3", 0]]);
  assert.equal(s.figma?.components.length, 1);
  assert.equal(s.figma?.variables.length, 0);
});

test("Figma run with no action rows gives null component_actions", () => {
  const s = buildSnapshot({ ...empty, figmaRun: { id: FIGMA, started_at: "2026-01-09T00:00:00Z", finished_at: "2026-01-09T00:01:00Z" } });
  assertValid(s);
  assert.equal(s.figma?.component_actions, null);
});

test("Figma totals leave out the library file", () => {
  const s = buildSnapshot({
    ...empty,
    figmaRun: { id: FIGMA, started_at: "2026-01-09T00:00:00Z", finished_at: "2026-01-09T00:01:00Z" },
    figmaTotals: [
      { asset_type: "component", usages_all_files: 1000, usages_library_file: 40 },
      { asset_type: "style", usages_all_files: 500, usages_library_file: 0 },
      { asset_type: "variable", usages_all_files: 200, usages_library_file: 10 },
    ],
  });
  assertValid(s);
  assert.equal(s.schema_version, "1.3");
  assert.deepEqual(s.figma?.totals, { excludes: "library_file", component_instances: 960, style_uses: 500, variable_uses: 190 });
});

test("Figma totals are null for runs without them", () => {
  const s = buildSnapshot({ ...empty, figmaRun: { id: FIGMA, started_at: "2026-01-09T00:00:00Z", finished_at: "2026-01-09T00:01:00Z" } });
  assertValid(s);
  assert.equal(s.figma?.totals, null);
});

test("breakdowns group the latest run by brand tier and department", () => {
  const rows: SiteResultRow[] = [
    result(RUN_2, "https://site-a.example/", { uses_qgds: true, codebases: ["bootstrap"], department: "Example department", brand_tier: "sub_brand" }),
    result(RUN_2, "https://site-b.example/", { uses_qgds: false, department: "Example department", brand_tier: "endorsed" }),
    result(RUN_2, "https://site-c.example/", { uses_qgds: true, department: "Other department", brand_tier: "sub_brand" }),
    result(RUN_2, "https://site-d.example/", { status: "failed", failure_type: "timeout", uses_qgds: null }),
    result(RUN_1, "https://site-a.example/", { uses_qgds: true, department: "Example department", brand_tier: "sub_brand" }),
  ];
  const s = buildSnapshot({ ...empty, webRuns: runs, webResults: rows });
  assertValid(s);
  assert.deepEqual(s.web?.breakdowns.brand_tier, [
    { value: "sub_brand", sites_scanned: 2, sites_checked: 2, sites_using_qgds: 2 },
    { value: "endorsed", sites_scanned: 1, sites_checked: 1, sites_using_qgds: 0 },
    { value: null, sites_scanned: 1, sites_checked: 0, sites_using_qgds: 0 },
  ]);
  assert.deepEqual(s.web?.breakdowns.department.map((d) => [d.value, d.sites_scanned, d.sites_using_qgds]), [
    ["Example department", 2, 1], ["Other department", 1, 1], [null, 1, 0],
  ]);
  assert.deepEqual(s.web?.sites[0], { url: "https://site-a.example/", organisation: null, department: "Example department", brand_tier: "sub_brand", kind: "website", status: "ok", failure_type: null, uses_qgds: true, codebases: ["bootstrap"] });
});

test("by_team sums each team over the period, most detachments first", () => {
  const action = (component_key: string, week: string, insertions: number, detachments: number) => ({
    component_key, component_name: `Example ${component_key}`, component_group: null, week, insertions, detachments,
  });
  const run = { id: FIGMA, started_at: "2026-01-09T00:00:00Z", finished_at: "2026-01-09T00:01:00Z" };
  const s = buildSnapshot({
    ...empty, figmaRun: run, figmaActions: [action("k1", "2026-01-05", 10, 3)],
    figmaTeamActions: [
      { team_name: "Example team", week: "2025-12-29", insertions: 4, detachments: 0 },
      { team_name: "Other example team", week: "2026-01-05", insertions: 2, detachments: 3 },
      { team_name: "Example team", week: "2026-01-05", insertions: 4, detachments: 0 },
    ],
  });
  assertValid(s);
  assert.deepEqual(s.figma?.component_actions?.by_team, [
    { name: "Other example team", insertions: 2, detachments: 3, detach_rate: 1.5 },
    { name: "Example team", insertions: 8, detachments: 0, detach_rate: 0 },
  ]);
  const without = buildSnapshot({ ...empty, figmaRun: run, figmaActions: [action("k1", "2026-01-05", 10, 3)] });
  assertValid(without);
  assert.equal("by_team" in (without.figma?.component_actions ?? {}), false);
});
