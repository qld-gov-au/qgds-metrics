# Data contract

This folder defines the data shared by every track. Change it only after the change has been discussed and agreed. If code and contract disagree, fix the code.

| File | Purpose | Written by | Read by |
| --- | --- | --- | --- |
| `schema.sql` | Supabase tables | Crawler, Figma script | Export script |
| `snapshot.schema.json` | Exported snapshot JSON | Export script | Dashboard |
| `examples/snapshot.example.json` | Valid example with placeholder data | | Tests, dashboard development |

Examples use placeholders only, such as `example-agency` and `https://site-a.example`. Never add real agency names, site URLs or results to this folder.

## Tables

- **`runs`**: one row per collector run. `source` is `web` or `figma`. A run is finished when `status` is `succeeded` and `finished_at` is set. Failed and running runs are never exported.
- **`sites`**: the sites to crawl, with an optional organisation name.
- **`site_results`**: one row per site per web run.
- **`figma_usage`**: one row per QGDS library component, style or variable per Figma run.
- **`figma_component_actions`**: weekly insertions and detachments for each QGDS library component per Figma run.

Row level security is on with no policies, so only the service role can access the tables.

## Site result rules

| `status` | Meaning | `failure_type` | `uses_qgds` | `codebases` |
| --- | --- | --- | --- | --- |
| `ok` | Site reached and checked | null | true or false | zero or more |
| `failed` | Site could not be checked | set | null | empty |
| `skipped` | Site deliberately not checked, for example robots.txt | set | null | empty |

- `codebases` values are `bootstrap`, `web_components` and `qh_vanilla`. A site can use more than one.
- `uses_qgds` true with empty `codebases` means QGDS was detected but the codebase is unclear.
- `signals` records which detection rules matched. It stays in the database for auditing and is not exported.
- No page content, cookies, form data or personal information is stored.

## Snapshot

The export script writes one snapshot built from the latest succeeded run of each source.

- `web` or `figma` is `null` when no run of that source has succeeded. The dashboard shows a clear message in that case.
- Totals are computed by the export script so the dashboard never recalculates them.
  - `sites_scanned` counts every site attempted. Always shown on the dashboard with the run date.
  - `sites_checked` counts sites with status `ok`. It is the denominator for adoption percentages.
  - `sites_failed` counts sites with status `failed` or `skipped`. `sites_checked + sites_failed = sites_scanned`.
  - `by_codebase.unclear` counts sites using QGDS with no codebase identified.
- `sites` lists each site URL and organisation. The build is private, so this is allowed. Remove or aggregate it before any public publishing.
- `history` lists totals for every succeeded web run, oldest first, including the latest.
- Figma `group` is the component set name for components, the style type for styles, and the collection name for variables.

### Detach rate

- The Figma script collects the last 12 complete weeks. The window can be extended without changing the contract.
- `component_actions` covers every week the Figma run collected. `period_start` and `period_end` give the first and last week, and the dashboard always shows them.
- Detach rate is detachments divided by insertions for the same scope and period, rounded to 4 decimal places.
- Detach rate is `null` when there were no insertions. The dashboard shows "No insertions" rather than 0.
- Detach rate can be above 1, because a component inserted before the period can be detached during it. Do not cap it.
- `component_actions` is `null` when the run collected no action data.

## Versioning

`schema_version` is `1.0`. Adding an optional field is a minor change (`1.1`). Removing or renaming a field, or changing its meaning, is a major change (`2.0`) and needs the dashboard updated in the same change.
