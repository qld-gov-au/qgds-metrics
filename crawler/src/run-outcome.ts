import { MAX_FAILED_SHARE } from "./config.ts";

export interface RunTally {
  total: number;
  failed: number;
  writeErrors: number;
}

// Decides whether a finished crawl counts. Skipped sites (robots.txt) are expected
// and do not count as failures.
export function runOutcome(t: RunTally): { status: "succeeded" | "failed"; reason: string | null } {
  if (t.writeErrors > 0) {
    return { status: "failed", reason: `${t.writeErrors} result(s) could not be saved.` };
  }
  if (t.total > 0 && t.failed / t.total > MAX_FAILED_SHARE) {
    return {
      status: "failed",
      reason:
        `${t.failed} of ${t.total} sites failed to load, more than ${MAX_FAILED_SHARE * 100}%. ` +
        "This usually means the network is being blocked. The run will not appear on the dashboard.",
    };
  }
  return { status: "succeeded", reason: null };
}
