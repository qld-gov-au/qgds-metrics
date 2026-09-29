// Fails if any data file is tracked by git, or if .gitignore stops covering one.
// In CI, logs counts only. File paths can contain names, so they print locally only.
import { execFileSync } from "node:child_process";
import { isCI } from "./env.ts";

// Each rule has a test for tracked paths and a sample path that .gitignore must ignore.
const rules = [
  { label: ".env files", sample: ".env", test: (p: string) => /(^|\/)\.env(\..+)?$/.test(p) && !p.endsWith(".env.example") },
  { label: "seeds.txt", sample: "seeds.txt", test: (p: string) => /(^|\/)seeds\.txt$/.test(p) },
  { label: "fixtures/", sample: "fixtures/sample.json", test: (p: string) => p.startsWith("fixtures/") },
  { label: "snapshots/", sample: "snapshots/sample.json", test: (p: string) => p.startsWith("snapshots/") },
  { label: "dashboard/data/", sample: "dashboard/data/sample.json", test: (p: string) => p.startsWith("dashboard/data/") },
  { label: "*.snapshot.json", sample: "sample.snapshot.json", test: (p: string) => p.endsWith(".snapshot.json") },
  { label: "build output", sample: "dist/sample.html", test: (p: string) => /^(dist|build)\//.test(p) },
];

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" });
}

function isIgnored(path: string): boolean {
  try {
    git(["check-ignore", "-q", "--no-index", path]);
    return true;
  } catch {
    return false;
  }
}

const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
let problems = 0;

for (const rule of rules) {
  const matches = tracked.filter(rule.test);
  if (matches.length > 0) {
    problems++;
    console.error(`Tracked data: ${matches.length} file(s) match ${rule.label}.`);
    if (!isCI) for (const m of matches) console.error(`  ${m}`);
  }
  if (!isIgnored(rule.sample)) {
    problems++;
    console.error(`Not ignored: .gitignore does not cover ${rule.label}.`);
  }
}

if (problems > 0) {
  console.error(`No-data check failed with ${problems} problem(s). Remove data with "git rm --cached" and fix .gitignore.`);
  process.exit(1);
}
console.log(`No-data check passed. ${tracked.length} tracked files, ${rules.length} rules.`);
