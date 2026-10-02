// Builds the snapshot defined in contract/snapshot.schema.json from database rows.
// Pure functions, no database access, so they can be unit tested.

export interface RunRow {
  id: string;
  started_at: string;
  finished_at: string;
}

export interface SiteResultRow {
  run_id: string;
  status: "ok" | "failed" | "skipped";
  failure_type: string | null;
  uses_qgds: boolean | null;
  codebases: string[];
  url: string;
  organisation: string | null;
  department: string | null;
  brand_tier: string | null;
  kind: "website" | "app";
}

export interface FigmaUsageRow {
  asset_type: "component" | "style" | "variable";
  asset_key: string;
  asset_name: string;
  asset_group: string | null;
  usages: number;
  teams_using: number;
  files_using: number;
}

export interface FigmaActionRow {
  component_key: string;
  component_name: string;
  component_group: string | null;
  week: string;
  insertions: number;
  detachments: number;
}

export interface FigmaTotalsRow {
  asset_type: "component" | "style" | "variable";
  usages_all_files: number;
  usages_library_file: number;
}

export interface SnapshotInput {
  generatedAt: string;
  // Succeeded web runs, any order, with every result from those runs.
  webRuns: RunRow[];
  webResults: SiteResultRow[];
  // Latest succeeded Figma run, if any, with its rows.
  figmaRun: RunRow | null;
  figmaUsage: FigmaUsageRow[];
  figmaActions: FigmaActionRow[];
  // Empty for Figma runs collected before snapshot 1.1.
  figmaTotals: FigmaTotalsRow[];
  // Empty for Figma runs collected before snapshot 1.3.
  figmaTeamActions?: FigmaTeamActionRow[];
}

// Detachments divided by insertions, rounded to 4 places. Null when there were no insertions.
export function detachRate(insertions: number, detachments: number): number | null {
  return insertions === 0 ? null : Math.round((detachments / insertions) * 10_000) / 10_000;
}

export function webTotals(results: SiteResultRow[]) {
  const checked = results.filter((r) => r.status === "ok");
  const using = checked.filter((r) => r.uses_qgds === true);
  const count = (codebase: string) => using.filter((r) => r.codebases.includes(codebase)).length;
  return {
    sites_scanned: results.length,
    sites_checked: checked.length,
    sites_failed: results.length - checked.length,
    sites_using_qgds: using.length,
    by_codebase: {
      bootstrap: count("bootstrap"),
      web_components: count("web_components"),
      qh_vanilla: count("qh_vanilla"),
      unclear: using.filter((r) => r.codebases.length === 0).length,
    },
  };
}

const run = (r: RunRow) => ({ id: r.id, started_at: r.started_at, finished_at: r.finished_at });
const byFinished = (a: RunRow, b: RunRow) => a.finished_at.localeCompare(b.finished_at);

// Latest run totals grouped by one site attribute, largest group first. Null groups sites without a value.
export function breakdown(results: SiteResultRow[], key: "brand_tier" | "department") {
  const groups = new Map<string | null, SiteResultRow[]>();
  for (const r of results) groups.set(r[key], [...(groups.get(r[key]) ?? []), r]);
  return [...groups.entries()]
    .map(([value, rows]) => {
      const t = webTotals(rows);
      return { value, sites_scanned: t.sites_scanned, sites_checked: t.sites_checked, sites_using_qgds: t.sites_using_qgds };
    })
    .sort((a, b) => (a.value === null ? 1 : b.value === null ? -1 : b.sites_scanned - a.sites_scanned || a.value.localeCompare(b.value)));
}

