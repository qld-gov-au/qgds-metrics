// Zips dist/dashboard and uploads it to private storage as
// metrics-data/builds/<timestamp>/qgds-metrics-dashboard.zip.
//
//   npm run dashboard:upload
//
// Team members download the zip from the Supabase dashboard, unzip it and open
// index.html. Logs the storage path and size only.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { serviceClient } from "../scripts/supabase.ts";

const BUCKET = "metrics-data";
const buildDir = resolve("dist/dashboard");
const zipPath = resolve("dist/qgds-metrics-dashboard.zip");

if (!existsSync(join(buildDir, "index.html")) || !existsSync(join(buildDir, "data/snapshot.js"))) {
  console.error("No complete build in dist/dashboard. Run npm run export and npm run dashboard:build first.");
  process.exit(1);
}

// Folder name sorts by time and is safe in storage paths, for example 2026-09-29T12-00-00Z.
const timestamp = new Date().toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
const objectPath = `builds/${timestamp}/qgds-metrics-dashboard.zip`;

rmSync(zipPath, { force: true });
// The zip contains one dashboard folder, so unzipping never scatters files.
execFileSync("zip", ["-qr", zipPath, "dashboard"], { cwd: resolve("dist") });

const supabase = serviceClient();
const { data: bucket, error: bucketError } = await supabase.storage.getBucket(BUCKET);
if (bucketError || !bucket) {
  console.error(`Bucket ${BUCKET} is not available. Run npm run data:push once to create it.`);
  process.exit(1);
}
if (bucket.public) {
  console.error(`Bucket ${BUCKET} is public. It must be private. Nothing was uploaded.`);
  process.exit(1);
}

const { error } = await supabase.storage.from(BUCKET).upload(objectPath, readFileSync(zipPath), {
  contentType: "application/zip",
  upsert: false,
});
if (error) {
  console.error(`Upload failed: ${error.message}`);
  process.exit(1);
}
console.log(`Uploaded ${BUCKET}/${objectPath} (${Math.round(statSync(zipPath).size / 1024)} KB).`);
