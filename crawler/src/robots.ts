import robotsParserModule from "robots-parser";
import { ROBOTS_TIMEOUT_MS, USER_AGENT } from "./config.ts";

// The package is CommonJS, so the default import is the function itself at runtime.
const robotsParser = robotsParserModule as unknown as typeof robotsParserModule.default;

export type RobotsDecision = "allowed" | "disallowed" | "unreachable";

// Follows RFC 9309: a missing robots.txt (4xx) allows everything, and an
// unreachable one (5xx or network error) means crawl nothing.
export async function checkRobots(url: string): Promise<RobotsDecision> {
  const robotsUrl = new URL("/robots.txt", url).href;
  let response: Response;
  try {
    response = await fetch(robotsUrl, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
    });
  } catch {
    return "unreachable";
  }
  if (response.status >= 500) return "unreachable";
  if (!response.ok) return "allowed";
  const robots = robotsParser(robotsUrl, await response.text());
  return robots.isAllowed(url, USER_AGENT) === false ? "disallowed" : "allowed";
}
