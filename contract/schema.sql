-- QGDS metrics data contract: database schema.
-- Shared by all tracks. Do not change without agreement. See contract/README.md.
--
-- Row level security is enabled on every table with no policies, so only the
-- service role (server-side scripts) can read or write. The dashboard never
-- queries these tables. It reads the exported snapshot instead.

-- A run is one execution of a collector. Each run produces one snapshot of results.
create table runs (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (source in ('web', 'figma')),
  status       text not null default 'running'
                 check (status in ('running', 'succeeded', 'failed')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  -- Version of the collector code, for example a git commit SHA.
  collector_version text,
  -- Web runs: user agent sent. Figma runs: null.
  user_agent   text
);

create index runs_source_finished_idx on runs (source, finished_at desc);

-- Sites to crawl. Organisation is free text, for example 'example-agency'.
create table sites (
  id            uuid primary key default gen_random_uuid(),
  url           text not null unique,
  organisation  text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- One row per site per web run.
create table site_results (
  run_id        uuid not null references runs (id) on delete cascade,
  site_id       uuid not null references sites (id) on delete restrict,
  checked_at    timestamptz not null default now(),
  -- 'ok' means the site was reached and checked. Detection outcome is in uses_qgds.
  status        text not null check (status in ('ok', 'failed', 'skipped')),
  -- Set when status is 'failed' or 'skipped'.
  failure_type  text check (failure_type in (
                  'timeout', 'dns', 'tls', 'http_error', 'robots_disallowed', 'other')),
  http_status   integer,
  -- Set when status is 'ok', null otherwise.
  uses_qgds     boolean,
  -- Codebases detected. Empty when QGDS is detected but the codebase is unclear.
  codebases     text[] not null default '{}'
                  check (codebases <@ array['bootstrap', 'web_components', 'qh_vanilla']),
  -- Identifiers of the detection rules that matched, for auditing rules.
  signals       text[] not null default '{}',
  pages_checked integer not null default 0 check (pages_checked >= 0),
  duration_ms   integer check (duration_ms >= 0),
  primary key (run_id, site_id),
  check ((status = 'ok') = (failure_type is null)),
  check ((status = 'ok') = (uses_qgds is not null)),
  check (status = 'ok' or cardinality(codebases) = 0)
);

-- Figma Library Analytics usage, one row per asset per Figma run.
-- Covers components, styles and variables from the QGDS library.
create table figma_usage (
  run_id        uuid not null references runs (id) on delete cascade,
  asset_type    text not null check (asset_type in ('component', 'style', 'variable')),
  asset_key     text not null,
  asset_name    text not null,
  -- Component set name, style type (for example 'FILL'), or variable collection name.
  asset_group   text,
  usages        integer not null default 0 check (usages >= 0),
  teams_using   integer not null default 0 check (teams_using >= 0),
  files_using   integer not null default 0 check (files_using >= 0),
  primary key (run_id, asset_type, asset_key)
);

-- Figma Library Analytics component actions, one row per component per week per Figma run.
-- Detach rate is derived from these counts at export.
create table figma_component_actions (
  run_id          uuid not null references runs (id) on delete cascade,
  component_key   text not null,
  component_name  text not null,
  -- Component set name, if any.
  component_group text,
  -- Start of the week the actions fall in, as reported by Figma.
  week            date not null,
  insertions      integer not null default 0 check (insertions >= 0),
  detachments     integer not null default 0 check (detachments >= 0),
  primary key (run_id, component_key, week)
);

alter table runs          enable row level security;
alter table sites         enable row level security;
alter table site_results  enable row level security;
alter table figma_usage   enable row level security;
alter table figma_component_actions enable row level security;
