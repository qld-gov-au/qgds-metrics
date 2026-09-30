-- Adds department, brand_tier and kind to sites, from contract/schema.sql at schema_version 1.2.

alter table sites
  add column department text,
  add column brand_tier text check (brand_tier in ('master_brand', 'sub_brand', 'co_brand', 'endorsed', 'stand_alone')),
  add column kind       text not null default 'website' check (kind in ('website', 'app'));
