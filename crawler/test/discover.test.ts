import assert from "node:assert/strict";
import { test } from "node:test";
import { branchOf, classify, departmentsIn, parentOf, prefilter, type Visit } from "../src/discover/rules.ts";

// Placeholder hostnames only. qld.gov.au is the root domain the rules work under.
const known = { listed: new Set(["example.qld.gov.au", "app.example.qld.gov.au"]), excluded: new Set(["rejected.qld.gov.au", "oldbranch"]) };
const visit = (v: Partial<Visit>): Visit => ({ status: 200, finalUrl: "https://new.example.qld.gov.au/", title: "Example service", textLength: 2000, hasPassword: false, ...v });

test("branchOf returns the label before the root domain", () => {
  assert.equal(branchOf("www.example.qld.gov.au"), "example");
  assert.equal(branchOf("a.b.example.qld.gov.au"), "example");
});

test("prefilter drops listed, rejected, infrastructure, non-production and council hostnames", () => {
  const reason = (h: string) => { const r = prefilter(h, known); return r.keep ? "keep" : r.reason; };
  assert.equal(reason("www.example.qld.gov.au"), "Already on the site list");
  assert.equal(reason("rejected.qld.gov.au"), "Rejected in an earlier review");
  assert.equal(reason("anything.oldbranch.qld.gov.au"), "Rejected in an earlier review");
  assert.equal(reason("mail.example.qld.gov.au"), "Infrastructure, not a website");
  assert.equal(reason("api.new.qld.gov.au"), "Infrastructure, not a website");
  assert.equal(reason("uat.new.qld.gov.au"), "Test or non-production copy");
  assert.equal(reason("formsdev.new.qld.gov.au"), "Test or non-production copy");
  assert.equal(reason("www.examplerc.qld.gov.au"), "Likely a council");
  assert.equal(reason("grants.new.qld.gov.au"), "keep");
});

test("prefilter does not mistake ordinary words for test markers", () => {
  assert.equal(prefilter("exampledevelopment.qld.gov.au", known).keep, true);
  assert.equal(prefilter("testimonials.new.qld.gov.au", known).keep, true);
  assert.equal(prefilter("stagecraft.new.qld.gov.au", known).keep, true);
  assert.equal(prefilter("stagingportal.new.qld.gov.au", known).keep, false);
  assert.equal(prefilter("shoptest.new.qld.gov.au", known).keep, false);
});

test("classify sorts visits into outcomes", () => {
  const out = (v: Partial<Visit>, host = "new.example.qld.gov.au") => classify(visit(v), host, known).outcome;
  assert.equal(out({}), "public_site");
  assert.equal(out({ status: 404 }), "not_live");
  assert.equal(out({ error: "DNS not found", finalUrl: null }), "not_live");
  assert.equal(out({ finalUrl: "https://example.qld.gov.au/page" }), "redirects_to_listed");
  assert.equal(out({ finalUrl: "https://www.examplerc.qld.gov.au/" }), "council");
  assert.equal(out({ finalUrl: "https://login.microsoftonline.com/x/oauth2/authorize" }), "sign_in");
  assert.equal(out({ hasPassword: true }), "sign_in");
  assert.equal(out({ finalUrl: "https://gw.example.qld.gov.au/logon/LogonPoint/index.html" }), "staff_or_test");
  assert.equal(out({ title: "Maintenance mode" }), "placeholder");
  assert.equal(out({ textLength: 20 }), "placeholder");
});

test("parentOf finds the closest listed site", () => {
  const listed = [{ host: "example.qld.gov.au", path: "" }, { host: "app.example.qld.gov.au", path: "" }];
  assert.equal(parentOf("new.app.example.qld.gov.au", listed)?.host, "app.example.qld.gov.au");
  assert.equal(parentOf("other.example.qld.gov.au", listed)?.host, "example.qld.gov.au");
  assert.equal(parentOf("unrelated.qld.gov.au", listed), null);
});

test("departmentsIn matches names from the list, ignoring case and spacing", () => {
  assert.deepEqual(departmentsIn("© The State of Queensland (Example   Department) 2026", ["Example Department", "Other Department"]), ["Example Department"]);
});
