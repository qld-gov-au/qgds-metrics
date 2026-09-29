// Checks one site: robots.txt, then renders the home page and detects QGDS.
// Keeps counts and asset paths in memory only. Stores no page content or cookies.
import type { Browser } from "playwright";
import { BLOCKED_RESOURCE_TYPES, PAGE_TIMEOUT_MS, SETTLE_MS, USER_AGENT } from "./config.ts";
import { addCss, countCss, detect, emptyCss, type Codebase, type PageSignals } from "./detect.ts";
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

  const robots = await checkRobots(url);
  if (robots !== "allowed") return fail("skipped", "robots_disallowed");

  // A fresh context per site, discarded afterwards, so no cookies carry over or persist.
  const context = await browser.newContext({ userAgent: USER_AGENT });
  try {
    const page = await context.newPage();
    const assetPaths = new Set<string>();
    let css = emptyCss();
    const pendingCss: Promise<void>[] = [];

    await page.route("**/*", (route) =>
      BLOCKED_RESOURCE_TYPES.has(route.request().resourceType()) ? route.abort() : route.continue(),
    );
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

    const dom = await page.evaluate(() => {
      const defined = new Set<string>();
      for (const el of document.querySelectorAll("*")) {
        const tag = el.tagName.toLowerCase();
        if (tag.startsWith("qgds-") && customElements.get(tag)) defined.add(tag);
      }
      // Inline <style> blocks are not network responses, so read them here.
      const inlineCss = [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
      return { definedQgdsElements: defined.size, inlineCss };
    });

    const signals: PageSignals = {
      assetPaths: [...assetPaths],
      css: addCss(css, countCss(dom.inlineCss)),
      definedQgdsElements: dom.definedQgdsElements,
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
