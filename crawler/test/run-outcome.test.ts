import assert from "node:assert/strict";
import { test } from "node:test";
import { runOutcome } from "../src/run-outcome.ts";

test("a run with few failures succeeds", () => {
  assert.equal(runOutcome({ total: 13, failed: 3, writeErrors: 0 }).status, "succeeded");
  assert.equal(runOutcome({ total: 4, failed: 1, writeErrors: 0 }).status, "succeeded");
});

test("a run where more than a quarter of sites fail is marked failed", () => {
  const outcome = runOutcome({ total: 13, failed: 7, writeErrors: 0 });
  assert.equal(outcome.status, "failed");
  assert.match(outcome.reason ?? "", /7 of 13 sites failed to load/);
});

test("any write error fails the run", () => {
  assert.equal(runOutcome({ total: 13, failed: 0, writeErrors: 1 }).status, "failed");
});

test("an empty run does not divide by zero", () => {
  assert.equal(runOutcome({ total: 0, failed: 0, writeErrors: 0 }).status, "succeeded");
});
