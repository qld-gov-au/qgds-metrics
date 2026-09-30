// Applies new files in db/migrations to the live database, in name order, and records
// each one so it never runs twice.
//
//   npm run db:migrate            apply pending migrations
//   npm run db:migrate -- --list  show applied and pending migrations only
//
// Needs SUPABASE_DB_URL. Records are kept in the metrics_admin schema, which the
// Supabase API does not expose. Prints migration file names only.
import { readdirSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { loadEnv, requireEnv } from "../scripts/env.ts";

// Applied by hand in the Supabase SQL editor before this command existed.
const APPLIED_BEFORE_TRACKING = "20260929000000_initial_schema.sql";

loadEnv();
const listOnly = process.argv.includes("--list");
const dir = new URL("./migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const sql = postgres(requireEnv("SUPABASE_DB_URL"), { ssl: "require", max: 1, connect_timeout: 10, onnotice: () => {} });
try {
  await sql`create schema if not exists metrics_admin`;
  await sql`create table if not exists metrics_admin.applied_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;

  // If the initial tables exist but nothing is recorded, record the hand-applied migration.
  const [{ count }] = await sql`select count(*)::int as count from metrics_admin.applied_migrations`;
  const [{ exists }] = await sql`select to_regclass('public.runs') is not null as exists`;
  if (count === 0 && exists) {
    await sql`insert into metrics_admin.applied_migrations (name) values (${APPLIED_BEFORE_TRACKING})`;
    console.log(`Recorded ${APPLIED_BEFORE_TRACKING} as applied before tracking began.`);
  }

  const applied = new Set((await sql`select name from metrics_admin.applied_migrations`).map((r) => r.name as string));
  const pending = files.filter((f) => !applied.has(f));
  if (listOnly) {
    for (const f of files) console.log(`${applied.has(f) ? "applied " : "pending "} ${f}`);
    process.exit(0);
  }
  if (pending.length === 0) {
    console.log(`No pending migrations. ${applied.size} applied.`);
  }

  // Each migration and its record commit together, so a failure leaves nothing half applied.
  for (const file of pending) {
    const text = readFileSync(new URL(file, dir), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into metrics_admin.applied_migrations (name) values (${file})`;
    });
    console.log(`Applied ${file}.`);
  }
} catch (err) {
  console.error(`Migration failed: ${(err as { code?: string }).code ?? (err as Error).name}. ${(err as Error).message.split("\n")[0]}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}
