import type { Page } from "playwright";
import robotsParserModule from "robots-parser";
import { ROBOTS_TIMEOUT_MS, USER_AGENT } from "./config.ts";

// The package is CommonJS, so the default import is the function itself at runtime.
const robotsParser = robotsParserModule as unknown as typeof robotsParserModule.default;

export type RobotsDecision = "allowed" | "disallowed" | "unreachable";

// Loads robots.txt in the site's browser page. Many government sites sit behind bot
// protection that answers plain HTTP requests with 403, which would read as "no
// robots.txt" and hide the site's real rules.
//
// Follows RFC 9309: a missing robots.txt (4xx) allows everything, and an unreachable
// one (5xx or network error) means crawl nothing.
export async function checkRobots(url: string, page: Page): Promise<RobotsDecision> {
  const robotsUrl = new URL("/robots.txt", url).href;
  const response = await page.goto(robotsUrl, { waitUntil: "domcontentloaded", timeout: ROBOTS_TIMEOUT_MS }).catch(() => null);
  if (!response || response.status() >= 500) return "unreachable";
  if (!response.ok()) return "allowed";
  return decide(robotsUrl, await response.text(), url);
}

export function decide(robotsUrl: string, text: string, url: string): RobotsDecision {
  return robotsParser(robotsUrl, text).isAllowed(url, USER_AGENT) === false ? "disallowed" : "allowed";
}
