// Renders the dashboard from data/snapshot.json. Reads nothing else.
// Builds DOM with textContent only, so values from the snapshot are never parsed as HTML.
"use strict";

const CODEBASE_LABELS = {
  bootstrap: "Bootstrap",
  web_components: "Web Components",
  qh_vanilla: "Queensland Health Vanilla",
  unclear: "Own codebase, styled with QGDS",
};
const FAILURE_LABELS = {
  timeout: "timed out",
  dns: "address not found",
  tls: "security certificate error",
  http_error: "error page",
  robots_disallowed: "blocked by robots.txt",
  other: "other error",
};

// Element helper: h("p", { class: "x" }, "text", child)
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? "" : String(v));
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const token = (name, fallback) => getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
const number = new Intl.NumberFormat("en-AU");
const percent = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "No sites checked");
const dateTime = (iso) =>
  new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });
const date = (iso) => new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", year: "numeric" });
const plural = (n, one, many) => `${number.format(n)} ${n === 1 ? one : many}`;

function alert(variant, heading, text) {
  return h("qgds-inpage-alert", { variant, heading, "heading-level": 3, class: "empty" }, h("p", {}, text));
}

function statTiles(tiles) {
  return h("ul", { class: "stats" }, tiles.map((t) =>
    h("li", { class: "stat" }, h("p", { class: "stat-label" }, t.label), h("p", { class: "stat-value" }, t.value), t.detail ? h("p", { class: "stat-detail" }, t.detail) : null)));
}

function dataTable(caption, columns, rows) {
  return h("div", { class: "table-wrap" },
    h("table", { class: "data" },
      h("caption", { class: "visually-hidden" }, caption),
      h("thead", {}, h("tr", {}, columns.map((c) => h("th", { scope: "col", class: c.num ? "num" : null }, c.label)))),
      h("tbody", {}, rows.map((row) => h("tr", {}, columns.map((c, i) => (i === 0 ? h("th", { scope: "row" }, row[i]) : h("td", { class: c.num ? "num" : c.cls ?? null }, row[i]))))))));
}

function tableDetails(summary, table) {
  return h("qgds-details", { "summary-text": summary }, table);
}

// Draws each bar's value at its end, in text colour, so values never rely on colour.
const valueLabels = {
  id: "valueLabels",
  afterDatasetsDraw(chart, _args, options) {
    const { ctx } = chart;
    ctx.save();
    ctx.fillStyle = options.color;
    ctx.font = `600 14px ${options.fontFamily}`;
    ctx.textBaseline = "middle";
    chart.getDatasetMeta(0).data.forEach((bar, i) => {
      ctx.fillText(options.format(chart.data.datasets[0].data[i], i), bar.x + 8, bar.y);
    });
    ctx.restore();
  },
};

function chartDefaults() {
  const Chart = window.Chart;
  Chart.defaults.font.family = token("--qgds-font-family", "sans-serif");
  Chart.defaults.font.size = 14;
  Chart.defaults.color = token("--qgds-color-text-lighter", "#636363");
  Chart.defaults.borderColor = token("--qgds-color-border", "#ebebeb");
  Chart.defaults.animation = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : Chart.defaults.animation;
}

// Splits a label into lines of about 18 characters, so long labels fit on narrow screens.
function wrapLabel(text, width = 18) {
  const lines = [];
  for (const word of text.split(" ")) {
    const last = lines.length - 1;
    if (last >= 0 && (lines[last] + " " + word).length <= width) lines[last] += " " + word;
    else lines.push(word);
  }
  return lines;
}

function barChart(canvas, labels, values, format, max) {
  const colour = token("--qgds-color-primary-sapphire-blue", "#09549f");
  return new window.Chart(canvas, {
    type: "bar",
    data: { labels: labels.map((l) => wrapLabel(l)), datasets: [{ data: values, backgroundColor: colour, hoverBackgroundColor: token("--qgds-color-primary-dark-blue", "#05325f"), borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: "start", maxBarThickness: 28 }] },
    options: {
      indexAxis: "y",
      maintainAspectRatio: false,
      layout: { padding: { left: 12, right: 72 } },
      scales: {
        x: { beginAtZero: true, suggestedMax: max, ticks: { precision: 0 }, grid: { color: token("--qgds-color-border", "#ebebeb") } },
        y: { grid: { display: false }, ticks: { color: token("--qgds-color-text-default", "#353535") } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: (items) => labels[items[0].dataIndex], label: (item) => format(item.raw, item.dataIndex) } },
        valueLabels: { color: token("--qgds-color-text-default", "#353535"), fontFamily: token("--qgds-font-family", "sans-serif"), format },
      },
    },
    plugins: [valueLabels],
  });
}

