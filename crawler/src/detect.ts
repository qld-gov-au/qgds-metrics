// QGDS detection rules. Pure functions, no network, so they can be unit tested.
//
// Codebase thresholds were set from rendered seed sites, with a wide margin between
// sites that use a codebase and sites that do not. The style fingerprint has a narrow
// margin, so treat it as provisional. Re-run `npm run crawler:seeds` after changing
// any rule.

export type Codebase = "bootstrap" | "web_components" | "qh_vanilla";

// Design system signals collected from one rendered page. Counts and file names only.
export interface PageSignals {
  // Stylesheet and script URLs loaded by the page, as host + path, no query string.
  assetPaths: string[];
  // Selector and custom property counts across all loaded stylesheets.
  css: {
    qldBemSelectors: number; // .qld__*
    qhealthBemSelectors: number; // .qhealth__*
    qldCustomProperties: number; // --qld-*: declarations
    qgdsCustomProperties: number; // --qgds-*: declarations
  };
  // qgds-* custom elements in the DOM that are registered with customElements.
  definedQgdsElements: number;
  // Computed styles of common elements. Null when the page has no such element.
  style: PageStyle;
}

export interface PageStyle {
  // First font family on body.
  bodyFont: string | null;
  // First h1.
  heading: { sizePx: number; weight: number } | null;
  // Most common style among visible text inputs.
  formField: { radiusPx: number; borderPx: number; heightPx: number } | null;
  // Most common style among visible links in the main content.
  link: { underline: boolean; thicknessPx: number | null } | null;
}

export interface Detection {
  usesQgds: boolean;
  codebases: Codebase[];
  // Identifiers of matched rules, stored for auditing.
  signals: string[];
}

// Style features that together suggest QGDS styling on a site with its own codebase.
// Values come from sites using the QGDS codebases. Noto Sans alone is not enough,
// because it is the Queensland Government brand font.
const between = (v: number, min: number, max: number) => v >= min && v <= max;
export const styleFeatures: { id: string; test: (s: PageStyle) => boolean }[] = [
  { id: "style:noto-sans", test: (s) => /^noto sans$/i.test(s.bodyFont ?? "") },
  { id: "style:qgds-form-field", test: (s) => s.formField !== null && s.formField.radiusPx === 4 && s.formField.borderPx === 2 && between(s.formField.heightPx, 44, 56) },
  { id: "style:qgds-link-underline", test: (s) => s.link !== null && s.link.underline && s.link.thicknessPx !== null && between(s.link.thicknessPx, 0.25, 1) },
  { id: "style:qgds-heading", test: (s) => s.heading !== null && s.heading.weight >= 600 && between(s.heading.sizePx, 32, 40) },
];

function styleMatches(style: PageStyle): string[] {
  return styleFeatures.filter((f) => f.test(style)).map((f) => f.id);
}

interface Rule {
  id: string;
  // null marks QGDS as present without identifying a codebase.
  codebase: Codebase | null;
  test: (s: PageSignals) => boolean;
}

const assetMatches = (s: PageSignals, pattern: RegExp) => s.assetPaths.some((p) => pattern.test(p));

export const rules: Rule[] = [
  { id: "asset:qld-bootstrap", codebase: "bootstrap", test: (s) => assetMatches(s, /\/qld\.bootstrap(\.min)?\.(css|js)$/i) },
  { id: "asset:qgds-bootstrap5", codebase: "bootstrap", test: (s) => assetMatches(s, /qgds-bootstrap5/i) },
  { id: "css:qld-custom-properties", codebase: "bootstrap", test: (s) => s.css.qldCustomProperties >= 1000 },

  { id: "element:qgds-defined", codebase: "web_components", test: (s) => s.definedQgdsElements >= 1 },
  { id: "asset:qgds-web-components", codebase: "web_components", test: (s) => assetMatches(s, /qgds-web-components/i) },

  { id: "css:qld-bem", codebase: "qh_vanilla", test: (s) => s.css.qldBemSelectors >= 2000 },
  { id: "css:qhealth-bem", codebase: "qh_vanilla", test: (s) => s.css.qhealthBemSelectors >= 1000 },

  // Weaker evidence of QGDS, such as design tokens, without a recognisable codebase.
  { id: "css:qgds-tokens", codebase: null, test: (s) => s.css.qgdsCustomProperties >= 50 },
  // QGDS styling rebuilt in a site's own code: Noto Sans plus at least one QGDS-specific style.
  {
    id: "style:qgds-fingerprint",
    codebase: null,
    test: (s) => {
      const matched = styleMatches(s.style);
      return matched.includes("style:noto-sans") && matched.length >= 2;
    },
  },
];

const codebaseOrder: Codebase[] = ["bootstrap", "web_components", "qh_vanilla"];

export function detect(signals: PageSignals): Detection {
  const matched = rules.filter((r) => r.test(signals));
  const found = new Set(matched.map((r) => r.codebase).filter((c): c is Codebase => c !== null));
  return {
    usesQgds: matched.length > 0,
    codebases: codebaseOrder.filter((c) => found.has(c)),
    // Individual style features are recorded for auditing but do not count on their own.
    signals: [...matched.map((r) => r.id), ...styleMatches(signals.style)],
  };
}

// Counts selectors and custom property declarations in one stylesheet's text.
export function countCss(text: string): PageSignals["css"] {
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  return {
    qldBemSelectors: count(/\.qld__[a-z]/g),
    qhealthBemSelectors: count(/\.qhealth__[a-z]/g),
    qldCustomProperties: count(/--qld-[a-z0-9-]+\s*:/g),
    qgdsCustomProperties: count(/--qgds-[a-z0-9-]+\s*:/g),
  };
}

export function addCss(a: PageSignals["css"], b: PageSignals["css"]): PageSignals["css"] {
  return {
    qldBemSelectors: a.qldBemSelectors + b.qldBemSelectors,
    qhealthBemSelectors: a.qhealthBemSelectors + b.qhealthBemSelectors,
    qldCustomProperties: a.qldCustomProperties + b.qldCustomProperties,
    qgdsCustomProperties: a.qgdsCustomProperties + b.qgdsCustomProperties,
  };
}

export const emptyStyle = (): PageStyle => ({ bodyFont: null, heading: null, formField: null, link: null });

export const emptyCss = (): PageSignals["css"] => ({
  qldBemSelectors: 0,
  qhealthBemSelectors: 0,
  qldCustomProperties: 0,
  qgdsCustomProperties: 0,
});
