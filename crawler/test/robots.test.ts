import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "../src/robots.ts";

const robotsUrl = "https://site-a.example/robots.txt";

test("robots rules for all crawlers apply to this crawler", () => {
  const text = "User-agent: *\nDisallow: /private/\n";
  assert.equal(decide(robotsUrl, text, "https://site-a.example/"), "allowed");
  assert.equal(decide(robotsUrl, text, "https://site-a.example/private/page"), "disallowed");
});

test("wildcard rules do not block the home page", () => {
  const text = "User-agent: *\nDisallow: /*/_resources/aside*\nDisallow: /dev/*\n";
  assert.equal(decide(robotsUrl, text, "https://site-a.example/"), "allowed");
});

test("rules naming this crawler apply", () => {
  const text = "User-agent: QGDS-metrics-crawler\nDisallow: /\n\nUser-agent: *\nDisallow:\n";
  assert.equal(decide(robotsUrl, text, "https://site-a.example/"), "disallowed");
});

test("an HTML page served as robots.txt allows everything", () => {
  assert.equal(decide(robotsUrl, "<!doctype html><html><body>Not found</body></html>", "https://site-a.example/"), "allowed");
});