function lineChart(canvas, labels, values, tooltip) {
  const colour = token("--qgds-color-primary-sapphire-blue", "#09549f");
  return new window.Chart(canvas, {
    type: "line",
    data: { labels, datasets: [{ data: values, borderColor: colour, backgroundColor: colour, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBorderColor: token("--qgds-color-background", "#fff"), pointBorderWidth: 2, spanGaps: false }] },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: { min: 0, max: 100, ticks: { callback: (v) => `${v}%`, stepSize: 25 }, grid: { color: token("--qgds-color-border", "#ebebeb") } },
        x: { grid: { display: false } },
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item) => tooltip(item.dataIndex) } } },
    },
  });
}

function chartFigure(title, description, height, draw, table, note) {
  const canvas = h("canvas", { role: "img", "aria-label": `${title}. ${description} Data table follows.` });
  const figure = h("figure", { class: "chart" },
    h("figcaption", {}, h("strong", {}, title), description),
    h("div", { class: "chart-box", style: `height: ${height}px` }, canvas),
    note ? h("p", { class: "chart-note" }, note) : null,
    table);
  queueMicrotask(() => draw(canvas));
  return figure;
}

function renderWeb(web) {
  const root = document.getElementById("web");
  root.replaceChildren();
  if (!web) {
    root.append(alert("info", "No website data yet", "No web crawl has completed. Results appear here after the first successful crawl."));
    return;
  }
  const t = web.totals;
  root.append(
    h("p", {}, `Observed on ${plural(t.sites_scanned, "site", "sites")} scanned, ${dateTime(web.run.finished_at)}.`),
    statTiles([
      { label: "Sites using QGDS", value: percent(t.sites_using_qgds, t.sites_checked), detail: `${number.format(t.sites_using_qgds)} of ${plural(t.sites_checked, "site", "sites")} checked` },
      { label: "Sites scanned", value: number.format(t.sites_scanned), detail: `${number.format(t.sites_checked)} checked` },
      { label: "Sites not checked", value: number.format(t.sites_failed), detail: t.sites_failed === 0 ? "No failures or skipped sites" : "Failed to load or skipped" },
    ]),
  );

  // Codebases
  const categories = [
    ["bootstrap", t.by_codebase.bootstrap],
    ["web_components", t.by_codebase.web_components],
    ["qh_vanilla", t.by_codebase.qh_vanilla],
    ["unclear", t.by_codebase.unclear],
  ];
  const notUsing = t.sites_checked - t.sites_using_qgds;
  const rows = [...categories.map(([k, v]) => [CODEBASE_LABELS[k], v]), ["Not using QGDS", notUsing]];
  const format = (v) => `${number.format(v)} (${percent(v, t.sites_checked)})`;
  if (t.sites_checked === 0) {
    root.append(alert("warning", "No sites could be checked", "Every site in the latest crawl failed to load or was skipped, so there is no codebase data."));
  } else {
    root.append(chartFigure(
      "Sites by QGDS codebase",
      `How the ${plural(t.sites_checked, "checked site", "checked sites")} are built.`,
      rows.length * 48 + 40,
      (canvas) => barChart(canvas, rows.map((r) => r[0]), rows.map((r) => r[1]), format, t.sites_checked),
      tableDetails("Show data table", dataTable("Sites by QGDS codebase", [{ label: "Codebase" }, { label: "Sites", num: true }, { label: "Share of checked sites", num: true }], rows.map(([label, v]) => [label, number.format(v), percent(v, t.sites_checked)]))),
      "A site can use more than one codebase, so the bars can add up to more than the number of sites checked. Percentages are of sites checked.",
    ));
  }

  // Trend
  const history = web.history;
  if (history.length < 2) {
    root.append(h("h3", {}, "Share of checked sites using QGDS, by crawl"), alert("info", "Not enough crawls to show a trend", "A trend appears after two or more crawls have completed."));
  } else {
    const share = history.map((r) => (r.totals.sites_checked > 0 ? Math.round((r.totals.sites_using_qgds / r.totals.sites_checked) * 1000) / 10 : null));
    // Add the time when two crawls share a date, so each point has a distinct label.
    const dates = history.map((r) => date(r.finished_at));
    const labels = history.map((r, i) => (dates.filter((d) => d === dates[i]).length > 1 ? dateTime(r.finished_at) : dates[i]));
    const detail = (i) => {
      const r = history[i].totals;
      return r.sites_checked > 0 ? `${share[i]}% (${number.format(r.sites_using_qgds)} of ${plural(r.sites_checked, "site", "sites")} checked)` : "No sites checked";
    };
    root.append(chartFigure(
      "Share of checked sites using QGDS, by crawl",
      "Each point is one crawl.",
      280,
      (canvas) => lineChart(canvas, labels, share, detail),
      tableDetails("Show data table", dataTable("Share of checked sites using QGDS, by crawl",
        [{ label: "Crawl finished" }, { label: "Sites scanned", num: true }, { label: "Sites checked", num: true }, { label: "Using QGDS", num: true }, { label: "Share", num: true }],
        history.map((r) => [dateTime(r.finished_at), number.format(r.totals.sites_scanned), number.format(r.totals.sites_checked), number.format(r.totals.sites_using_qgds), percent(r.totals.sites_using_qgds, r.totals.sites_checked)]))),
      "The number of sites scanned can change between crawls, so compare shares rather than counts.",
    ));
  }

  // Sites
  root.append(h("h3", {}, "Sites in the latest crawl"));
  if (web.sites.length === 0) {
    root.append(alert("info", "No sites in this crawl", "The latest crawl completed without any sites."));
  } else {
    const result = (s) => {
      if (s.status !== "ok") return `Not checked, ${FAILURE_LABELS[s.failure_type] ?? "unknown reason"}`;
      if (!s.uses_qgds) return "Not using QGDS";
      return s.codebases.length ? s.codebases.map((c) => CODEBASE_LABELS[c] ?? c).join(", ") : CODEBASE_LABELS.unclear;
    };
    const table = dataTable("Sites in the latest crawl", [{ label: "Site" }, { label: "Organisation" }, { label: "Result" }],
      web.sites.map((s) => [s.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), s.organisation ?? "Not recorded", result(s)]));
    table.querySelectorAll("tbody th").forEach((th) => th.classList.add("url"));
    root.append(table);
  }
}

