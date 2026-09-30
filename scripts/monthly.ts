// The monthly routine: crawl from this machine, then build and upload the dashboard in GitHub Actions.
//
//   npm run monthly               crawl all sites, then build
//   npm run monthly -- --resume   finish an interrupted crawl, then build
//
// Run it from a work network. Many sites block cloud data centres, which is why the
// crawl runs here and not in Actions. Needs the GitHub CLI (gh), signed in.
import { execFileSync, spawnSync } from "node:child_process";
import { loadEnv, requireEnv } from "./env.ts";
import { serviceClient } from "./supabase.ts";

const REPO = "qld-gov-au/qgds-metrics";
const WORKFLOW = "build-dashboard.yml";
const refIndex = process.argv.indexOf("--ref");
// --ref runs a branch's version of the workflow, for testing changes to it.
const ref = refIndex > -1 ? process.argv[refIndex + 1] : "main";

const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const stop = (message: string): never => {
  console.error(`\n${message}`);
  process.exit(1);
};

// 1. Check everything needed before spending time on a crawl.
loadEnv();
requireEnv("SUPABASE_URL");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");
try {
  gh(["auth", "status"]);
} catch {
  stop("The GitHub CLI is not installed or not signed in. Install it from https://cli.github.com, run `gh auth login`, then try again.");
}
try {
  gh(["workflow", "view", WORKFLOW, "--repo", REPO]);
} catch {
  stop(`Could not find the Build dashboard workflow in ${REPO}. Check you have access to the repository.`);
}

// 2. Crawl.
const resume = process.argv.includes("--resume");
console.log(resume
  ? "Step 1 of 2: finishing the interrupted crawl.\n"
  : "Step 1 of 2: crawling all active sites. This takes about 12 seconds per site. Progress is shown every 25 sites.\n");
const crawl = spawnSync(process.execPath, ["crawler/src/crawl.ts", ...(resume ? ["--resume"] : [])], { stdio: "inherit" });
if (crawl.status !== 0) {
  stop("The crawl did not succeed, so no build was started. Nothing on the dashboard has changed.\nSites already checked are saved. Run npm run monthly -- --resume to finish the crawl and build.");
}

// 3. Start the build and wait for it.
console.log("\nStep 2 of 2: building the dashboard in GitHub Actions.");
const startedAt = Date.now();
gh(["workflow", "run", WORKFLOW, "--repo", REPO, "--ref", ref]);

interface Run { databaseId: number; createdAt: string; status: string; conclusion: string; url: string }
let run: Run | undefined;
for (let attempt = 0; attempt < 12 && !run; attempt++) {
  await sleep(5_000);
  const runs: Run[] = JSON.parse(gh(["run", "list", "--repo", REPO, "--workflow", WORKFLOW, "--event", "workflow_dispatch", "--limit", "5", "--json", "databaseId,createdAt,status,conclusion,url"]));
  run = runs.find((r) => Date.parse(r.createdAt) >= startedAt - 10_000);
}
if (!run) stop("The build was requested but did not appear in GitHub Actions within a minute. Check the Actions tab.");
console.log(`Build started: ${run!.url}`);

const deadline = Date.now() + 15 * 60_000;
while (run!.status !== "completed") {
  if (Date.now() > deadline) stop(`The build is taking longer than 15 minutes. Check it here: ${run!.url}`);
  await sleep(10_000);
  run = JSON.parse(gh(["run", "view", String(run!.databaseId), "--repo", REPO, "--json", "databaseId,createdAt,status,conclusion,url"]));
}
if (run!.conclusion !== "success") stop(`The build did not succeed (${run!.conclusion}). The crawl is saved, so you only need to rerun the build: ${run!.url}`);

// 4. Say where the new build is.
const { data: builds } = await serviceClient().storage.from("metrics-data").list("builds", { sortBy: { column: "name", order: "desc" }, limit: 1 });
const latest = builds?.[0]?.name;
console.log(
  latest
    ? `\nDone. The new dashboard is in Supabase Storage at metrics-data/builds/${latest}/qgds-metrics-dashboard.zip`
    : "\nDone. The build finished, but its file could not be listed. Check metrics-data/builds in Supabase Storage.",
);
