// Adds sites to crawl from a text file, one URL per line. Existing URLs are left as they are.
// Anything after # on a line is ignored, so seeds.txt works as input.
//
//   npm run sites:import -- seeds.txt
//
// Logs counts only.
import { readFileSync } from "node:fs";
import { isMissingTable, serviceClient } from "../scripts/supabase.ts";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run sites:import -- <file>");
  process.exit(1);
}

const lines = readFileSync(file, "utf8").split("\n").map((l) => l.split("#")[0].trim()).filter(Boolean);
const urls: string[] = [];
let invalid = 0;
for (const line of lines) {
  try {
    const url = new URL(line);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    urls.push(url.href);
  } catch {
    invalid++;
  }
}
const unique = [...new Set(urls)];

const supabase = serviceClient();
const { data, error } = await supabase
  .from("sites")
  .upsert(unique.map((url) => ({ url })), { onConflict: "url", ignoreDuplicates: true })
  .select("id");
if (error) {
  console.error(isMissingTable(error) ? "The sites table does not exist. Apply db/migrations first." : `Import failed: ${error.code}`);
  process.exit(1);
}
console.log(`Read ${lines.length} line(s). Added ${data.length} new site(s), ${unique.length - data.length} already present, ${invalid} invalid.`);
