// Renders the dashboard from the snapshot in data/snapshot.js. Reads nothing else.
// Builds DOM with textContent only, so values from the snapshot are never parsed as HTML.
"use strict";

const CODEBASE_LABELS = {
  bootstrap: "Bootstrap",
  web_components: "Web Components",
  qh_vanilla: "Queensland Health Vanilla",
  unclear: "Own codebase, styled with QGDS",
};
// Days after which the latest crawl is shown as overdue. Crawls are monthly.
const OVERDUE_DAYS = 35;
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

// Resolves when fonts have loaded, or after 3 seconds if they cannot load (for example offline).
const fontsReady = Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((resolve) => setTimeout(resolve, 3000))]);
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

// Chart height that gives every bar room for the longest label at the narrowest wrap.
// Chart.js gives all bars the same height, so size by the label with the most lines.
const barChartHeight = (labels) => labels.length * Math.max(44, ...labels.map((l) => wrapLabel(l, 14).length * 18 + 22)) + 40;

function barChart(canvas, labels, values, format, max) {
  // Narrow screens get shorter lines, so labels leave room for the bars.
  const wrapped = labels.map((l) => wrapLabel(l, canvas.clientWidth < 480 ? 14 : 18));
  const colour = token("--qgds-color-primary-sapphire-blue", "#09549f");
  return new window.Chart(canvas, {
    type: "bar",
    data: { labels: wrapped, datasets: [{ data: values, backgroundColor: colour, hoverBackgroundColor: token("--qgds-color-primary-dark-blue", "#05325f"), borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: "start", maxBarThickness: 28 }] },
    options: {
      indexAxis: "y",
      maintainAspectRatio: false,
      layout: { padding: { left: 12, right: 72 } },
      scales: {
        x: { beginAtZero: true, suggestedMax: max, ticks: { precision: 0 }, grid: { color: token("--qgds-color-border", "#ebebeb") } },
        // autoSkip off: every bar must keep its label.
        y: {
          grid: { display: false },
          ticks: { autoSkip: false, color: token("--qgds-color-text-default", "#353535") },
          // Chart.js can size the label area narrower than the longest label on small
          // screens. Measure the labels and widen it, up to 60% of the chart.
          afterFit: (scale) => {
            const ctx = scale.ctx;
            ctx.save();
            ctx.font = `14px ${token("--qgds-font-family", "sans-serif")}`;
            const widest = Math.max(...wrapped.flat().map((line) => ctx.measureText(line).width));
            ctx.restore();
            scale.width = Math.min(Math.max(scale.width, widest + 20), scale.chart.width * 0.6);
          },
        },
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

// yMax null lets the scale fit the data, for small values such as detach rates.
function lineChart(canvas, labels, values, tooltip, { yMax = 100, decimals = 0 } = {}) {
  const colour = token("--qgds-color-primary-sapphire-blue", "#09549f");
  return new window.Chart(canvas, {
    type: "line",
    data: { labels, datasets: [{ data: values, borderColor: colour, backgroundColor: colour, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBorderColor: token("--qgds-color-background", "#fff"), pointBorderWidth: 2, spanGaps: false }] },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: { min: 0, max: yMax ?? undefined, ticks: { callback: (v) => `${Number(v).toFixed(decimals)}%`, ...(yMax === 100 ? { stepSize: 25 } : { maxTicksLimit: 6 }) }, grid: { color: token("--qgds-color-border", "#ebebeb") } },
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
  // Draw after web fonts load. Chart.js sizes label space when it draws, so measuring
  // with a fallback font would clip labels once Noto Sans arrives.
  fontsReady.then(() => draw(canvas));
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
  // Crawls run monthly, so warn when the latest is well past due.
  const ageDays = Math.floor((Date.now() - Date.parse(web.run.finished_at)) / 86_400_000);
  if (ageDays > OVERDUE_DAYS) {
    root.append(alert("warning", "Website data may be out of date", `The latest website crawl is ${ageDays} days old. Crawls are due monthly, so these figures may not reflect the sites as they are now.`));
  }
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
      barChartHeight(rows.map((r) => r[0])),
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
  // Figma reports each variant separately. Group variants under their component set,
  // so a component with many variants appears once.
  const groupBy = (list, fields) => {
    const groups = new Map();
    for (const item of list) {
      const name = item.group ?? item.name;
      const g = groups.get(name) ?? { name, variants: 0, ...Object.fromEntries(fields.map((f) => [f, 0])) };
      g.variants++;
      for (const f of fields) g[f] += item[f];
      groups.set(name, g);
    }
    return [...groups.values()];
  };
  const components = groupBy(figma.components, ["usages"]);
  const instancesByName = new Map(components.map((c) => [c.name, c.usages]));
  const actions = figma.component_actions;

  // Headline totals leave out the library file when the snapshot has them (version 1.1).
  const totals = figma.totals;
  const scope = totals ? "Not counting the library file" : "Includes the library file";
  root.append(
    h("p", {}, `Collected ${dateTime(figma.run.finished_at)}. Counts are current use across files that use the library${totals ? ", not counting the library file itself" : ""}.`),
    statTiles([
      { label: "Component instances", value: number.format(totals ? totals.component_instances : sum(figma.components, "usages")), detail: `${scope}. ${plural(components.length, "component", "components")}, ${plural(figma.components.length, "variant", "variants")}.` },
      { label: "Style uses", value: number.format(totals ? totals.style_uses : sum(figma.styles, "usages")), detail: `${scope}. ${plural(figma.styles.length, "style", "styles")}.` },
      { label: "Variable uses", value: number.format(totals ? totals.variable_uses : sum(figma.variables, "usages")), detail: `${scope}. ${plural(figma.variables.length, "variable", "variables")}.` },
    ]),
  );

  // Rank by insertions: instances include components nested inside others, which puts
  // base components at the top even though designers rarely place them directly.
  const inserted = actions
    ? groupBy(actions.by_component, ["insertions"]).filter((c) => c.insertions > 0).sort((a, b) => b.insertions - a.insertions || a.name.localeCompare(b.name)).slice(0, 10)
    : [];
  if (inserted.length === 0) {
    root.append(h("h3", {}, "Most inserted components"), alert("info", "No insertions recorded", "The latest Figma run found no insertions of library components."));
  } else {
    root.append(chartFigure(
      "Most inserted components",
      `The ${plural(inserted.length, "component", "components")} designers placed most often in the ${actions.by_week.length} weeks, with all variants added together.`,
      barChartHeight(inserted.map((c) => c.name)),
      (canvas) => barChart(canvas, inserted.map((c) => c.name), inserted.map((c) => c.insertions), (v) => number.format(v)),
      tableDetails("Show data table", dataTable("Most inserted components", [{ label: "Component" }, { label: "Insertions", num: true }, { label: "Instances", num: true }],
        inserted.map((c) => [c.name, number.format(c.insertions), instancesByName.has(c.name) ? number.format(instancesByName.get(c.name)) : "Not recorded"]))),
      "Insertions count components placed directly. Instances also count components nested inside others and those in the library file, so base components have many instances but few insertions.",
    ));
  }

  if (!actions) {
    root.append(h("h3", {}, "Detach rate"), alert("info", "No insertion or detachment data", "The latest Figma run did not collect component actions."));
    return;
  }
  // Small rates need two decimal places to be meaningful.
  const rate = (r) => (r === null ? "No insertions" : `${(r * 100).toFixed(r < 0.1 ? 2 : 1)}%`);
  const detachRate = (insertions, detachments) => (insertions === 0 ? null : detachments / insertions);
  const byComponent = groupBy(actions.by_component, ["insertions", "detachments"])
    .map((c) => ({ ...c, detach_rate: detachRate(c.insertions, c.detachments) }))
    .sort((a, b) => b.detachments - a.detachments || a.name.localeCompare(b.name));
  const mostDetached = byComponent.filter((c) => c.detachments > 0).slice(0, 20);
  const weeks = actions.by_week;

  root.append(
    h("h3", {}, "Detach rate"),
    h("p", {}, `Weeks starting ${date(actions.period_start)} to ${date(actions.period_end)}. Detach rate is detachments divided by insertions. It can be above 100% when components inserted earlier are detached in this period. Figma cannot separate actions in the library file, so they are included.`),
    statTiles([
      { label: "Detach rate", value: rate(actions.totals.detach_rate), detail: `${number.format(actions.totals.detachments)} detachments, ${number.format(actions.totals.insertions)} insertions` },
    ]),
  );
  if (weeks.length >= 2) {
    const values = weeks.map((w) => (w.detach_rate === null ? null : Math.round(w.detach_rate * 10000) / 100));
    root.append(chartFigure(
      "Detach rate by week",
      "Each point is one week. Weeks with no insertions have no point.",
      260,
      (canvas) => lineChart(canvas, weeks.map((w) => date(w.week)), values,
        (i) => `${rate(weeks[i].detach_rate)} (${number.format(weeks[i].detachments)} of ${number.format(weeks[i].insertions)} insertions)`, { yMax: null, decimals: 1 }),
      tableDetails("Show data table", dataTable("Detach rate by week", [{ label: "Week starting" }, { label: "Insertions", num: true }, { label: "Detachments", num: true }, { label: "Detach rate", num: true }],
        weeks.map((w) => [date(w.week), number.format(w.insertions), number.format(w.detachments), rate(w.detach_rate)]))),
    ));
  }
  root.append(h("h3", {}, "Most detached components"));
  if (mostDetached.length === 0) {
    root.append(alert("success", "No detachments", "No library components were detached in this period."));
  } else {
    root.append(
      h("p", {}, `The ${plural(mostDetached.length, "component", "components")} detached most often in this period, with all variants added together. A high detach rate can mean a component does not meet a team's needs.`),
      dataTable("Most detached components", [{ label: "Component" }, { label: "Detachments", num: true }, { label: "Insertions", num: true }, { label: "Detach rate", num: true }],
        mostDetached.map((c) => [c.name, number.format(c.detachments), number.format(c.insertions), rate(c.detach_rate)])),
    );
  }
}

function main() {
  // Set by data/snapshot.js, which loads before this script.
  const snapshot = window.QGDS_METRICS_SNAPSHOT;
  if (!snapshot || typeof snapshot !== "object") {
    for (const id of ["web", "figma"]) {
      document.getElementById(id).replaceChildren(alert("error", "Data could not be loaded", "The snapshot file is missing or unreadable. Run the export, then rebuild the dashboard."));
    }
    return;
  }
  if (!/^1\.\d+$/.test(snapshot.schema_version)) {
    document.getElementById("generated").textContent = `This dashboard reads snapshot version 1 but received ${snapshot.schema_version}. Figures may be wrong.`;
  } else {
    document.getElementById("generated").textContent = `Data exported ${dateTime(snapshot.generated_at)}.`;
  }
  chartDefaults();
  renderWeb(snapshot.web);
  renderFigma(snapshot.figma);
}

main();
