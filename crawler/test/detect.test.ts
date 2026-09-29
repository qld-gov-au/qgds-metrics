import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyError } from "../src/check-site.ts";
import { countCss, detect, emptyCss, emptyStyle, type PageSignals, type PageStyle } from "../src/detect.ts";

const page = (
  overrides: Omit<Partial<PageSignals>, "css" | "style"> & { css?: Partial<PageSignals["css"]>; style?: Partial<PageStyle> } = {},
): PageSignals => ({
  assetPaths: overrides.assetPaths ?? [],
  css: { ...emptyCss(), ...overrides.css },
  definedQgdsElements: overrides.definedQgdsElements ?? 0,
  style: { ...emptyStyle(), ...overrides.style },
});

const qgdsFormField = { radiusPx: 4, borderPx: 2, heightPx: 48 };

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

test("Style fingerprint: Noto Sans plus a QGDS form field means QGDS, codebase unclear", () => {
  const d = detect(page({ style: { bodyFont: "Noto Sans", formField: qgdsFormField } }));
  assert.equal(d.usesQgds, true);
  assert.deepEqual(d.codebases, []);
  assert.deepEqual(d.signals, ["style:qgds-fingerprint", "style:noto-sans", "style:qgds-form-field"]);
});

test("Style fingerprint: Noto Sans plus QGDS heading or link underline also counts", () => {
  assert.equal(detect(page({ style: { bodyFont: "Noto Sans", heading: { sizePx: 40, weight: 600 } } })).usesQgds, true);
  assert.equal(detect(page({ style: { bodyFont: "Noto Sans", link: { underline: true, thicknessPx: 0.5 } } })).usesQgds, true);
});

test("Style fingerprint: Noto Sans alone does not count", () => {
  const d = detect(page({ style: { bodyFont: "Noto Sans" } }));
  assert.equal(d.usesQgds, false);
  assert.deepEqual(d.signals, ["style:noto-sans"]);
});

test("Style fingerprint: QGDS styles without Noto Sans do not count", () => {
  const style = { bodyFont: "Example Sans", formField: qgdsFormField, heading: { sizePx: 40, weight: 600 } };
  assert.equal(detect(page({ style })).usesQgds, false);
});

test("Style fingerprint: near misses do not count", () => {
  const nearMisses: Partial<PageStyle>[] = [
    { formField: { radiusPx: 4, borderPx: 1, heightPx: 48 } },
    { formField: { radiusPx: 0, borderPx: 2, heightPx: 48 } },
    { formField: { radiusPx: 4, borderPx: 2, heightPx: 36 } },
    { heading: { sizePx: 40, weight: 400 } },
    { heading: { sizePx: 64, weight: 600 } },
    { link: { underline: false, thicknessPx: 0.5 } },
    { link: { underline: true, thicknessPx: null } },
  ];
  for (const style of nearMisses) {
    assert.equal(detect(page({ style: { bodyFont: "Noto Sans", ...style } })).usesQgds, false, JSON.stringify(style));
  }
});

test("Style features on a codebase site are recorded but do not change the codebase", () => {
  const d = detect(page({ assetPaths: ["site-a.example/qld.bootstrap.css"], style: { bodyFont: "Noto Sans", formField: qgdsFormField } }));
  assert.deepEqual(d.codebases, ["bootstrap"]);
  assert.ok(d.signals.includes("style:qgds-fingerprint"));
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