function renderFigma(figma) {
  const root = document.getElementById("figma");
  root.replaceChildren();
  if (!figma) {
    root.append(alert("info", "No Figma data yet", "Figma library analytics have not been collected. Component, style and variable use appears here after the first Figma run."));
    return;
  }
  const sum = (list, key) => list.reduce((n, a) => n + a[key], 0);
  root.append(
    h("p", {}, `Collected ${dateTime(figma.run.finished_at)}.`),
    statTiles([
      { label: "Component instances", value: number.format(sum(figma.components, "usages")), detail: plural(figma.components.length, "component", "components") },
      { label: "Style uses", value: number.format(sum(figma.styles, "usages")), detail: plural(figma.styles.length, "style", "styles") },
      { label: "Variable uses", value: number.format(sum(figma.variables, "usages")), detail: plural(figma.variables.length, "variable", "variables") },
    ]),
  );

  const top = figma.components.slice(0, 10);
  if (top.length === 0) {
    root.append(h("h3", {}, "Most used components"), alert("info", "No component use recorded", "The latest Figma run found no uses of library components."));
  } else {
    root.append(chartFigure(
      "Most used components",
      `The ${plural(top.length, "component", "components")} with the most instances in files.`,
      top.length * 40 + 40,
      (canvas) => barChart(canvas, top.map((c) => c.name), top.map((c) => c.usages), (v) => number.format(v)),
      tableDetails("Show data table", dataTable("Most used components", [{ label: "Component" }, { label: "Instances", num: true }, { label: "Teams", num: true }, { label: "Files", num: true }],
        top.map((c) => [c.name, number.format(c.usages), number.format(c.teams_using), number.format(c.files_using)]))),
    ));
  }

  const actions = figma.component_actions;
  root.append(h("h3", {}, "Detach rate"));
  if (!actions) {
    root.append(alert("info", "No insertion or detachment data", "The latest Figma run did not collect component actions."));
    return;
  }
  const rate = (r) => (r === null ? "No insertions" : `${Math.round(r * 1000) / 10}%`);
  root.append(
    h("p", {}, `Weeks starting ${date(actions.period_start)} to ${date(actions.period_end)}. Detach rate is detachments divided by insertions. It can be above 100% when components inserted earlier are detached in this period.`),
    statTiles([
      { label: "Detach rate", value: rate(actions.totals.detach_rate), detail: `${number.format(actions.totals.detachments)} detachments, ${number.format(actions.totals.insertions)} insertions` },
    ]),
    tableDetails("Show detach rate by week", dataTable("Detach rate by week", [{ label: "Week starting" }, { label: "Insertions", num: true }, { label: "Detachments", num: true }, { label: "Detach rate", num: true }],
      actions.by_week.map((w) => [date(w.week), number.format(w.insertions), number.format(w.detachments), rate(w.detach_rate)]))),
    tableDetails("Show detach rate by component", dataTable("Detach rate by component", [{ label: "Component" }, { label: "Insertions", num: true }, { label: "Detachments", num: true }, { label: "Detach rate", num: true }],
      actions.by_component.map((c) => [c.name, number.format(c.insertions), number.format(c.detachments), rate(c.detach_rate)]))),
  );
}

async function main() {
  let snapshot;
  try {
    const response = await fetch("data/snapshot.json", { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    snapshot = await response.json();
  } catch {
    for (const id of ["web", "figma"]) {
      document.getElementById(id).replaceChildren(alert("error", "Data could not be loaded", "The snapshot file is missing or unreadable. Run the export, then rebuild the dashboard."));
    }
    return;
  }
  if (snapshot.schema_version !== "1.0") {
    document.getElementById("generated").textContent = `This dashboard expects snapshot version 1.0 but received ${snapshot.schema_version}. Figures may be wrong.`;
  } else {
    document.getElementById("generated").textContent = `Data exported ${dateTime(snapshot.generated_at)}.`;
  }
  chartDefaults();
  renderWeb(snapshot.web);
  renderFigma(snapshot.figma);
}

main();
