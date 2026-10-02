-- Adds figma_team_actions, from contract/schema.sql at schema_version 1.3.

-- Figma Library Analytics component actions, one row per team per week per Figma run.
-- Figma cannot split actions by team and component together, so this sits beside
-- figma_component_actions. Team names are private data, like site names.
create table figma_team_actions (
  run_id       uuid not null references runs (id) on delete cascade,
  -- As Figma reports it, including "<Drafts>" for personal drafts.
  team_name    text not null,
  week         date not null,
  insertions   integer not null default 0 check (insertions >= 0),
  detachments  integer not null default 0 check (detachments >= 0),
  primary key (run_id, team_name, week)
);

alter table figma_team_actions enable row level security;
