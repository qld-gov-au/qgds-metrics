// Checks one site: robots.txt, then renders the home page and detects QGDS.
// Keeps counts and asset paths in memory only. Stores no page content or cookies.
import type { Browser } from "playwright";
import { BLOCKED_RESOURCE_TYPES, PAGE_TIMEOUT_MS, SETTLE_MS, USER_AGENT, VIEWPORT } from "./config.ts";
import { addCss, countCss, detect, emptyCss, type Codebase, type PageSignals, type PageStyle } from "./detect.ts";
import { checkRobots } from "./robots.ts";

export type FailureType = "timeout" | "dns" | "tls" | "http_error" | "robots_disallowed" | "other";

// Matches a site_results row in contract/schema.sql, without the ids.
export interface SiteResult {
  status: "ok" | "failed" | "skipped";
  failure_type: FailureType | null;
  http_status: number | null;
  uses_qgds: boolean | null;
  codebases: Codebase[];
  signals: string[];
  pages_checked: number;
  duration_ms: number;
}

export async function checkSite(browser: Browser, url: string): Promise<SiteResult> {
  const started = Date.now();
  const fail = (status: "failed" | "skipped", failure_type: FailureType, http_status: number | null = null): SiteResult => ({
    status, failure_type, http_status, uses_qgds: null, codebases: [], signals: [], pages_checked: 0,
    duration_ms: Date.now() - started,
  });

  // A fresh context per site, discarded afterwards, so no cookies carry over or persist.
  const context = await browser.newContext({ userAgent: USER_AGENT, viewport: VIEWPORT });
  try {
    const page = await context.newPage();
    await page.route("**/*", (route) =>
      BLOCKED_RESOURCE_TYPES.has(route.request().resourceType()) ? route.abort() : route.continue(),
    );

    const robots = await checkRobots(url, page);
    if (robots !== "allowed") return fail("skipped", "robots_disallowed");

    const assetPaths = new Set<string>();
    let css = emptyCss();
    const pendingCss: Promise<void>[] = [];
    page.on("response", (response) => {
      const type = response.request().resourceType();
      if (type !== "stylesheet" && type !== "script") return;
      const { host, pathname } = new URL(response.url());
      assetPaths.add(host + pathname);
      if (type === "stylesheet") {
        pendingCss.push(response.text().then((text) => { css = addCss(css, countCss(text)); }, () => {}));
      }
    });

    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
    const httpStatus = response?.status() ?? null;
    if (httpStatus !== null && httpStatus >= 400) return fail("failed", "http_error", httpStatus);

    await page.waitForTimeout(SETTLE_MS);
    await Promise.all(pendingCss);

    const dom = await page.evaluate((): { definedQgdsElements: number; inlineCss: string; style: PageStyle } => {
      // Elements in the document and in open shadow roots, so web components are included.
      const elements: Element[] = [];
      const collect = (root: Document | ShadowRoot) => {
        for (const el of root.querySelectorAll("*")) {
          elements.push(el);
          if (el.shadowRoot) collect(el.shadowRoot);
        }
      };
      collect(document);

      const defined = new Set<string>();
      for (const el of elements) {
        const tag = el.tagName.toLowerCase();
        if (tag.startsWith("qgds-") && customElements.get(tag)) defined.add(tag);
      }
      // Inline <style> blocks are not network responses, so read them here.
      const inlineCss = [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");

      const px = (v: string) => (v.endsWith("px") ? parseFloat(v) : null);
      const visible = (el: Element) => {
        const box = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return box.width > 20 && box.height > 20 && cs.visibility !== "hidden" && cs.display !== "none";
      };
      // Most common value by its JSON form, so objects compare by content.
      const mostCommon = <T,>(values: T[]): T | null => {
        const counts = new Map<string, { value: T; n: number }>();
        for (const value of values) {
          const key = JSON.stringify(value);
          const entry = counts.get(key) ?? { value, n: 0 };
          entry.n++;
          counts.set(key, entry);
        }
        return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.value ?? null;
      };

      const h1 = document.querySelector("h1");
      const h1Style = h1 ? getComputedStyle(h1) : null;
      const inputs = elements.filter(
        (el) => el instanceof HTMLInputElement && ["text", "search", "email"].includes(el.type) && visible(el),
      );
      const links = elements.filter(
        (el) => el instanceof HTMLAnchorElement && el.closest("main, article, [role=main]") && !/btn|button/i.test(el.className) && visible(el),
      );

      const style: PageStyle = {
        bodyFont: getComputedStyle(document.body).fontFamily.split(",")[0].replace(/["']/g, "").trim() || null,
        heading: h1Style ? { sizePx: px(h1Style.fontSize) ?? 0, weight: Number(h1Style.fontWeight) } : null,
        formField: mostCommon(inputs.map((el) => {
          const cs = getComputedStyle(el);
          return { radiusPx: px(cs.borderTopLeftRadius) ?? 0, borderPx: px(cs.borderTopWidth) ?? 0, heightPx: Math.round(el.getBoundingClientRect().height) };
        })),
        link: mostCommon(links.map((el) => {
          const cs = getComputedStyle(el);
          return { underline: cs.textDecorationLine.includes("underline"), thicknessPx: px(cs.textDecorationThickness) };
        })),
      };
      return { definedQgdsElements: defined.size, inlineCss, style };
    });

    const signals: PageSignals = {
      assetPaths: [...assetPaths],
      css: addCss(css, countCss(dom.inlineCss)),
      definedQgdsElements: dom.definedQgdsElements,
      style: dom.style,
    };
    const detection = detect(signals);
    return {
      status: "ok",
      failure_type: null,
      http_status: httpStatus,
      uses_qgds: detection.usesQgds,
      codebases: detection.codebases,
      signals: detection.signals,
      pages_checked: 1,
      duration_ms: Date.now() - started,
    };
  } catch (err) {
    return fail("failed", classifyError(err));
  } finally {
    await context.close();
  }
}

export function classifyError(err: unknown): FailureType {
  const message = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/TimeoutError|ERR_TIMED_OUT|Timeout \d+ms exceeded/i.test(message)) return "timeout";
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i.test(message)) return "dns";
  if (/ERR_CERT|ERR_SSL|SSL_PROTOCOL|certificate/i.test(message)) return "tls";
  return "other";
}
