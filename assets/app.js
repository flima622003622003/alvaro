import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { feature, merge } from "https://cdn.jsdelivr.net/npm/topojson-client@3/+esm";

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("pt-BR") : "sem dado");
const seqSteps = ["--seq-1", "--seq-2", "--seq-3", "--seq-4"];

// The 4 Census Bureau regions. Titles read "Nordeste dos EUA" etc. so they
// aren't mistaken for Brazil's regions.
const REGIONS = [
  { id: "northeast", name: "Nordeste", states: ["Connecticut", "Maine", "Massachusetts", "New Hampshire", "New Jersey", "New York", "Pennsylvania", "Rhode Island", "Vermont"] },
  { id: "midwest", name: "Meio-Oeste", states: ["Illinois", "Indiana", "Iowa", "Kansas", "Michigan", "Minnesota", "Missouri", "Nebraska", "North Dakota", "Ohio", "South Dakota", "Wisconsin"] },
  { id: "south", name: "Sul", states: ["Alabama", "Arkansas", "Delaware", "District of Columbia", "Florida", "Georgia", "Kentucky", "Louisiana", "Maryland", "Mississippi", "North Carolina", "Oklahoma", "South Carolina", "Tennessee", "Texas", "Virginia", "West Virginia"] },
  { id: "west", name: "Oeste", states: ["Alaska", "Arizona", "California", "Colorado", "Hawaii", "Idaho", "Montana", "Nevada", "New Mexico", "Oregon", "Utah", "Washington", "Wyoming"] },
];
const regionById = new Map(REGIONS.map((r) => [r.id, r]));
const regionOfState = new Map(REGIONS.flatMap((r) => r.states.map((st) => [st, r.id])));
const regionLabel = (id) => `${regionById.get(id).name} dos EUA`;
const pctText = (part, whole) => `${((part / whole) * 100).toFixed(1).replace(".", ",")}% do total dos EUA`;

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
  let selectedRegion = ""; // "" = all regions

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
  // Only the chosen region's states; the first option is that scope's total.
  function fillStateSelect() {
    stateSelect.replaceChildren();
    const first = document.createElement("option");
    first.value = "";
    first.textContent = selectedRegion ? "Nenhum — ver total da região" : "Nenhum — ver total dos EUA";
    stateSelect.appendChild(first);
    for (const name of stateNames.filter(inScope)) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      stateSelect.appendChild(opt);
    }
    stateSelect.value = compareState;
  }

  const regionSelect = document.getElementById("regionSelect");
  for (const r of REGIONS) {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = r.name;
    regionSelect.appendChild(opt);
  }

  document.getElementById("yearRangeLabel").textContent = `${years[0]}–${latestYear}`;
  document.querySelectorAll(".yearInline").forEach((el) => (el.textContent = String(selectedYear)));
  // "2026-09-20" -> "20/09/2026"; split the string instead of new Date() so the
  // browser's timezone can't shift it to the previous day
  const [upY, upM, upD] = (dataset.lastUpdated ?? "").split("-");
  document.getElementById("statUpdated").textContent = upD ? `${upD}/${upM}/${upY}` : "–";
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

  function inScope(state) {
    return !selectedRegion || regionOfState.get(state) === selectedRegion;
  }

  function rowsForYear(year) {
    return dataset.states
      .filter((s) => inScope(s.state))
      .map((s) => ({ state: s.state, value: valueFor(s.state, year) }))
      .filter((r) => r.value !== null);
  }

  // Region total = sum of its states with data, the same way usTotal is the
  // sum of all states. null when no state has data (2020).
  function regionTotal(regionId, year) {
    const vals = regionById.get(regionId).states.map((st) => valueFor(st, year)).filter((v) => v !== null);
    return vals.length ? d3.sum(vals) : null;
  }

  function scopeTotal(year) {
    if (selectedRegion) return regionTotal(selectedRegion, year);
    const v = dataset.usTotal[String(year)];
    return typeof v === "number" ? v : null;
  }

  // ======================================================================
  // Stat tiles
  // ======================================================================
  function renderStats() {
    const total = scopeTotal(selectedYear);
    document.getElementById("statTotalLabel").textContent = selectedRegion ? `Total no ${regionLabel(selectedRegion)}` : "Total nos EUA";
    document.getElementById("statTotal").textContent = fmt(total);

    const shareEl = document.getElementById("statShare");
    const us = dataset.usTotal[String(selectedYear)];
    shareEl.hidden = !selectedRegion || typeof total !== "number" || !us;
    if (!shareEl.hidden) shareEl.textContent = pctText(total, us);

    const idx = years.indexOf(selectedYear);
    const prevYear = years.slice(0, idx).reverse().find((y) => scopeTotal(y) !== null);
    const deltaEl = document.getElementById("statDelta");
    if (prevYear !== undefined && typeof total === "number") {
      const prev = scopeTotal(prevYear);
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
    document.getElementById("statTopLabel").textContent = selectedRegion ? "Estado com mais brasileiros na região" : "Estado com mais brasileiros";
    document.getElementById("statCoverageOf").textContent = selectedRegion
      ? `de ${regionById.get(selectedRegion).states.length} no ${regionLabel(selectedRegion)}`
      : "de 51 (50 estados + DC)";
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
            // selectState moves the region filter when the state is outside it
            selectState(compareState === name ? "" : name);
          }),
      (update) => update,
    ).attr("fill", (d) => {
      const v = valueFor(d.properties.name, selectedYear);
      return v === null ? nodata : color(v);
    });

    renderMapRegion();
    renderMapSelection();
    renderMapLegend(dataset.states.some((s) => valueFor(s.state, selectedYear) === null));
  }

  // Fade states outside the chosen region and outline the region itself.
  function renderMapRegion() {
    mapSvg.selectAll("path.state-path").classed("out-region", (d) => !inScope(d.properties.name));
    mapSvg.selectAll("path.region-outline").remove();
    if (selectedRegion) {
      const names = new Set(regionById.get(selectedRegion).states);
      const outline = merge(topo, topo.objects.states.geometries.filter((g) => names.has(g.properties.name)));
      mapSvg.append("path").attr("class", "region-outline").attr("d", path(outline));
    }
    document.getElementById("mapSub").textContent = selectedRegion
      ? `Cor = população nascida no Brasil no ano selecionado. Contorno = ${regionLabel(selectedRegion)}; os demais estados ficam esmaecidos (clique em um deles para mudar de região).`
      : "Cor = população nascida no Brasil no ano selecionado. Passe o mouse para ver o valor.";
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
  // ("Nenhum" in the filter), otherwise the selected state's series.
  function renderLineCharts() {
    const showState = Boolean(compareState);
    document.getElementById("usChartCard").hidden = showState;
    document.getElementById("stateChartCard").hidden = !showState;

    if (!showState) {
      const label = selectedRegion ? regionLabel(selectedRegion) : "Total EUA";
      document.getElementById("usChartTitle").textContent = `Evolução histórica — ${label}`;
      document.getElementById("usChartLead").textContent = selectedRegion
        ? `Soma dos estados do ${label} desde 1990.`
        : "Total nos EUA desde 1990.";
      drawLineChart(d3.select("#lineChart"), {
        label, color: cssVar("--series-1"),
        values: years.map((y) => ({ year: y, value: scopeTotal(y) })),
        shareOfUs: Boolean(selectedRegion),
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

      // break the solid line wherever years are missing from the array itself
      // (e.g. 1990 -> 2000), not only at explicit nulls, so only the dashed
      // connector shows across the gap.
      const pathValues = s.values.flatMap((d, i) => {
        const prev = s.values[i - 1];
        return prev && d.year - prev.year > 1 ? [{ year: d.year, value: null }, d] : [d];
      });

      g.append("path")
        .datum(pathValues)
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
        // snap to every calendar year on the axis, including ones absent from the
        // data (1991-1999), so the tooltip says "sem dado" there like it does for 2020
        const [minYear, maxYear] = d3.extent(years);
        const nearest = Math.min(maxYear, Math.max(minYear, Math.round(yearAtX)));
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
          const us = dataset.usTotal[String(nearest)];
          if (s.shareOfUs && v !== null && us) {
            const shareRow = document.createElement("div");
            shareRow.className = "t-row";
            shareRow.textContent = pctText(v, us);
            wrap.appendChild(shareRow);
          }
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
    // "#" is always the position by population, whatever the current sort.
    const rankByValue = new Map(
      rowsForYear(selectedYear)
        .sort((a, b) => b.value - a.value)
        .map((r, i) => [r.state, i + 1]),
    );

    const rows = rowsForYear(selectedYear)
      .filter((r) => r.state.toLowerCase().includes(searchTerm))
      .sort((a, b) => {
        if (sortKey === "state") return sortDir * a.state.localeCompare(b.state, "pt-BR");
        if (sortKey === "rank") return sortDir * (rankByValue.get(a.state) - rankByValue.get(b.state));
        return sortDir * (a.value - b.value);
      });

    const tbody = document.getElementById("tableBody");
    tbody.replaceChildren();
    for (const r of rows) {
      const tr = document.createElement("tr");
      tr.classList.toggle("state-active", r.state === compareState);
      tr.dataset.state = r.state;
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

    document.querySelectorAll("#rankingTable thead th[data-sort]").forEach((th) => {
      const active = th.dataset.sort === sortKey;
      th.classList.toggle("active", active);
      th.setAttribute("aria-sort", active ? (sortDir === 1 ? "ascending" : "descending") : "none");
      th.querySelector(".sort-ind").textContent = active ? (sortDir === 1 ? "▲" : "▼") : "↕";
    });
    document.getElementById("rankingScope").textContent = selectedRegion ? `${regionLabel(selectedRegion)} — ` : "";
    document.getElementById("rankingSortNote").textContent =
      `Ordenado por ${sortNotes[sortKey][sortDir === 1 ? 0 : 1]}.${selectedRegion ? " # = posição dentro da região." : ""} Clique nos cabeçalhos para mudar.`;
  }

  // First click on a column uses its natural direction; clicking again flips it.
  const firstSortDir = { rank: 1, state: 1, value: -1 };
  const sortNotes = {
    rank: ["posição (1º → último)", "posição (último → 1º)"],
    state: ["estado (A → Z)", "estado (Z → A)"],
    value: ["população (menor → maior)", "população (maior → menor)"],
  };

  document.querySelectorAll("#rankingTable thead th[data-sort]").forEach((th) => {
    const ind = document.createElement("span");
    ind.className = "sort-ind";
    ind.setAttribute("aria-hidden", "true");
    th.appendChild(ind);
    th.title = "Clique para ordenar";
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      sortDir = sortKey === key ? -sortDir : firstSortDir[key];
      sortKey = key;
      renderTable();
    });
  });

  // Center the selected state's row inside the ranking's own scroll box.
  function scrollRanking({ behavior = "smooth" } = {}) {
    if (!compareState) return;
    const box = document.querySelector(".table-scroll");
    const tr = [...document.querySelectorAll("#tableBody tr[data-state]")].find((row) => row.dataset.state === compareState);
    if (!tr) return;
    const boxRect = box.getBoundingClientRect();
    const r = tr.getBoundingClientRect();
    box.scrollTo({ top: box.scrollTop + (r.top - boxRect.top) - (box.clientHeight - r.height) / 2, behavior });
  }

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

    for (const region of REGIONS) {
      if (selectedRegion && region.id !== selectedRegion) continue;
      const statesSorted = dataset.states
        .filter((s) => regionOfState.get(s.state) === region.id)
        .sort((a, b) => a.state.localeCompare(b.state, "pt-BR"));
      for (const s of statesSorted) body.appendChild(stateRow(s));

      const trRegion = document.createElement("tr");
      trRegion.className = "region-row";
      trRegion.classList.toggle("state-active", selectedRegion === region.id && !compareState);
      const tdRegion = document.createElement("td");
      tdRegion.textContent = `Total ${regionLabel(region.id)}`;
      tdRegion.className = "state-name";
      tdRegion.title = "Clique para filtrar por esta região";
      tdRegion.addEventListener("click", () => selectRegion(region.id, { clearState: true }));
      trRegion.appendChild(tdRegion);
      for (const yr of years) {
        const td = document.createElement("td");
        const v = regionTotal(region.id, yr);
        td.textContent = v === null ? "—" : fmt(v);
        if (v === null) td.classList.add("no-data");
        if (yr === selectedYear) td.classList.add("year-active");
        trRegion.appendChild(td);
      }
      body.appendChild(trRegion);
    }

    function stateRow(s) {
      const tr = document.createElement("tr");
      tr.classList.toggle("state-active", s.state === compareState);
      tr.dataset.state = s.state;

      const tdName = document.createElement("td");
      tdName.textContent = s.state;
      tdName.className = "state-name";
      tdName.title = "Clique para destacar no mapa e no gráfico";
      tdName.addEventListener("click", () => {
        selectState(compareState === s.state ? "" : s.state);
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
      return tr;
    }

    const trTotal = document.createElement("tr");
    trTotal.className = "total-row";
    // the US total is the "no state" selection, same as "Nenhum" in the dropdown
    trTotal.classList.toggle("state-active", !compareState && !selectedRegion);
    const tdLabel = document.createElement("td");
    tdLabel.textContent = "Total EUA";
    tdLabel.className = "state-name";
    tdLabel.title = "Clique para ver o total dos EUA no gráfico";
    tdLabel.addEventListener("click", () => selectRegion("", { clearState: true }));
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

  // Scroll only the table's own box (never the page): the selected year's
  // column lands at the right edge (earlier years to its left) and the
  // selected state's row is centered vertically.
  function scrollFullTable({ toState = true, toYear = false, behavior = "smooth" } = {}) {
    const box = document.querySelector(".full-table-scroll");
    const boxRect = box.getBoundingClientRect();
    const target = { behavior };

    const th = toYear && document.querySelector(`#fullTableHead th[data-year="${selectedYear}"]`);
    if (th) {
      const r = th.getBoundingClientRect();
      // 40px spare so a column that isn't the last one clears the right-edge fade
      target.left = box.scrollLeft + (r.right - boxRect.left) - box.clientWidth + 40;
    }
    if (toState && compareState) {
      const tr = [...document.querySelectorAll("#fullTableBody tr[data-state]")].find((row) => row.dataset.state === compareState);
      if (tr) {
        const r = tr.getBoundingClientRect();
        target.top = box.scrollTop + (r.top - boxRect.top) - (box.clientHeight - r.height) / 2;
      }
    }
    box.scrollTo(target);
    updateFullTableEdges();
  }

  // Toggle the left/right "more years" hints on the table wrapper, and keep
  // the right fade clear of the scrollbars.
  function updateFullTableEdges() {
    const box = document.querySelector(".full-table-scroll");
    const wrap = box.parentElement;
    const maxLeft = box.scrollWidth - box.clientWidth;
    wrap.classList.toggle("more-left", box.scrollLeft > 1);
    wrap.classList.toggle("more-right", box.scrollLeft < maxLeft - 1);
    wrap.style.setProperty("--sb-y", `${box.offsetWidth - box.clientWidth - 2}px`);
    wrap.style.setProperty("--sb-x", `${box.offsetHeight - box.clientHeight - 2}px`);
  }
  document.querySelector(".full-table-scroll").addEventListener("scroll", updateFullTableEdges, { passive: true });
  addEventListener("resize", updateFullTableEdges);

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
    scrollFullTable({ toYear: true, behavior: "auto" });
  }

  yearSelect.addEventListener("change", () => {
    selectedYear = Number(yearSelect.value);
    document.querySelectorAll(".yearInline").forEach((el) => (el.textContent = String(selectedYear)));
    renderStats();
    renderMap();
    renderTable();
    renderFullTable();
    scrollRanking();
    scrollFullTable({ toState: false, toYear: true });
  });

  // Single entry point for choosing a state, whether it comes from the
  // dropdown, the map or the full history table.
  function selectState(name) {
    // a state outside the current region moves the region filter to its region
    if (name && !inScope(name)) {
      selectRegion(regionOfState.get(name), { state: name });
      return;
    }
    compareState = name;
    stateSelect.value = compareState;
    // a search that hides the chosen state would leave nothing highlighted
    if (compareState && !compareState.toLowerCase().includes(searchTerm)) {
      searchTerm = "";
      document.getElementById("tableSearch").value = "";
    }
    renderMapSelection();
    renderLineCharts();
    renderTable();
    renderFullTable();
    scrollRanking();
    scrollFullTable();
  }

  stateSelect.addEventListener("change", () => selectState(stateSelect.value));

  // The region narrows every view; a chosen state outside it is dropped.
  function selectRegion(id, { state = compareState, clearState = false } = {}) {
    selectedRegion = id;
    regionSelect.value = id;
    compareState = clearState || (state && !inScope(state)) ? "" : state;
    if (compareState && !compareState.toLowerCase().includes(searchTerm)) {
      searchTerm = "";
      document.getElementById("tableSearch").value = "";
    }
    fillStateSelect();
    renderAll();
    scrollRanking({ behavior: "auto" });
    scrollFullTable({ toYear: true, behavior: "auto" });
  }

  regionSelect.addEventListener("change", () => selectRegion(regionSelect.value));

  fillStateSelect();
  renderAll();
}

main().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML(
    "beforeend",
    `<p style="color:#d03b3b;padding:20px">Falha ao carregar o dashboard: ${String(err.message ?? err)}</p>`,
  );
});
