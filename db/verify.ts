// Checks the live database matches the contract schema, and that every table has
// row level security on with no policies, so only the service role has access.
//
//   npm run db:verify
//
// Needs SUPABASE_DB_URL. Prints schema names only, never data or connection details.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { loadEnv, requireEnv } from "../scripts/env.ts";
import { describeSchema, diffSchemas } from "./describe-schema.ts";

loadEnv();
const contractSql = readFileSync(new URL("../contract/schema.sql", import.meta.url), "utf8");

const local = new PGlite();
await local.exec(contractSql);
const expected = await describeSchema(async (text) => (await local.query<Record<string, unknown>>(text)).rows);
await local.close();

const sql = postgres(requireEnv("SUPABASE_DB_URL"), { ssl: "require", max: 1, connect_timeout: 10, onnotice: () => {} });
let actual;
try {
  actual = await describeSchema(async (text) => [...(await sql.unsafe(text))]);
} catch (err) {
  console.error(`Could not read the live schema: ${(err as { code?: string }).code ?? (err as Error).name}`);
  process.exit(1);
} finally {
  await sql.end({ timeout: 2 });
}

const problems = diffSchemas(expected, actual, "live");
const tables = actual.rowLevelSecurity.length;
const withoutRls = actual.rowLevelSecurity.filter((t) => t.enabled !== true).map((t) => t.table_name);
if (withoutRls.length > 0) problems.push(`Row level security is off for: ${withoutRls.join(", ")}`);
if (actual.policies.length > 0) problems.push(`${actual.policies.length} policy(ies) grant access beyond the service role.`);

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  console.error(`Live database does not match the contract: ${problems.length} difference(s).`);
  process.exit(1);
}
console.log(`Live database matches the contract. ${tables} tables, row level security on for all, no policies.`);
