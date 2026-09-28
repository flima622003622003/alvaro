import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { feature } from "https://cdn.jsdelivr.net/npm/topojson-client@3/+esm";

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("pt-BR") : "sem dado");
const seqSteps = ["--seq-1", "--seq-2", "--seq-3", "--seq-4"];

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

async function main() {
  const [dataset, topo] = await Promise.all([
    d3.json("data/population.json"),
    d3.json("data/us-states-10m.json"),
  ]);

  const years = dataset.years.slice().sort((a, b) => a - b);
  const latestYear = years[years.length - 1];
  let selectedYear = latestYear;
  let compareState = "";

  // ---- populate filter controls -------------------------------------
  const yearSelect = document.getElementById("yearSelect");
  for (const y of years.slice().reverse()) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    yearSelect.appendChild(opt);
  }
  yearSelect.value = String(latestYear);

  const stateNames = dataset.states.map((s) => s.state).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const stateSelect = document.getElementById("stateSelect");
  for (const name of stateNames) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    stateSelect.appendChild(opt);
  }

  document.getElementById("yearRangeLabel").textContent = `${years[0]}–${latestYear}`;
  document.querySelectorAll(".yearInline").forEach((el) => (el.textContent = String(selectedYear)));
  document.getElementById("statUpdated").textContent = dataset.lastUpdated ?? "–";
  document.getElementById("sourceNote").textContent = `Fonte dos dados: ${dataset.source}`;

  // ---- theme toggle ----------------------------------------------------
  const themeToggle = document.getElementById("themeToggle");
  themeToggle.addEventListener("click", () => {
    const root = document.documentElement;
    const current = root.getAttribute("data-theme");
    root.setAttribute("data-theme", current === "dark" ? "light" : "dark");
    renderAll(); // colors depend on CSS vars resolved at draw time
  });

  // ---- tooltip helper ----------------------------------------------------
  const tooltipEl = document.getElementById("tooltip");
  function showTooltip(x, y, html) {
    tooltipEl.replaceChildren();
    tooltipEl.appendChild(html);
    tooltipEl.hidden = false;
    const pad = 14;
    let left = x + pad;
    let top = y + pad;
    const rect = tooltipEl.getBoundingClientRect();
    if (left + rect.width > window.innerWidth) left = x - rect.width - pad;
    if (top + rect.height > window.innerHeight) top = y - rect.height - pad;
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  }
  function hideTooltip() {
    tooltipEl.hidden = true;
  }

  // ---- derived lookups ----------------------------------------------------
  const byState = new Map(dataset.states.map((s) => [s.state, s.values]));

  function valueFor(state, year) {
    const v = byState.get(state)?.[String(year)];
    return typeof v === "number" ? v : null;
  }

  function rowsForYear(year) {
    return dataset.states
      .map((s) => ({ state: s.state, value: valueFor(s.state, year) }))
      .filter((r) => r.value !== null);
  }

  // ======================================================================
  // Stat tiles
  // ======================================================================
  function renderStats() {
    const total = dataset.usTotal[String(selectedYear)];
    document.getElementById("statTotal").textContent = fmt(total);

    const idx = years.indexOf(selectedYear);
    const prevYear = years.slice(0, idx).reverse().find((y) => typeof dataset.usTotal[String(y)] === "number");
    const deltaEl = document.getElementById("statDelta");
    if (prevYear !== undefined && typeof total === "number") {
      const prev = dataset.usTotal[String(prevYear)];
      const diff = total - prev;
      const pct = prev ? (diff / prev) * 100 : 0;
      deltaEl.className = `delta ${diff > 0 ? "up" : diff < 0 ? "down" : "flat"}`;
      deltaEl.textContent = `${diff >= 0 ? "+" : ""}${fmt(diff)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%) vs ${prevYear}`;
    } else {
      deltaEl.className = "delta flat";
      deltaEl.textContent = "sem ano anterior para comparar";
    }

    const rows = rowsForYear(selectedYear).sort((a, b) => b.value - a.value);
    document.getElementById("statTop").textContent = rows[0]?.state ?? "–";
    document.getElementById("statTopValue").textContent = rows[0] ? fmt(rows[0].value) : "";
    document.getElementById("statCoverage").textContent = String(rows.length);
  }

  // ======================================================================
  // Choropleth map
  // ======================================================================
  const mapSvg = d3.select("#map");
  const geoStates = feature(topo, topo.objects.states).features;
  const path = d3.geoPath(d3.geoAlbersUsa().scale(1200).translate([480, 300]));

  // Fixed classes (same for every year) so colors are comparable across years.
  const mapBreaks = [1000, 5000, 20000];
  const mapClassLabels = ["Menos de 1.000", "1.000 a 4.999", "5.000 a 19.999", "20.000 ou mais"];

  function colorScale() {
    return d3.scaleThreshold().domain(mapBreaks).range(seqSteps.map(cssVar));
  }

  function renderMapLegend(hasNoData) {
    const legend = document.getElementById("mapLegend");
    legend.replaceChildren();
    const keys = seqSteps.map((v, i) => [cssVar(v), mapClassLabels[i]]).reverse();
    if (hasNoData) keys.push([cssVar("--nodata"), "Sem dado"]);
    for (const [color, label] of keys) {
      const span = document.createElement("span");
      span.className = "key";
      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = color;
      span.append(sw, document.createTextNode(label));
      legend.appendChild(span);
    }
  }

  function renderMap() {
    const color = colorScale();
    const nodata = cssVar("--nodata");

    const sel = mapSvg.selectAll("path.state-path").data(geoStates, (d) => d.id);
    sel.join(
      (enter) =>
        enter
          .append("path")
          .attr("class", "state-path")
          .attr("d", path)
          .on("mousemove", (event, d) => {
            const name = d.properties.name;
            const v = valueFor(name, selectedYear);
            const wrap = document.createElement("div");
            const title = document.createElement("div");
            title.className = "t-title";
            title.textContent = name;
            const row = document.createElement("div");
            row.className = "t-row";
            const val = document.createElement("span");
            val.className = "v";
            val.textContent = fmt(v);
            row.appendChild(val);
            wrap.append(title, row);
            showTooltip(event.clientX, event.clientY, wrap);
          })
          .on("mouseleave", hideTooltip)
          .on("click", (event, d) => {
            const name = d.properties.name;
            compareState = compareState === name ? "" : name;
            stateSelect.value = compareState;
            renderMapSelection();
            renderLineCharts();
            renderFullTable();
            scrollFullTable();
          }),
      (update) => update,
    ).attr("fill", (d) => {
      const v = valueFor(d.properties.name, selectedYear);
      return v === null ? nodata : color(v);
    });

    renderMapSelection();
    renderMapLegend(dataset.states.some((s) => valueFor(s.state, selectedYear) === null));
  }

  function renderMapSelection() {
    mapSvg.selectAll("path.state-path").classed("selected", (d) => d.properties.name === compareState);
    if (compareState) {
      mapSvg.selectAll("path.state-path")
        .filter((d) => d.properties.name === compareState)
        .raise(); // bring the red outline above neighboring states' fills
    }
  }

  // ======================================================================
  // Line charts: US total and selected state, each on its own chart/scale
  // ======================================================================
  const M = { top: 16, right: 16, bottom: 28, left: 56 };
  const W = 960, H = 340;

  // Only one chart is shown at a time: the US total when no state is selected
  // ("Estados Unidos" in the filter), otherwise the selected state's series.
  function renderLineCharts() {
    const showState = Boolean(compareState);
    document.getElementById("usChartCard").hidden = showState;
    document.getElementById("stateChartCard").hidden = !showState;

    if (!showState) {
      drawLineChart(d3.select("#lineChart"), {
        label: "Total EUA", color: cssVar("--series-1"),
        values: years.map((y) => ({ year: y, value: dataset.usTotal[String(y)] ?? null })),
      });
      return;
    }
    document.getElementById("stateChartTitle").textContent = `Evolução histórica — ${compareState}`;
    drawLineChart(d3.select("#stateLineChart"), {
      label: compareState, color: cssVar("--series-2"),
      values: years.map((y) => ({ year: y, value: valueFor(compareState, y) })),
    });
  }

  function drawLineChart(lineSvg, s) {
    lineSvg.selectAll("*").remove();
    const series = [s];

    const x = d3.scaleLinear().domain(d3.extent(years)).range([M.left, W - M.right]);
    const maxY = d3.max(series.flatMap((s) => s.values.map((v) => v.value ?? 0))) ?? 1;
    const y = d3.scaleLinear().domain([0, maxY * 1.08]).range([H - M.bottom, M.top]).nice();

    const g = lineSvg.append("g");

    // gridlines
    g.append("g")
      .selectAll("line")
      .data(y.ticks(5))
      .join("line")
      .attr("class", "gridline")
      .attr("x1", M.left).attr("x2", W - M.right)
      .attr("y1", (d) => y(d)).attr("y2", (d) => y(d));

    // axes
    g.append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${H - M.bottom})`)
      .call(d3.axisBottom(x).tickFormat(d3.format("d")).ticks(10));
    g.append("g")
      .attr("class", "axis")
      .attr("transform", `translate(${M.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat((d) => d3.format(",")(d).replaceAll(",", ".")));

    const line = d3.line()
      .defined((d) => d.value !== null)
      .x((d) => x(d.year))
      .y((d) => y(d.value))
      .curve(d3.curveMonotoneX);

    const muted = cssVar("--text-muted");
    for (const s of series) {
      // dashed muted connector across any gap (e.g. 2020 - no ACS 1-year estimate),
      // drawn first so the solid segments sit on top of it. A gap spans from one
      // defined point to the next defined point, skipping over any null points
      // in between (not just directly-adjacent array entries).
      const defined = s.values.filter((d) => d.value !== null);
      for (let i = 0; i < defined.length - 1; i++) {
        const a = defined[i], b = defined[i + 1];
        if (b.year - a.year <= 1) continue; // no missing year between them
        g.append("line")
          .attr("x1", x(a.year)).attr("y1", y(a.value))
          .attr("x2", x(b.year)).attr("y2", y(b.value))
          .attr("stroke", muted).attr("stroke-width", 1.5).attr("stroke-dasharray", "3,3");
      }

      g.append("path")
        .datum(s.values)
        .attr("fill", "none")
        .attr("stroke", s.color)
        .attr("stroke-width", 2)
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("d", line);

      const last = [...s.values].reverse().find((d) => d.value !== null);
      if (last) {
        g.append("circle")
          .attr("cx", x(last.year)).attr("cy", y(last.value)).attr("r", 4)
          .attr("fill", s.color).attr("stroke", cssVar("--surface-1")).attr("stroke-width", 2);
      }
    }

    // hover crosshair
    const hoverLine = g.append("line").attr("class", "gridline").attr("y1", M.top).attr("y2", H - M.bottom).style("opacity", 0);
    const hitRect = g.append("rect")
      .attr("x", M.left).attr("y", M.top).attr("width", W - M.left - M.right).attr("height", H - M.top - M.bottom)
      .attr("fill", "transparent");

    hitRect
      .on("mousemove", (event) => {
        const [mx] = d3.pointer(event);
        const yearAtX = x.invert(mx);
        const nearest = years.reduce((a, b) => (Math.abs(b - yearAtX) < Math.abs(a - yearAtX) ? b : a));
        hoverLine.attr("x1", x(nearest)).attr("x2", x(nearest)).style("opacity", 1);

        const wrap = document.createElement("div");
        const title = document.createElement("div");
        title.className = "t-title";
        title.textContent = String(nearest);
        wrap.appendChild(title);
        for (const s of series) {
          const v = s.values.find((d) => d.year === nearest)?.value ?? null;
          const row = document.createElement("div");
          row.className = "t-row";
          const k = document.createElement("span");
          k.className = "k";
          const dot = document.createElement("span");
          dot.className = "dot";
          dot.style.background = s.color;
          k.append(dot, document.createTextNode(s.label));
          const val = document.createElement("span");
          val.className = "v";
          val.textContent = fmt(v);
          row.append(k, val);
          wrap.appendChild(row);
        }
        showTooltip(event.clientX, event.clientY, wrap);
      })
      .on("mouseleave", () => {
        hoverLine.style("opacity", 0);
        hideTooltip();
      });
  }

  // ======================================================================
  // Table
  // ======================================================================
  let sortKey = "value";
  let sortDir = -1; // desc
  let searchTerm = "";

  function renderTable() {
    const rows = rowsForYear(selectedYear)
      .filter((r) => r.state.toLowerCase().includes(searchTerm))
      .sort((a, b) => {
        if (sortKey === "state") return sortDir * a.state.localeCompare(b.state, "pt-BR");
        return sortDir * (a.value - b.value);
      });

    const rankByValue = new Map(
      rowsForYear(selectedYear)
        .sort((a, b) => b.value - a.value)
        .map((r, i) => [r.state, i + 1]),
    );

    const tbody = document.getElementById("tableBody");
    tbody.replaceChildren();
    for (const r of rows) {
      const tr = document.createElement("tr");
      const tdRank = document.createElement("td");
      tdRank.textContent = String(rankByValue.get(r.state));
      const tdState = document.createElement("td");
      tdState.textContent = r.state;
      const tdValue = document.createElement("td");
      tdValue.className = "num";
      tdValue.textContent = fmt(r.value);
      tr.append(tdRank, tdState, tdValue);
      tbody.appendChild(tr);
    }

    document.querySelectorAll("#rankingTable thead th").forEach((th) => {
      th.classList.toggle("active", th.dataset.sort === sortKey);
    });
  }

  document.querySelectorAll("#rankingTable thead th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (key === "rank") return; // rank always mirrors value desc
      sortDir = sortKey === key ? -sortDir : -1;
      sortKey = key;
      renderTable();
    });
  });

  document.getElementById("tableSearch").addEventListener("input", (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderTable();
  });

  // ======================================================================
  // Full historical table (states x years, like the "All" sheet)
  // ======================================================================
  function renderFullTable() {
    const head = document.getElementById("fullTableHead");
    head.replaceChildren();
    const thState = document.createElement("th");
    thState.textContent = "Estado";
    head.appendChild(thState);
    for (const yr of years) {
      const th = document.createElement("th");
      th.textContent = String(yr);
      th.classList.toggle("year-active", yr === selectedYear);
      th.dataset.year = String(yr);
      head.appendChild(th);
    }

    const body = document.getElementById("fullTableBody");
    body.replaceChildren();

    const statesSorted = dataset.states.slice().sort((a, b) => a.state.localeCompare(b.state, "pt-BR"));
    for (const s of statesSorted) {
      const tr = document.createElement("tr");
      tr.classList.toggle("state-active", s.state === compareState);
      tr.dataset.state = s.state;

      const tdName = document.createElement("td");
      tdName.textContent = s.state;
      tdName.className = "state-name";
      tdName.title = "Clique para destacar no mapa e no gráfico";
      tdName.addEventListener("click", () => {
        compareState = compareState === s.state ? "" : s.state;
        stateSelect.value = compareState;
        renderMapSelection();
        renderLineCharts();
        renderFullTable();
      });
      tr.appendChild(tdName);

      for (const yr of years) {
        const td = document.createElement("td");
        const v = valueFor(s.state, yr);
        td.textContent = v === null ? "—" : fmt(v);
        if (v === null) td.classList.add("no-data");
        if (yr === selectedYear) td.classList.add("year-active");
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }

    const trTotal = document.createElement("tr");
    trTotal.className = "total-row";
    const tdLabel = document.createElement("td");
    tdLabel.textContent = "Total EUA";
    trTotal.appendChild(tdLabel);
    for (const yr of years) {
      const td = document.createElement("td");
      const v = dataset.usTotal[String(yr)];
      td.textContent = typeof v === "number" ? fmt(v) : "—";
      if (yr === selectedYear) td.classList.add("year-active");
      trTotal.appendChild(td);
    }
    body.appendChild(trTotal);
  }

  // Scroll only the table's own box (never the page) so the selected state's
  // row and the selected year's column end up centered in view.
  function scrollFullTable({ toState = true, behavior = "smooth" } = {}) {
    const box = document.querySelector(".full-table-scroll");
    const boxRect = box.getBoundingClientRect();
    const target = { behavior };

    const th = document.querySelector(`#fullTableHead th[data-year="${selectedYear}"]`);
    if (th) {
      const r = th.getBoundingClientRect();
      target.left = box.scrollLeft + (r.left - boxRect.left) - (box.clientWidth - r.width) / 2;
    }
    if (toState && compareState) {
      const tr = [...document.querySelectorAll("#fullTableBody tr[data-state]")].find((row) => row.dataset.state === compareState);
      if (tr) {
        const r = tr.getBoundingClientRect();
        target.top = box.scrollTop + (r.top - boxRect.top) - (box.clientHeight - r.height) / 2;
      }
    }
    box.scrollTo(target);
  }

  // ======================================================================
  // Wiring + initial render
  // ======================================================================
  function renderAll() {
    document.querySelectorAll(".yearInline").forEach((el) => (el.textContent = String(selectedYear)));
    renderStats();
    renderMap();
    renderLineCharts();
    renderTable();
    renderFullTable();
    scrollFullTable({ behavior: "auto" });
  }

  yearSelect.addEventListener("change", () => {
    selectedYear = Number(yearSelect.value);
    document.querySelectorAll(".yearInline").forEach((el) => (el.textContent = String(selectedYear)));
    renderStats();
    renderMap();
    renderTable();
    renderFullTable();
    scrollFullTable({ toState: false });
  });

  stateSelect.addEventListener("change", () => {
    compareState = stateSelect.value;
    renderMapSelection();
    renderLineCharts();
    renderFullTable();
    scrollFullTable();
  });

  renderAll();
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<p style="color:#d03b3b;padding:20px">Falha ao carregar o dashboard: ${String(err.message ?? err)}</p>`,
  );
});
