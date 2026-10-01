// Shows progress of the latest web crawl from what has been saved. Safe to run while a
// crawl is running, including from a second terminal.
//
//   npm run crawl:status
import { serviceClient } from "../../scripts/supabase.ts";

const supabase = serviceClient();
const { data: runs, error } = await supabase.from("runs").select("id, status, started_at, finished_at").eq("source", "web").order("started_at", { ascending: false }).limit(1);
if (error || !runs?.length) {
  console.log(error ? `Reading runs failed: ${error.code}` : "No web runs yet.");
  process.exit(error ? 1 : 0);
}
const run = runs[0];
const [{ data: results }, { count: active }] = await Promise.all([
  supabase.from("site_results").select("status, checked_at").eq("run_id", run.id).order("checked_at", { ascending: false }).limit(10_000),
  supabase.from("sites").select("*", { count: "exact", head: true }).eq("active", true),
]);
const saved = results ?? [];
const total = active ?? 0;
const now = Date.now();
const started = Date.parse(run.started_at);
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Brisbane", dateStyle: "medium", timeStyle: "short" });
const n = (status: string) => saved.filter((r) => r.status === status).length;

console.log(`Latest crawl: ${run.status}, started ${when(run.started_at)}${run.finished_at ? `, finished ${when(run.finished_at)}` : ""}.`);
console.log(`${saved.length} of ${total} active sites saved (${total ? Math.round((100 * saved.length) / total) : 0}%): ${n("ok")} checked, ${n("failed")} failed, ${n("skipped")} skipped.`);
if (run.status === "running" && saved.length > 0) {
  const lastSeconds = Math.round((now - Date.parse(saved[0].checked_at)) / 1000);
  const perSite = (now - started) / saved.length;
  console.log(`Last result saved ${lastSeconds} s ago. About ${Math.ceil(((total - saved.length) * perSite) / 60_000)} min left.`);
  if (lastSeconds > 180) console.log("Nothing saved for over 3 minutes. The crawl may be stuck or the network down.");
}
if (run.status === "failed") console.log("This crawl did not finish. Run npm run monthly -- --resume to finish it and build.");
