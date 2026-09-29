// Syncs private data between this checkout and the Supabase Storage bucket.
//
//   npm run data:pull            download files, keeping any local file that differs
//   npm run data:pull -- --force download files, replacing local files that differ
//   npm run data:push            upload local files, replacing remote copies
//
// Neither direction deletes files. Logs counts only, never file names.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "./supabase.ts";

const BUCKET = "metrics-data";
// Local paths synced with the bucket. Remote paths are the same.
const SYNCED_FILES = ["seeds.txt"];
const SYNCED_DIRS = ["fixtures"];

function localFiles(): string[] {
  const files = SYNCED_FILES.filter((f) => existsSync(f));
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".")) continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  for (const dir of SYNCED_DIRS) if (existsSync(dir)) walk(dir);
  return files;
}

async function remoteFiles(supabase: SupabaseClient): Promise<string[]> {
  const files: string[] = [];
  const pageSize = 1000;
  const walk = async (prefix: string): Promise<void> => {
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: pageSize, offset });
      if (error) throw new Error(`List failed: ${error.message}`);
      for (const entry of data) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        // Folders have no id.
        if (entry.id === null) await walk(path);
        else files.push(path);
      }
      if (data.length < pageSize) return;
    }
  };
  for (const dir of SYNCED_DIRS) await walk(dir);
  const root = await supabase.storage.from(BUCKET).list("", { limit: pageSize });
  if (root.error) throw new Error(`List failed: ${root.error.message}`);
  files.push(...root.data.filter((e) => SYNCED_FILES.includes(e.name)).map((e) => e.name));
  return files;
}

async function ensureBucket(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.storage.getBucket(BUCKET);
  if (data) {
    if (data.public) throw new Error(`Bucket ${BUCKET} is public. It must be private. Stopping.`);
    return true;
  }
  if (error && !/not found/i.test(error.message)) throw new Error(`Bucket check failed: ${error.message}`);
  return false;
}

async function pull(supabase: SupabaseClient, force: boolean): Promise<void> {
  if (!(await ensureBucket(supabase))) {
    console.log(`Bucket ${BUCKET} does not exist yet. Nothing to pull. Run data:push to create it.`);
    return;
  }
  let written = 0, unchanged = 0, kept = 0;
  for (const path of await remoteFiles(supabase)) {
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error) throw new Error(`Download failed: ${error.message}`);
    const remote = Buffer.from(await data.arrayBuffer());
    if (existsSync(path)) {
      const local = readFileSync(path);
      if (local.equals(remote)) { unchanged++; continue; }
      if (!force) { kept++; continue; }
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, remote);
    written++;
  }
  console.log(`Pulled ${written} file(s), ${unchanged} unchanged, ${kept} kept because the local copy differs.`);
  if (kept > 0) console.log(`Push your local changes, or rerun with "npm run data:pull -- --force" to replace them.`);
}

async function push(supabase: SupabaseClient): Promise<void> {
  if (!(await ensureBucket(supabase))) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
    if (error) throw new Error(`Bucket create failed: ${error.message}`);
    console.log(`Created private bucket ${BUCKET}.`);
  }
  const files = localFiles();
  for (const path of files) {
    const { error } = await supabase.storage.from(BUCKET).upload(path, readFileSync(path), { upsert: true });
    if (error) throw new Error(`Upload failed: ${error.message}`);
  }
  console.log(`Pushed ${files.length} file(s).`);
}

const [command, ...flags] = process.argv.slice(2);
if (command !== "pull" && command !== "push") {
  console.error("Usage: node scripts/data-sync.ts pull [--force] | push");
  process.exit(1);
}

const supabase = serviceClient();

try {
  if (command === "pull") await pull(supabase, flags.includes("--force"));
  else await push(supabase);
} catch (err) {
  console.error(`data:${command} failed. ${(err as Error).message}`);
  process.exit(1);
}
