// Builds the static dashboard into dist/dashboard. dist/ is gitignored.
// The build opens directly from a folder (file://), so it uses classic scripts only:
// QGDS is bundled into one file and the snapshot is written as a script.
//
//   npm run dashboard:build                                    uses dashboard/data/snapshot.json
//   npm run dashboard:build -- --snapshot contract/examples/snapshot.example.json
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { build } from "esbuild";

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
await build({
  entryPoints: [require.resolve("@qld-gov-au/qgds-web-components")],
  bundle: true,
  format: "iife",
  minify: true,
  legalComments: "none",
  logLevel: "warning",
  outfile: join(out, "vendor/qgds/qgds-web-components.js"),
});
cpSync(join(dirname(require.resolve("chart.js")), "chart.umd.min.js"), join(out, "vendor/chart.umd.min.js"));
// JSON is valid JavaScript, so the snapshot is assigned as a literal after checking it parses.
const snapshotJson = JSON.stringify(JSON.parse(readFileSync(snapshot, "utf8")));
writeFileSync(join(out, "data/snapshot.js"), `window.QGDS_METRICS_SNAPSHOT = ${snapshotJson};\n`);

console.log(`Built dashboard in ${out}.`);
