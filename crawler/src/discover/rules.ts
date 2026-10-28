// Rules for discovering sites missing from the site list. Pure functions, no network,
// so they can be unit tested. They hold patterns only, never site or agency names.

export const ROOT_DOMAIN = "qld.gov.au";

const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");

// The label before the root domain, for example "example" in "a.b.example.qld.gov.au".
export function branchOf(host: string): string {
  const labels = bare(host).replace(new RegExp(`\\.?${ROOT_DOMAIN.replace(/\./g, "\\.")}$`), "").split(".");
  return labels[labels.length - 1] ?? "";
}

// Hostnames that are infrastructure, not websites. Matched on any label of the hostname.
const INFRASTRUCTURE_LABEL = /^(api|apis|mail|smtp|mx|autodiscover|vpn|remote|citrix|adfs|sso|sts|login|auth|idp|owa|webmail|ftp|sftp|lyncdiscover|sip|enterpriseenrollment|enterpriseregistration|cdn|static|assets|media|img|images|files|proxy|gateway|admin|origin|lb|waf|monitor|grafana|kibana|jenkins|gitlab|git|sonar|nexus|splunk|internal|intranet|backup|link)$/;
// Labels that mark a test or non-production copy: alone or at either end of a hyphenated label
// ("uat", "tst2-portal", "app-dev"), or joined to a name ("formsdev", "stagingportal",
// "appsit"). "test" and "stage" begin ordinary words, so joined to a name they only count at
// the end. "sit" ends "visit" and "transit", so those are left alone.
const ENV = "dev|uat|test|tst|stg|stage|staging|sit|syst|qa|preprod|pre-prod|nonprod|nprd|np|sandbox|sandpit|demo|trn|train|training|ppd|ppt|prp|preview|prep|stress|perf";
const NON_PRODUCTION = new RegExp(
  `(^|-)(${ENV})\\d*$|^(${ENV})\\d*-|^(dev|uat|staging|training|preprod)[a-z0-9]+$|[a-z](dev|uat|test|staging|training|preprod|preprd|nprd|tst|trn|mig)$|[a-z](?<!vi|an)sit$|dev(one|two|three|four|five|six|seven|eight|nine|ten)$`,
);

export type Prefilter = { keep: true } | { keep: false; reason: string };

// Decides, without visiting, whether a hostname is worth checking.
export function prefilter(host: string, known: { listed: Set<string>; excluded: Set<string> }): Prefilter {
  const h = bare(host);
  if (known.listed.has(h)) return { keep: false, reason: "Already on the site list" };
  if (known.excluded.has(h) || known.excluded.has(branchOf(h))) return { keep: false, reason: "Rejected in an earlier review" };
  const labels = h.split(".").slice(0, -ROOT_DOMAIN.split(".").length);
  if (labels.some((l) => INFRASTRUCTURE_LABEL.test(l))) return { keep: false, reason: "Infrastructure, not a website" };
  if (labels.some((l) => NON_PRODUCTION.test(l))) return { keep: false, reason: "Test or non-production copy" };
  if (/(rc|sc|council|shire)$/.test(branchOf(h))) return { keep: false, reason: "Likely a council" };
  return { keep: true };
}

// What a visit to a candidate found.
export interface Visit {
  status: number | null;
  finalUrl: string | null;
  title: string;
  textLength: number;
  hasPassword: boolean;
  error?: string;
}

export type Outcome = "public_site" | "sign_in" | "redirects_to_listed" | "council" | "placeholder" | "staff_or_test" | "not_live" | "robots";

