import assert from "node:assert/strict";
import { test } from "node:test";
import { actionRows, libraryTotals, parseFileKey, teamActionRows, usageRows, weekWindow } from "../src/figma.ts";

const KEY = "AbCdEfGhIjKlMnOpQrStUv";

test("parseFileKey accepts a key, a key with a name, and full URLs", () => {
  assert.equal(parseFileKey(KEY), KEY);
  assert.equal(parseFileKey(`${KEY}/Example-library`), KEY);
  assert.equal(parseFileKey(`${KEY}/Example-library?node-id=1-2`), KEY);
  assert.equal(parseFileKey(`https://www.figma.com/design/${KEY}/Example-library?node-id=0-1`), KEY);
  assert.equal(parseFileKey(`https://www.figma.com/file/${KEY}/Example`), KEY);
  assert.equal(parseFileKey(`  ${KEY}  `), KEY);
});

test("parseFileKey rejects values without a key", () => {
  assert.equal(parseFileKey(""), null);
  assert.equal(parseFileKey("not a key"), null);
  assert.equal(parseFileKey("https://example.com/design/short"), null);
});

test("weekWindow covers 12 complete Sunday weeks before the current week", () => {
  // Wednesday 30 September 2026. The current week started on Sunday 27 September.
  const w = weekWindow(new Date("2026-09-30T10:00:00Z"));
  assert.deepEqual(w, { startDate: "2026-07-05", endDate: "2026-09-26", lastWeek: "2026-09-20" });
});

test("weekWindow on a Sunday excludes that day's new week", () => {
  const w = weekWindow(new Date("2026-09-27T01:00:00Z"));
  assert.equal(w.lastWeek, "2026-09-20");
  assert.equal(w.endDate, "2026-09-26");
});

test("usageRows maps each asset type and group", () => {
  const rows = usageRows(
    "run",
    [{ component_key: "c1", component_name: "Size=Large", component_set_name: "Example button", usages: 5, teams_using: 1, files_using: 2 }],
    [{ style_key: "s1", style_name: "Example colour", style_type: "FILL", usages: 3, teams_using: 1, files_using: 1 }],
    [{ variable_key: "v1", variable_name: "example/space", collection_name: "", usages: 2, teams_using: 1, files_using: 1 }],
  );
  assert.deepEqual(rows.map((r) => [r.asset_type, r.asset_key, r.asset_group]), [
    ["component", "c1", "Example button"],
    ["style", "s1", "FILL"],
    ["variable", "v1", null],
  ]);
});

test("actionRows keeps only complete weeks in the window", () => {
  const action = (week: string) => ({ component_key: "c1", component_name: "Example", component_set_name: null, week, insertions: 1, detachments: 0 });
  const rows = actionRows("run", [action("2026-06-28"), action("2026-07-05"), action("2026-09-20"), action("2026-09-27")], { startDate: "2026-07-05", lastWeek: "2026-09-20" });
  assert.deepEqual(rows.map((r) => r.week), ["2026-07-05", "2026-09-20"]);
});

test("libraryTotals separates the library file by exact name", () => {
  const rows = [
    { file_name: "Example library", team_name: "Example team", usages: 10 },
    { file_name: "Example library (Copy)", team_name: "Other team", usages: 5 },
    { file_name: "Project file", team_name: "Other team", usages: 85 },
  ];
  assert.deepEqual(libraryTotals(rows, "Example library", true), { usages_all_files: 100, usages_library_file: 10 });
});

test("libraryTotals requires a match for components but not for styles or variables", () => {
  const rows = [{ file_name: "Project file", usages: 5 }];
  assert.throws(() => libraryTotals(rows, "Example library", true), /No file matches/);
  assert.deepEqual(libraryTotals(rows, "Example library", false), { usages_all_files: 5, usages_library_file: 0 });
});

test("libraryTotals refuses an ambiguous name", () => {
  const rows = [{ file_name: "Example library", usages: 1 }, { file_name: "Example library", usages: 2 }];
  assert.throws(() => libraryTotals(rows, "Example library", false), /2 files are named like the library/);
});

test("teamActionRows keeps complete weeks and names rows without a team", () => {
  const rows = teamActionRows("run", [
    { team_name: "Example team", week: "2026-07-05", insertions: 3, detachments: 1 },
    { team_name: null, week: "2026-07-12", insertions: 2, detachments: 0 },
    { team_name: "Example team", week: "2026-09-27", insertions: 9, detachments: 9 },
  ], { startDate: "2026-07-05", lastWeek: "2026-09-20" });
  assert.deepEqual(rows.map((r) => [r.team_name, r.week, r.detachments]), [["Example team", "2026-07-05", 1], ["(no team)", "2026-07-12", 0]]);
});

test("teamActionRows adds together teams Figma will not name", () => {
  const rows = teamActionRows("run", [
    { team_name: "Team not visible", week: "2026-07-05", insertions: 3, detachments: 1 },
    { team_name: "Team not visible", week: "2026-07-05", insertions: 2, detachments: 2 },
    { team_name: "Example team", week: "2026-07-05", insertions: 1, detachments: 0 },
  ], { startDate: "2026-07-05", lastWeek: "2026-09-20" });
  assert.deepEqual(rows.map((r) => [r.team_name, r.insertions, r.detachments]), [["Team not visible", 5, 3], ["Example team", 1, 0]]);
});
