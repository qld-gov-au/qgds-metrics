// Local preview with automatic rebuild and refresh. Local use only.
//
//   npm run dashboard:dev
//
// Builds the dashboard, serves it on http://localhost:4173, rebuilds when anything in
// dashboard/src or the data snapshot changes, then refreshes open browser tabs. The
// refresh script is added by this server only, never to the built files.
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync, watch } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve("dist/dashboard");
const port = Number(process.env.PORT ?? 4173);
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2",
};
const reloadScript = `<script>new EventSource("/__reload").onmessage = () => location.reload();</script>`;

function build(): boolean {
  const started = Date.now();
  const result = spawnSync(process.execPath, ["dashboard/build.ts"], { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(`Build failed. Still showing the last good build.\n${(result.stderr || result.stdout).trim()}`);
    return false;
  }
  console.log(`Rebuilt in ${Date.now() - started} ms.`);
  return true;
}

if (!build()) process.exit(1);

// Open tabs listen here and reload after each successful rebuild.
const listeners = new Set<ServerResponse>();
createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  if (path === "/__reload") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(": connected\n\n");
    listeners.add(res);
    req.on("close", () => listeners.delete(res));
    return;
  }
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) { res.writeHead(404).end("Not found"); return; }
  const headers = { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" };
  if (extname(file) === ".html") {
    res.writeHead(200, headers).end(readFileSync(file, "utf8").replace("</body>", `${reloadScript}\n</body>`));
    return;
  }
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => console.log(`Dashboard at http://localhost:${port}. Watching for changes. Press Ctrl+C to stop.`));

// Editors often write a file in several steps, so wait briefly and rebuild once.
let timer: NodeJS.Timeout | undefined;
const changed = (what: string) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`Changed: ${what}`);
    if (build()) for (const res of listeners) res.write("data: reload\n\n");
  }, 150);
};
watch("dashboard/src", { recursive: true }, (_event, file) => changed(`dashboard/src/${file ?? ""}`));
// The export writes a new snapshot. Watch the folder, because the file is replaced, not edited.
if (existsSync("dashboard/data")) watch("dashboard/data", (_event, file) => { if (file === "snapshot.json") changed("data snapshot"); });
