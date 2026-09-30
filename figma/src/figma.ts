// Figma Library Analytics helpers. Pure functions, no network, so they can be unit tested.

// Accepts a file key, a key followed by the file name ("KEY/Name"), or a full Figma URL.
export function parseFileKey(value: string): string | null {
  const trimmed = value.trim();
  const fromUrl = trimmed.match(/figma\.com\/(?:file|design)\/([A-Za-z0-9]{10,})/);
  if (fromUrl) return fromUrl[1];
  const fromPath = trimmed.match(/^([A-Za-z0-9]{10,})(?:[/?#].*)?$/);
  return fromPath ? fromPath[1] : null;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

// The last `weeks` complete weeks before `now`. Figma weeks start on Sunday (UTC).
export function weekWindow(now: Date, weeks = 12): { startDate: string; endDate: string; lastWeek: string } {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const currentWeekStart = new Date(today.getTime() - today.getUTCDay() * 86_400_000);
  const lastWeekStart = new Date(currentWeekStart.getTime() - 7 * 86_400_000);
  const firstWeekStart = new Date(currentWeekStart.getTime() - weeks * 7 * 86_400_000);
  const lastDay = new Date(currentWeekStart.getTime() - 86_400_000);
  return { startDate: day(firstWeekStart), endDate: day(lastDay), lastWeek: day(lastWeekStart) };
}

// Rows as the API returns them, grouped by component, style or variable.
export interface ComponentUsage { component_key: string; component_name: string; component_set_name?: string | null; usages: number; teams_using: number; files_using: number }
export interface StyleUsage { style_key: string; style_name: string; style_type?: string | null; usages: number; teams_using: number; files_using: number }
export interface VariableUsage { variable_key: string; variable_name: string; collection_name?: string | null; usages: number; teams_using: number; files_using: number }
export interface ComponentAction { component_key: string; component_name: string; component_set_name?: string | null; week: string; insertions: number; detachments: number }

const orNull = (v: string | null | undefined) => (v ? v : null);

// Maps API rows to figma_usage rows in contract/schema.sql.
export function usageRows(runId: string, components: ComponentUsage[], styles: StyleUsage[], variables: VariableUsage[]) {
  const counts = (r: { usages: number; teams_using: number; files_using: number }) => ({
    usages: r.usages ?? 0, teams_using: r.teams_using ?? 0, files_using: r.files_using ?? 0,
  });
  return [
    ...components.map((r) => ({ run_id: runId, asset_type: "component" as const, asset_key: r.component_key, asset_name: r.component_name, asset_group: orNull(r.component_set_name), ...counts(r) })),
    ...styles.map((r) => ({ run_id: runId, asset_type: "style" as const, asset_key: r.style_key, asset_name: r.style_name, asset_group: orNull(r.style_type), ...counts(r) })),
    ...variables.map((r) => ({ run_id: runId, asset_type: "variable" as const, asset_key: r.variable_key, asset_name: r.variable_name, asset_group: orNull(r.collection_name), ...counts(r) })),
  ];
}

// Maps API rows to figma_component_actions rows, keeping only complete weeks in the window.
export function actionRows(runId: string, actions: ComponentAction[], window: { startDate: string; lastWeek: string }) {
  return actions
    .filter((r) => r.week >= window.startDate && r.week <= window.lastWeek)
    .map((r) => ({
      run_id: runId,
      component_key: r.component_key,
      component_name: r.component_name,
      component_group: orNull(r.component_set_name),
      week: r.week,
      insertions: r.insertions ?? 0,
      detachments: r.detachments ?? 0,
    }));
}
