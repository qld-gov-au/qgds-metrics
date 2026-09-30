-- Adds figma_usage_totals, from contract/schema.sql at schema_version 1.1.

-- Usage totals per asset type per Figma run, all files and the library file alone.
-- Per-component usage cannot be split by file, so the library file is excluded from
-- totals only. Stores counts, not file or team names.
create table figma_usage_totals (
  run_id               uuid not null references runs (id) on delete cascade,
  asset_type           text not null check (asset_type in ('component', 'style', 'variable')),
  usages_all_files     integer not null check (usages_all_files >= 0),
  usages_library_file  integer not null check (usages_library_file >= 0),
  primary key (run_id, asset_type),
  check (usages_library_file <= usages_all_files)
);

alter table figma_usage_totals enable row level security;
