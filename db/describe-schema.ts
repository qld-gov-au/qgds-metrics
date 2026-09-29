// Describes the public schema as comparable JSON: columns, constraints, indexes and
// row level security. Used to compare migrations, the contract and the live database.
// NOT NULL is compared through columns.is_nullable. Postgres 18 also lists it as a
// constraint (contype 'n') and Postgres 17 does not, so those rows are left out.

export type Query = (text: string) => Promise<Record<string, unknown>[]>;

const queries = {
  columns: `select table_name, column_name, data_type, is_nullable, column_default
            from information_schema.columns where table_schema = 'public' order by 1, 2`,
  constraints: `select c.relname as table_name, pg_get_constraintdef(k.oid) as definition
                from pg_constraint k join pg_class c on c.oid = k.conrelid
                join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and k.contype <> 'n' order by 1, 2`,
  indexes: `select tablename as table_name, indexdef as definition
            from pg_indexes where schemaname = 'public' order by 1, 2`,
  rowLevelSecurity: `select relname as table_name, relrowsecurity as enabled
                     from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and relkind = 'r' order by 1`,
  policies: `select tablename as table_name, policyname from pg_policies where schemaname = 'public' order by 1, 2`,
};

export type SchemaDescription = Record<keyof typeof queries, Record<string, unknown>[]>;

export async function describeSchema(query: Query): Promise<SchemaDescription> {
  const entries = await Promise.all(
    Object.entries(queries).map(async ([name, text]) => [name, await query(text)] as const),
  );
  return Object.fromEntries(entries) as SchemaDescription;
}

// Lists differences as short lines, such as "columns: only in live: sites.note".
export function diffSchemas(expected: SchemaDescription, actual: SchemaDescription, actualName: string): string[] {
  const differences: string[] = [];
  for (const name of Object.keys(expected) as (keyof SchemaDescription)[]) {
    const key = (row: Record<string, unknown>) => JSON.stringify(row);
    const want = new Set(expected[name].map(key));
    const have = new Set(actual[name].map(key));
    for (const row of have) if (!want.has(row)) differences.push(`${name}: only in ${actualName}: ${row}`);
    for (const row of want) if (!have.has(row)) differences.push(`${name}: missing from ${actualName}: ${row}`);
  }
  return differences;
}
