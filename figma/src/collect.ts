// Collects Figma Library Analytics for the QGDS library and stores one Figma run in Supabase.
//
//   npm run figma
//
// Needs FIGMA_TOKEN (with library_analytics:read), FIGMA_LIBRARY_FILE_KEY (the file key,
// the key with the file name after it, or the library's Figma URL) and
// FIGMA_LIBRARY_FILE_NAME (the library file's exact name, used to leave it out of totals).
// Logs counts only. Never logs the token or raw responses.
import { loadEnv, requireEnv } from "../../scripts/env.ts";
import { serviceClient } from "../../scripts/supabase.ts";
import {
  actionRows, libraryTotals, parseFileKey, teamActionRows, usageRows, weekWindow,
  type ComponentAction, type ComponentUsage, type FileUsage, type StyleUsage, type TeamAction, type VariableUsage,
} from "./figma.ts";

loadEnv();
const supabase = serviceClient();
const token = requireEnv("FIGMA_TOKEN");
const fileKey = parseFileKey(requireEnv("FIGMA_LIBRARY_FILE_KEY"));
const libraryFileName = requireEnv("FIGMA_LIBRARY_FILE_NAME").trim();
if (!fileKey) {
  console.error("FIGMA_LIBRARY_FILE_KEY does not contain a Figma file key. Use the key or the library's Figma URL.");
  process.exit(1);
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGES = 100;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Fetches every page of one analytics endpoint. Retries rate limits and server errors.
async function fetchAll<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({ ...params, ...(cursor ? { cursor } : {}) });
    const url = `https://api.figma.com/v1/analytics/libraries/${fileKey}/${path}?${query}`;
    let response: Response | undefined;
    for (let attempt = 1; attempt <= 4; attempt++) {
      response = await fetch(url, { headers: { "X-Figma-Token": token }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (response.status !== 429 && response.status < 500) break;
      const wait = Number(response.headers.get("retry-after")) * 1000 || attempt * 5_000;
      await sleep(Math.min(wait, 60_000));
    }
    if (!response!.ok) {
      const hint = response!.status === 403 ? " Check the token has library_analytics:read." : response!.status === 404 ? " Check FIGMA_LIBRARY_FILE_KEY is the published library." : "";
      throw new Error(`Figma returned ${response!.status} for ${path}.${hint}`);
    }
    const body = (await response!.json()) as { rows: T[]; next_page?: boolean; cursor?: string };
    rows.push(...body.rows);
    if (!body.next_page || !body.cursor) return rows;
    cursor = body.cursor;
  }
  throw new Error(`${path} had more than ${MAX_PAGES} pages. Stopping.`);
}

async function insertInBatches(table: string, rows: object[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + 500));
    if (error) throw new Error(`Saving to ${table} failed: ${error.code}`);
  }
}

const started = Date.now();
const window = weekWindow(new Date());

const { data: run, error: runError } = await supabase
  .from("runs")
  .insert({ source: "figma", collector_version: process.env.GITHUB_SHA ?? null })
  .select("id")
  .single();
if (runError) {
  console.error(`Could not create run: ${runError.code}`);
  process.exit(1);
}

try {
  const [components, styles, variables, actions, componentFiles, styleFiles, variableFiles, teamActions] = await Promise.all([
    fetchAll<ComponentUsage>("component/usages", { group_by: "component" }),
    fetchAll<StyleUsage>("style/usages", { group_by: "style" }),
    fetchAll<VariableUsage>("variable/usages", { group_by: "variable" }),
    fetchAll<ComponentAction>("component/actions", { group_by: "component", start_date: window.startDate, end_date: window.endDate }),
    fetchAll<FileUsage>("component/usages", { group_by: "file" }),
    fetchAll<FileUsage>("style/usages", { group_by: "file" }),
    fetchAll<FileUsage>("variable/usages", { group_by: "file" }),
    fetchAll<TeamAction>("component/actions", { group_by: "team", start_date: window.startDate, end_date: window.endDate }),
  ]);
  const usage = usageRows(run.id, components, styles, variables);
  const weekly = actionRows(run.id, actions, window);
  // Totals with the library file separated. Only counts are stored, not file or team names.
  const totals = [
    { run_id: run.id, asset_type: "component", ...libraryTotals(componentFiles, libraryFileName, true) },
    { run_id: run.id, asset_type: "style", ...libraryTotals(styleFiles, libraryFileName, false) },
    { run_id: run.id, asset_type: "variable", ...libraryTotals(variableFiles, libraryFileName, false) },
  ];
  await insertInBatches("figma_usage", usage);
  await insertInBatches("figma_component_actions", weekly);
  await insertInBatches("figma_usage_totals", totals);
  // Team names are stored, never logged.
  const teams = teamActionRows(run.id, teamActions, window);
  await insertInBatches("figma_team_actions", teams);

  const { error } = await supabase.from("runs").update({ status: "succeeded", finished_at: new Date().toISOString() }).eq("id", run.id);
  if (error) throw new Error(`Could not mark run succeeded: ${error.code}`);
  const weeks = new Set(weekly.map((r) => r.week)).size;
  console.log(
    `Collected Figma analytics in ${Math.round((Date.now() - started) / 1000)}s: ` +
      `${components.length} components, ${styles.length} styles, ${variables.length} variables, ` +
      `${weekly.length} weekly action rows over ${weeks} weeks (${window.startDate} to ${window.lastWeek}), ` +
      `${new Set(teams.map((t) => t.team_name)).size} teams. ` +
      `Library file excluded from totals: ${totals.map((t) => `${Math.round((100 * t.usages_library_file) / Math.max(1, t.usages_all_files))}% of ${t.asset_type} use`).join(", ")}.`,
  );
} catch (err) {
  await supabase.from("runs").update({ status: "failed", finished_at: new Date().toISOString() }).eq("id", run.id);
  console.error(`Figma collection failed. ${(err as Error).message} Run marked failed.`);
  process.exit(1);
}
