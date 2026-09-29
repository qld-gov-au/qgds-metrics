import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv, requireEnv } from "./env.ts";

// Service role client for server-side scripts only. Never use it in the dashboard.
export function serviceClient(): SupabaseClient {
  loadEnv();
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

// Supabase reports a missing table as PGRST205 (schema cache) or 42P01 (Postgres).
export function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}
