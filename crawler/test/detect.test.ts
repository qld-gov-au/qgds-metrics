import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyError } from "../src/check-site.ts";
import { countCss, detect, emptyCss, type PageSignals } from "../src/detect.ts";

const page = (overrides: Omit<Partial<PageSignals>, "css"> & { css?: Partial<PageSignals["css"]> } = {}): PageSignals => ({
  assetPaths: overrides.assetPaths ?? [],
  css: { ...emptyCss(), ...overrides.css },
  definedQgdsElements: overrides.definedQgdsElements ?? 0,
});

test("no signals means QGDS not detected", () => {
  assert.deepEqual(detect(page()), { usesQgds: false, codebases: [], signals: [] });
});

test("Bootstrap from the qld.bootstrap asset", () => {
  const d = detect(page({ assetPaths: ["site-a.example/assets/css/qld.bootstrap.css"] }));
  assert.deepEqual(d.codebases, ["bootstrap"]);
  assert.ok(d.signals.includes("asset:qld-bootstrap"));
});

test("Bootstrap from the minified script alone", () => {
  assert.deepEqual(detect(page({ assetPaths: ["site-a.example/js/qld.bootstrap.min.js"] })).codebases, ["bootstrap"]);
});

test("Bootstrap from the npm package path", () => {
  assert.deepEqual(detect(page({ assetPaths: ["cdn.example/npm/@qld-gov-au/qgds-bootstrap5/dist/main.css"] })).codebases, ["bootstrap"]);
});

test("Bootstrap custom properties need to pass the threshold", () => {
  assert.deepEqual(detect(page({ css: { qldCustomProperties: 999 } })).codebases, []);
  assert.deepEqual(detect(page({ css: { qldCustomProperties: 1000 } })).codebases, ["bootstrap"]);
});

test("Similar file names do not count as Bootstrap", () => {
  assert.equal(detect(page({ assetPaths: ["site-a.example/css/bootstrap.min.css", "site-a.example/css/qld.bootstrap-theme.css"] })).usesQgds, false);
});

test("Web Components from defined elements", () => {
  assert.deepEqual(detect(page({ definedQgdsElements: 1 })).codebases, ["web_components"]);
});

test("Web Components from the bundle asset", () => {
  assert.deepEqual(detect(page({ assetPaths: ["site-a.example/vendor/qgds-web-components.js"] })).codebases, ["web_components"]);
});

test("QH Vanilla from either BEM prefix above the threshold", () => {
  assert.deepEqual(detect(page({ css: { qldBemSelectors: 2000 } })).codebases, ["qh_vanilla"]);
  assert.deepEqual(detect(page({ css: { qhealthBemSelectors: 1000 } })).codebases, ["qh_vanilla"]);
});

test("A few qld__ selectors on a Bootstrap site do not add QH Vanilla", () => {
  const d = detect(page({ assetPaths: ["site-a.example/qld.bootstrap.css"], css: { qldBemSelectors: 300 } }));
  assert.deepEqual(d.codebases, ["bootstrap"]);
});

test("More than one codebase is reported in a fixed order", () => {
  const d = detect(page({ definedQgdsElements: 3, assetPaths: ["site-a.example/qld.bootstrap.css"] }));
  assert.deepEqual(d.codebases, ["bootstrap", "web_components"]);
});

test("Tokens alone mean QGDS with an unclear codebase", () => {
  const d = detect(page({ css: { qgdsCustomProperties: 120 } }));
  assert.equal(d.usesQgds, true);
  assert.deepEqual(d.codebases, []);
  assert.deepEqual(d.signals, ["css:qgds-tokens"]);
});

test("countCss counts selectors and declarations, not uses", () => {
  const css = ".qld__card{color:var(--qld-color-a)} .qhealth__tag{} :root{--qld-color-a: #000; --qgds-space-1: 4px}";
  assert.deepEqual(countCss(css), { qldBemSelectors: 1, qhealthBemSelectors: 1, qldCustomProperties: 1, qgdsCustomProperties: 1 });
});

test("Errors map to contract failure types", () => {
  assert.equal(classifyError(new Error("page.goto: Timeout 30000ms exceeded.")), "timeout");
  assert.equal(classifyError(new Error("net::ERR_NAME_NOT_RESOLVED at https://site-a.example")), "dns");
  assert.equal(classifyError(new Error("net::ERR_CERT_DATE_INVALID")), "tls");
  assert.equal(classifyError(new Error("something else")), "other");
});
