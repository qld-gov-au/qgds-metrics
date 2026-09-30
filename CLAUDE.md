# QGDS metrics dashboard

## Purpose

This repository collects metrics about the Queensland Government Design System (QGDS) and produces a dashboard of the results. The first metrics cover adoption. Keep names general so the pipeline can carry other data and analytics later. It is a working concept. It must be accurate and must not look broken, but it does not need to be complete or polished.

The pipeline has four stages:

1. **Collect.** A Playwright crawler detects QGDS on public sites. A script pulls Figma Library Analytics for the QGDS library.
2. **Store.** Results are written to Supabase, one snapshot per run.
3. **Build.** A GitHub Action exports a JSON snapshot from Supabase, builds the static dashboard page, and uploads the build to private Supabase Storage.
4. **Summarise.** A later phase adds a plain-language summary generated with the Claude API.

## Scope

In scope: detecting whether a site uses QGDS and which codebase (Bootstrap, Web Components, Queensland Health Vanilla), and Figma component, style and variable usage.

Out of scope: detecting QGDS versions. Do not build version fingerprinting.

## Code public, data private

This repository is **public**. Anything committed, including anything in git history, is public permanently. GitHub Actions logs and artifacts on a public repository are also visible to anyone signed in to GitHub.

The code is public. The data is private. Keep them separate:

- **Never commit data.** `fixtures/`, `seeds.txt`, `.env` and any generated snapshot or build output must stay in `.gitignore`. A check script fails CI if any of them is tracked.
- **Private storage.** Fixtures, seed lists and dashboard builds live in the private Supabase Storage bucket `metrics-data`. Use `npm run data:pull` before working and `npm run data:push` after changing fixtures.
- **No names in public places.** Never put agency names, team names, site URLs or results in code, tests, comments, commit messages, pull requests, issues, README examples or contract examples. Use obvious placeholders such as `example-agency` and `https://site-a.example`.
- **Quiet logs.** Scripts running in Actions log counts, durations and error types only, for example "Crawled 42 sites, 3 failures (2 timeouts, 1 DNS)". Write site-level detail to Supabase, never to the log.
- **No artifacts with data.** Do not use `actions/upload-artifact` for fixtures, snapshots or dashboard builds.
- **No GitHub Pages.** Do not enable Pages or add a deploy step unless explicitly instructed. Publishing waits for governance board approval.

## Previewing the dashboard

Preview locally with the latest data from Supabase:

```
npm run export
npm run dashboard:dev
```

To preview with placeholder data instead, run `npm run dashboard:build -- --snapshot contract/examples/snapshot.example.json`.

The Build dashboard workflow uploads `metrics-data/builds/<run-timestamp>/qgds-metrics-dashboard.zip` to Supabase Storage. Team members download it from the Supabase dashboard, unzip it and open `index.html`. It works without a server.

## Monthly routine

Once a month, from a work network, run:

```
npm run monthly
```

It crawls all active sites from this machine, then starts the Build dashboard workflow and waits for the new build. It needs the GitHub CLI (`gh`), signed in.

- **Crawls run locally, not in Actions.** Many sites return 403 to cloud data centres, including GitHub's runners. Do not add crawling back to the workflow unless the sites allow the crawler through. Never work around a block.
- **Blocked crawls are discarded.** If more than 25% of sites fail to load, the run is marked failed and never exported.
- **The workflow also runs on its own** at 3 am Brisbane time on the 2nd of each month, rebuilding from the latest data.
- **The dashboard flags stale data.** If the latest crawl is more than 35 days old, it shows a warning.

## Repository structure

```
contract/     Data contract: schema.sql, snapshot.schema.json, README.md
fixtures/     Real sample data, gitignored, synced with Supabase Storage
crawler/      Playwright crawler (Track A)
figma/        Figma Library Analytics script (Track B)
dashboard/    Static dashboard page (Track C)
db/           Supabase migrations, export and storage scripts (Track D)
scripts/      Shared scripts, including data sync and the no-data check
.github/      Actions workflows (Track D)
seeds.txt     Seed sites for testing detection rules, gitignored
```

When working on one track, only edit files in that track's directory unless told otherwise.

## The data contract

Everything in `contract/` is shared by all tracks. The contract is code, so it is committed, but its examples use placeholders only. Do not change it without stopping and explaining the change first. If code and contract disagree, fix the code, not the contract.

The dashboard reads only the exported JSON snapshot. It never calls Supabase directly.

## Technology

- Node.js (LTS) with TypeScript for the crawler, Figma script, export and storage scripts
- Playwright for crawling, because web components and computed styles only exist after rendering
- Chart.js for charts, loaded from cdnjs or bundled
- Supabase JS client for database and storage access, server side only
- Plain HTML, CSS and JS for the dashboard, styled with QGDS

## Security

- Read all secrets from environment variables. Locally, use `.env`. In Actions, use repository secrets.
- Never write a key, token or secret into code, fixtures, logs or build output.
- The Supabase service role key is for server-side scripts only.
- Strip any tokens or authorisation headers from saved raw responses.

## Crawler conduct

- Crawl only public pages. Never log in, submit forms or bypass access controls.
- Respect robots.txt.
- Identify the crawler with a clear user agent that includes the team contact address: `QGDS-metrics-crawler/0.1 (+qgdesignsystem@qld.gov.au)`. This shared inbox is the only contact address used. Never use a personal address.
- Limit to one request at a time per domain, with a delay between pages.
- Set sensible timeouts and record failures as results rather than crashing the run.
- Collect design system signals only. Do not store page content, form data, cookies or any personal information.

## Dashboard conventions

- Style the page with QGDS. Use QGDS web components and CSS custom properties rather than inventing styles.
- Meet WCAG 2.2 AA. Chart colours need 3:1 contrast against the background and adjacent colours, and no data may rely on colour alone. Pair colour with labels, patterns or direct values.
- Give every chart a text alternative, such as a caption and a visible or expandable data table.
- Handle empty, zero and missing values gracefully. A chart with no data shows a clear message, never a broken or blank canvas.
- Report crawl figures as "observed", and always show how many sites were scanned and when.

## Writing conventions

All user-facing text follows the Australian Government Style Manual:

- Australian spelling (colour, organisation, analyse). Token names keep US spelling, such as `color`.
- No em dashes or en dashes. Use full stops, commas or the word "to" for ranges.
- Active voice and plain language.
- Sentence case for headings.

## Working style

- Prefer small, working increments over large untested changes.
- Run what you build before saying it works.
- Run `git status` before every commit and confirm no data files are staged.
- When a decision is genuinely ambiguous, stop and ask rather than guessing.