function buildWeb(runs: RunRow[], results: SiteResultRow[]) {
  if (runs.length === 0) return null;
  const ordered = [...runs].sort(byFinished);
  const latest = ordered[ordered.length - 1];
  const resultsFor = (id: string) => results.filter((r) => r.run_id === id);
  const latestResults = resultsFor(latest.id).sort((a, b) => a.url.localeCompare(b.url));
  return {
    run: run(latest),
    totals: webTotals(latestResults),
    sites: latestResults.map((r) => ({
      url: r.url,
      organisation: r.organisation,
      department: r.department,
      brand_tier: r.brand_tier,
      kind: r.kind,
      status: r.status,
      failure_type: r.failure_type,
      uses_qgds: r.uses_qgds,
      codebases: r.codebases,
    })),
    breakdowns: { brand_tier: breakdown(latestResults, "brand_tier"), department: breakdown(latestResults, "department") },
    history: ordered.map((r) => ({ run_id: r.id, finished_at: r.finished_at, totals: webTotals(resultsFor(r.id)) })),
  };
}

export interface FigmaTeamActionRow {
  team_name: string;
  week: string;
  insertions: number;
  detachments: number;
}

function buildComponentActions(rows: FigmaActionRow[], teamRows: FigmaTeamActionRow[] = []) {
  if (rows.length === 0) return null;
  const counts = (list: { insertions: number; detachments: number }[]) => {
    const insertions = list.reduce((n, r) => n + r.insertions, 0);
    const detachments = list.reduce((n, r) => n + r.detachments, 0);
    return { insertions, detachments, detach_rate: detachRate(insertions, detachments) };
  };
  const weeks = [...new Set(rows.map((r) => r.week))].sort();
  const components = [...new Set(rows.map((r) => r.component_key))];
  return {
    period_start: weeks[0],
    period_end: weeks[weeks.length - 1],
    totals: counts(rows),
    by_week: weeks.map((week) => ({ week, ...counts(rows.filter((r) => r.week === week)) })),
    by_component: components
      .map((key) => {
        const list = rows.filter((r) => r.component_key === key);
        return { key, name: list[0].component_name, group: list[0].component_group, ...counts(list) };
      })
      .sort((a, b) => b.detachments - a.detachments || a.name.localeCompare(b.name)),
    // Only for runs that collected team actions, so older snapshots stay as they were.
    ...(teamRows.length > 0
      ? {
          by_team: [...new Set(teamRows.map((r) => r.team_name))]
            .map((name) => ({ name, ...counts(teamRows.filter((r) => r.team_name === name)) }))
            .sort((a, b) => b.detachments - a.detachments || b.insertions - a.insertions || a.name.localeCompare(b.name)),
        }
      : {}),
  };
}

// Usage totals without the library file. Null unless all three asset types were collected.
function buildFigmaTotals(rows: FigmaTotalsRow[]) {
  const outside = (type: FigmaTotalsRow["asset_type"]) => {
    const row = rows.find((r) => r.asset_type === type);
    return row ? row.usages_all_files - row.usages_library_file : null;
  };
  const [component_instances, style_uses, variable_uses] = [outside("component"), outside("style"), outside("variable")];
  if (component_instances === null || style_uses === null || variable_uses === null) return null;
  return { excludes: "library_file" as const, component_instances, style_uses, variable_uses };
}

function buildFigma(figmaRun: RunRow | null, usage: FigmaUsageRow[], actions: FigmaActionRow[], totals: FigmaTotalsRow[], teamActions: FigmaTeamActionRow[]) {
  if (!figmaRun) return null;
  const assets = (type: FigmaUsageRow["asset_type"]) =>
    usage
      .filter((u) => u.asset_type === type)
      .map((u) => ({ key: u.asset_key, name: u.asset_name, group: u.asset_group, usages: u.usages, teams_using: u.teams_using, files_using: u.files_using }))
      .sort((a, b) => b.usages - a.usages || a.name.localeCompare(b.name));
  return {
    run: run(figmaRun),
    components: assets("component"),
    styles: assets("style"),
    variables: assets("variable"),
    totals: buildFigmaTotals(totals),
    component_actions: buildComponentActions(actions, teamActions),
  };
}

export function buildSnapshot(input: SnapshotInput) {
  return {
    schema_version: "1.3" as const,
    generated_at: input.generatedAt,
    web: buildWeb(input.webRuns, input.webResults),
    figma: buildFigma(input.figmaRun, input.figmaUsage, input.figmaActions, input.figmaTotals, input.figmaTeamActions ?? []),
  };
}
