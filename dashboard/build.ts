// Builds the static dashboard into dist/dashboard. dist/ is gitignored.
//
//   npm run dashboard:build                                    uses dashboard/data/snapshot.json
//   npm run dashboard:build -- --snapshot contract/examples/snapshot.example.json
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const snapshotIndex = process.argv.indexOf("--snapshot");
const snapshot = snapshotIndex > -1 ? process.argv[snapshotIndex + 1] : "dashboard/data/snapshot.json";
const out = "dist/dashboard";

if (!existsSync(snapshot)) {
  console.error(`No snapshot at ${snapshot}. Run npm run export first, or pass --snapshot.`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "data"), { recursive: true });
cpSync("dashboard/src", out, { recursive: true });

// Vendor files come from node_modules, so versions are pinned by package-lock.json.
// The main entry is dist/assets/js/qgds-web-components.js, so assets are two levels up.
const qgds = join(dirname(require.resolve("@qld-gov-au/qgds-web-components")), "..");
cpSync(join(qgds, "css"), join(out, "vendor/qgds/css"), { recursive: true });
cpSync(join(qgds, "js"), join(out, "vendor/qgds/js"), { recursive: true, filter: (src) => !src.endsWith(".map") });
cpSync(join(dirname(require.resolve("chart.js")), "chart.umd.min.js"), join(out, "vendor/chart.umd.min.js"));
cpSync(snapshot, join(out, "data/snapshot.json"));

console.log(`Built dashboard in ${out}.`);
