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
- **`sites`**: the sites to crawl. `organisation` is the agency that owns and runs the site. `department` is its accountable department, spelt as on the Queensland Government ministers and departments page. `brand_tier` is its tier in the QGDS brand architecture. `kind` is `website` or `app`.
- **`site_results`**: one row per site per web run.
- **`figma_usage`**: one row per QGDS library component, style or variable per Figma run.
- **`figma_component_actions`**: weekly insertions and detachments for each QGDS library component per Figma run.
- **`figma_usage_totals`**: usage totals per asset type per Figma run, for all files and for the library file alone.
- **`figma_team_actions`**: weekly insertions and detachments for each team per Figma run. Team names are private data, like site names.

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
- `breakdowns` groups the latest run's totals by brand tier and by department, using each site's current values. A `null` value groups sites without one. Percentages use `sites_checked`, as for the headline figures.

### Brand tiers

The tiers follow the QGDS brand architecture, which is organised by public perception rather than organisational structure. A statutory body run within a department, for example, has `organisation` set to the body (`example-agency`), `department` set to its accountable department (`Example department`) and `brand_tier` set to `co_brand`.

| `brand_tier` | Covers |
| --- | --- |
| `master_brand` | Whole of government sites, apps and tools |
| `sub_brand` | Departments and agencies, including divisions |
| `co_brand` | Most statutory bodies, and joint federal and state initiatives |
| `endorsed` | Programs, initiatives and approved campaigns |
| `stand_alone` | Independent statutory bodies, such as tribunals, commissions and government corporations |
- Figma `group` is the component set name for components, the style type for styles, and the collection name for variables.

### Figma totals and the library file

- Instances inside the QGDS library file are not use of the library, so `figma.totals` leaves the library file out. Use it for headline figures.
- Figma cannot split per-component usage by file, so `components`, `styles` and `variables` still include the library file. Component instances also include nested instances, for example a base component inside a card. Rank components by insertions, not instances.
- Figma cannot split insertions and detachments by file either, so `component_actions` and the detach rate include actions in the library file.
- `figma.totals` is optional. It is null for runs collected before 1.1.

### Detach rate

- The Figma script collects the last 12 complete weeks. The window can be extended without changing the contract.
- `component_actions` covers every week the Figma run collected. `period_start` and `period_end` give the first and last week, and the dashboard always shows them.
- Detach rate is detachments divided by insertions for the same scope and period, rounded to 4 decimal places.
- Detach rate is `null` when there were no insertions. The dashboard shows "No insertions" rather than 0.
- Detach rate can be above 1, because a component inserted before the period can be detached during it. Do not cap it.
- `component_actions` is `null` when the run collected no action data.
- `component_actions.by_team` sums each team's insertions and detachments over the period, most detachments first. Figma cannot split actions by team and component together, so read it beside `by_component`: detachments concentrated in one team suggest a project or practice, and detachments of one component spread across many teams suggest a component issue.

## Versioning

`schema_version` is `1.3`. Version 1.1 added the optional `figma.totals`. Version 1.2 added `department`, `brand_tier` and `kind` to each site, and the optional `web.breakdowns`. Version 1.3 added the optional `component_actions.by_team`. Adding an optional field is a minor change (`1.1`). Removing or renaming a field, or changing its meaning, is a major change (`2.0`) and needs the dashboard updated in the same change.