const SIGN_IN = /login|signin|sign-in|logon|microsoftonline|okta|b2clogin|adfs|saml|sso|oauth|authorize|identity|\/auth\b/i;
const PLACEHOLDER = /parked|domain (is )?for sale|coming soon|under construction|default (web )?(site|page)|iis windows server|apache2? .*(default|test) page|welcome to nginx|index of \/|it works!|page not found|not found|\b404\b|maintenance mode|unavailable|has moved/i;
// Staff sign-in services and tools: a candidate that lands on one is not for the public.
// Matched on the visited hostname, the landed hostname and path, and the page title.
const STAFF = /mydesktop|citrix|netscaler|omnissa|big-ip|logonpoint|sslvpn|vpn\d*\.|-fw\.|globalprotect|my\.policy|\/idp\/|intranet|\blms\b|pexip|pentaho|jboss|smtp2go|vision6|kiteworks|arcgis\/rest\/services|authentik|atlassian|jira|confluence|itsm\.|integrum|myhr|work zone|internal careers|staff portal|virtual desktop|internal data|password protected|central authentication service/i;
// Pages that refused the check. The check never works around a block, so these are not
// candidates.
const BLOCKED = /web page blocked|request rejected|access denied|just a moment|attention required/i;

// Council pages that a qld.gov.au hostname leads to, named in the title.
const COUNCIL_TITLE = /\b(regional|shire|city|town) council\b|^city of |organisation of councils|\bcouncil\s*(\||$)/i;

// What the visited hostname and the landed page say: a block, a staff tool or a council. Also run
// on saved results, so rule changes apply without visiting sites again. The hostname counts
// because many staff tools hand over to a general sign-in service that names nothing.
export function pageSigns(host: string, finalUrl: string, title: string): { outcome: Outcome; reason: string } | null {
  let target = finalUrl;
  try { const u = new URL(finalUrl); target = u.hostname + u.pathname; } catch { /* keep as is */ }
  if (BLOCKED.test(title)) return { outcome: "not_live", reason: "Blocked the check" };
  if (STAFF.test(`${bare(host)}. ${target} ${title}`)) return { outcome: "staff_or_test", reason: "Staff tool or sign-in" };
  if (COUNCIL_TITLE.test(title)) return { outcome: "council", reason: "Council page" };
  return null;
}

export function classify(visit: Visit, host: string, known: { listed: Set<string> }): { outcome: Outcome; reason: string } {
  if (visit.error) return { outcome: "not_live", reason: visit.error };
  if (visit.status !== null && visit.status >= 400) return { outcome: "not_live", reason: `HTTP ${visit.status}` };
  if (!visit.finalUrl) return { outcome: "not_live", reason: "No response" };
  const final = new URL(visit.finalUrl);
  const finalHost = bare(final.hostname);
  if (finalHost !== bare(host) && known.listed.has(finalHost)) return { outcome: "redirects_to_listed", reason: `Redirects to ${finalHost}` };
  if (finalHost.endsWith(ROOT_DOMAIN) && /(rc|sc|council|shire)$/.test(branchOf(finalHost))) return { outcome: "council", reason: `Redirects to ${finalHost}` };
  const signs = pageSigns(host, visit.finalUrl, visit.title);
  if (signs) return signs;
  if (SIGN_IN.test(final.hostname + final.pathname) || visit.hasPassword) return { outcome: "sign_in", reason: `Sign-in page at ${final.hostname}` };
  if (PLACEHOLDER.test(visit.title)) return { outcome: "placeholder", reason: `Title: ${visit.title.slice(0, 60)}` };
  if (visit.textLength < 150) return { outcome: "placeholder", reason: "Almost empty page" };
  return { outcome: "public_site", reason: "" };
}

// The listed site a candidate most likely belongs to: the longest listed hostname that is a
// suffix of the candidate's. Used to suggest organisation, department and brand tier.
export function parentOf<T extends { host: string; path: string }>(host: string, listed: T[]): T | null {
  const labels = bare(host).split(".");
  for (let i = 1; i < labels.length - ROOT_DOMAIN.split(".").length; i++) {
    const suffix = labels.slice(i).join(".");
    const match = listed.filter((l) => l.host === suffix).sort((a, b) => a.path.length - b.path.length)[0];
    if (match) return match;
  }
  return null;
}

// Department names from the site list that appear in a page footer. The names come from the
// private list, so none are written into this public code.
export function departmentsIn(footerText: string, departmentNames: string[]): string[] {
  const text = footerText.toLowerCase().replace(/\s+/g, " ");
  return departmentNames.filter((d) => d && text.includes(d.toLowerCase()));
}
