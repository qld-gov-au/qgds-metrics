// Crawler conduct settings. See "Crawler conduct" in CLAUDE.md.

export const USER_AGENT = "QGDS-metrics-crawler/0.1 (+qgdesignsystem@qld.gov.au)";
export const ROBOTS_TIMEOUT_MS = 10_000;
export const PAGE_TIMEOUT_MS = 30_000;
// Time after the HTML is ready for scripts to register web components and load styles.
export const SETTLE_MS = 4_000;
// Pause between sites. Sites are crawled one at a time.
export const DELAY_BETWEEN_SITES_MS = 1_500;
// Resource types not needed for detection. Blocking them reduces load on sites.
export const BLOCKED_RESOURCE_TYPES = new Set(["image", "media", "font"]);
// Fixed desktop viewport, because heading sizes and layout change with width.
export const VIEWPORT = { width: 1280, height: 900 };
// A run where more than this share of sites fail to load is marked failed, so it is not
// exported. A high failure rate usually means the crawler's network is being blocked.
export const MAX_FAILED_SHARE = 0.25;
