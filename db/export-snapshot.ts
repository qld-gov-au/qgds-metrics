// Exports the snapshot the dashboard reads, from the latest succeeded runs in Supabase.
// Validates it against contract/snapshot.schema.json before writing.
//
//   npm run export                                 writes dashboard/data/snapshot.json
//   npm run export -- --out snapshots/x.json       writes elsewhere (keep it gitignored)
//
// Logs counts only.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable, serviceClient } from "../scripts/supabase.ts";
import { buildSnapshot, type FigmaActionRow, type FigmaTeamActionRow, type FigmaTotalsRow, type FigmaUsageRow, type RunRow, type SiteResultRow } from "./snapshot.ts";

const addFormats = addFormatsModule as unknown as typeof addFormatsModule.default;
const outIndex = process.argv.indexOf("--out");
const outPath = outIndex > -1 ? process.argv[outIndex + 1] : "dashboard/data/snapshot.json";

// Reads every row of a query, a page at a time.
async function all<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query(from, from + pageSize - 1);
    if (error) throw new Error(isMissingTable(error) ? "A table is missing. Apply db/migrations first." : `Query failed: ${error.code}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function succeededRuns(supabase: SupabaseClient, source: "web" | "figma"): Promise<RunRow[]> {
  return all<RunRow>((from, to) =>
    supabase.from("runs").select("id, started_at, finished_at").eq("source", source).eq("status", "succeeded")
      .not("finished_at", "is", null).order("finished_at").range(from, to),
  );
}

async function webResults(supabase: SupabaseClient, runIds: string[]): Promise<SiteResultRow[]> {
  if (runIds.length === 0) return [];
  type SiteColumns = Pick<SiteResultRow, "url" | "organisation" | "department" | "brand_tier" | "kind">;
  type Row = Omit<SiteResultRow, keyof SiteColumns> & { sites: SiteColumns };
  const rows = await all<Row>((from, to) =>
    supabase.from("site_results").select("run_id, status, failure_type, uses_qgds, codebases, sites(url, organisation, department, brand_tier, kind)")
      .in("run_id", runIds).order("run_id").order("site_id").range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { code?: string } | null }>,
  );
  return rows.map(({ sites, ...r }) => ({ ...r, ...sites }));
}

const supabase = serviceClient();
try {
  const webRuns = await succeededRuns(supabase, "web");
  const figmaRun = (await succeededRuns(supabase, "figma")).at(-1) ?? null;
  const [results, figmaUsage, figmaActions, figmaTotals, figmaTeamActions] = await Promise.all([
    webResults(supabase, webRuns.map((r) => r.id)),
    figmaRun
      ? all<FigmaUsageRow>((from, to) => supabase.from("figma_usage").select("asset_type, asset_key, asset_name, asset_group, usages, teams_using, files_using").eq("run_id", figmaRun.id).order("asset_key").range(from, to))
      : [],
    figmaRun
      ? all<FigmaActionRow>((from, to) => supabase.from("figma_component_actions").select("component_key, component_name, component_group, week, insertions, detachments").eq("run_id", figmaRun.id).order("component_key").order("week").range(from, to))
      : [],
    figmaRun
      ? all<FigmaTotalsRow>((from, to) => supabase.from("figma_usage_totals").select("asset_type, usages_all_files, usages_library_file").eq("run_id", figmaRun.id).order("asset_type").range(from, to))
      : [],
    figmaRun
      ? all<FigmaTeamActionRow>((from, to) => supabase.from("figma_team_actions").select("team_name, week, insertions, detachments").eq("run_id", figmaRun.id).order("team_name").order("week").range(from, to))
      : [],
  ]);

  const snapshot = buildSnapshot({ generatedAt: new Date().toISOString(), webRuns, webResults: results, figmaRun, figmaUsage, figmaActions, figmaTotals, figmaTeamActions });

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const schema = JSON.parse(readFileSync(new URL("../contract/snapshot.schema.json", import.meta.url), "utf8"));
  const validate = ajv.compile(schema);
  if (!validate(snapshot)) {
    // Paths and messages only. They never include data values.
    for (const e of validate.errors ?? []) console.error(`  ${e.instancePath || "/"} ${e.message}`);
    throw new Error("The snapshot does not match contract/snapshot.schema.json. Nothing was written.");
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(
    `Exported snapshot: ${webRuns.length} web run(s), ${snapshot.web?.sites.length ?? 0} site(s) in the latest, ` +
      `Figma ${figmaRun ? `${figmaUsage.length} asset(s), ${figmaActions.length} action row(s)` : "no runs"}.`,
  );
} catch (err) {
  console.error(`Export failed. ${(err as Error).message}`);
  process.exit(1);
}
