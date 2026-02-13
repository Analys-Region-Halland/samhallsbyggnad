// =============================================================================
// BEESWARM FACET - Facetterat svärm-diagram per region med filter
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "./exportSvg.js";
import { createFilterState, createSelectorPanel } from "./filterUtils.js";

export function beeswarmFacet(data, {
  value = "värde",
  label = "namn",
  facet = "region",
  width = null,
  rowHeight = 38,
  title = null,
  subtitle = null,
  caption = null,
  xLabel = null,
  highlight = null,
  filter = null,
  highlightColor = "#00664D",
  mutedColor = "#a09d98",
  lineColor = "#d5d0c8",
  minRadius = 2.5,
  maxRadius = 7,
  highlightBoost = 1,
  padding = 1.2,
  logScale = true,
  showGrid = true,
  vline = null,
  sort = "median",
  formatValue = d => d.toLocaleString("sv-SE"),
  interactive = false,
  altText = null,
  info = null,
  logo = null
} = {}) {

  const autoWidth = width || 780;
  const marginLeft = 120;
  const marginRight = 45;
  const xAxisHeight = 30;
  const bottomPadding = 10;

  // ================================================================
  // CONTAINER + HEADER
  // ================================================================
  const container = d3.create("div")
    .attr("class", "graf-container")
    .style("position", "relative");

  const header = container.append("div")
    .attr("class", "graf-header");

  if (title) {
    header.append("div")
      .attr("class", "graf-title")
      .text(title);
  }

  if (subtitle) {
    header.append("div")
      .attr("class", "graf-subtitle")
      .text(subtitle);
  }

  // ================================================================
  // COMPUTE MEDIANS, COUNTS & SORT
  // ================================================================
  const facetGroups = d3.group(data, d => d[facet]);
  const facetMedians = new Map();
  const facetCounts = new Map();
  for (const [name, rows] of facetGroups) {
    facetMedians.set(name, d3.median(rows, d => d[value]));
    facetCounts.set(name, rows.length);
  }

  const facetMaxes = new Map();
  for (const [name, rows] of facetGroups) {
    facetMaxes.set(name, d3.max(rows, d => d[value]));
  }

  const sortedFacetNames = [...facetGroups.keys()];
  if (sort === "max") {
    sortedFacetNames.sort((a, b) => d3.descending(facetMaxes.get(a), facetMaxes.get(b)));
  } else if (sort === "median") {
    sortedFacetNames.sort((a, b) => d3.descending(facetMedians.get(a), facetMedians.get(b)));
  } else {
    sortedFacetNames.sort((a, b) => a.localeCompare(b, 'sv'));
  }

  const allFacetNames = [...facetGroups.keys()].sort((a, b) => a.localeCompare(b, 'sv'));

  // ================================================================
  // FILTER STATE
  // ================================================================
  const facetData = allFacetNames.map(name => ({ [facet]: name }));

  const filterState = createFilterState(facetData, {
    itemField: facet,
    groupField: null,
    filter,
    highlight
  });

  const isHlFacet = name => filterState.isHighlighted(name);

  const facetColorScale = () => highlightColor;

  // ================================================================
  // SELECTOR PANEL
  // ================================================================
  let selectorCtrl = null;

  if (interactive) {
    selectorCtrl = createSelectorPanel(header, {
      filterState,
      allItems: allFacetNames,
      colorScale: facetColorScale,
      triggerText: "Jämför regioner \u203a",
      columns: 3,
      onUpdate: () => updateChart(),
      onItemHover: (facetName) => highlightRow(facetName, true),
      onItemLeave: (facetName) => highlightRow(facetName, false)
    });
  }

  // Value display
  const valueDisplay = container.append("div")
    .attr("class", "graf-value-display")
    .html("<span style='opacity:0.35'>Peka för värden</span>");

  // ================================================================
  // FACET LAYOUT (sorted order, uniform row height)
  // ================================================================
  let currentY = xAxisHeight;
  const facetLayout = [];

  for (const name of sortedFacetNames) {
    facetLayout.push({
      name,
      y: currentY,
      height: rowHeight,
      centerY: currentY + rowHeight / 2,
      median: facetMedians.get(name),
      count: facetCounts.get(name)
    });
    currentY += rowHeight;
  }

  const totalHeight = currentY + bottomPadding;

  // ================================================================
  // SVG
  // ================================================================
  const svgContainer = container.append("div")
    .attr("class", "graf-svg-container");

  const svg = svgContainer.append("svg")
    .attr("viewBox", `0 0 ${autoWidth} ${totalHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("class", "graf-svg");

  // ================================================================
  // X-SCALE + RADIUS SCALE
  // ================================================================
  const valueExtent = d3.extent(data, d => d[value]);

  const xScale = logScale
    ? d3.scaleLog()
        .domain([Math.max(1, valueExtent[0] * 0.75), valueExtent[1] * 1.15])
        .range([marginLeft, autoWidth - marginRight])
    : d3.scaleLinear()
        .domain([0, valueExtent[1] * 1.05])
        .range([marginLeft, autoWidth - marginRight]);

  const radiusScale = d3.scaleSqrt()
    .domain(valueExtent)
    .range([minRadius, maxRadius]);

  // ================================================================
  // FORCE SIMULATION PER FACET (variable collision radii)
  // ================================================================
  for (const fl of facetLayout) {
    const rowData = data.filter(d => d[facet] === fl.name);

    const nodes = rowData.map(d => ({
      ...d,
      x: xScale(d[value]),
      y: fl.centerY,
      r: radiusScale(d[value])
    }));

    const sim = d3.forceSimulation(nodes)
      .force("x", d3.forceX(d => xScale(d[value])).strength(0.95))
      .force("y", d3.forceY(fl.centerY).strength(0.7))
      .force("collide", d3.forceCollide(d => d.r + highlightBoost + padding).iterations(4))
      .stop();

    for (let i = 0; i < 200; i++) sim.tick();

    nodes.forEach(n => {
      const clampR = n.r + highlightBoost;
      n.y = Math.max(fl.y + clampR + 1, Math.min(fl.y + fl.height - clampR - 1, n.y));
    });

    fl.nodes = nodes;

    const xPositions = nodes.map(n => n.x);
    fl.rangeMinX = d3.min(xPositions);
    fl.rangeMaxX = d3.max(xPositions);
  }

  const allNodes = facetLayout.flatMap(fl => fl.nodes);

  // ================================================================
  // TICK VALUES
  // ================================================================
  const axisTickValues = logScale
    ? [5000, 10000, 50000, 100000, 500000]
        .filter(v => v >= valueExtent[0] * 0.5 && v <= valueExtent[1] * 1.5)
    : xScale.ticks(5);

  // ================================================================
  // STATIC ELEMENTS: grid, separators, axis
  // ================================================================

  // Grid lines
  if (showGrid) {
    const gridGroup = svg.append("g");
    axisTickValues.forEach(v => {
      const x = xScale(v);
      if (x >= marginLeft && x <= autoWidth - marginRight) {
        gridGroup.append("line")
          .attr("x1", x).attr("x2", x)
          .attr("y1", xAxisHeight)
          .attr("y2", totalHeight - bottomPadding)
          .attr("stroke", "#e8e5e0")
          .attr("stroke-width", 0.5);
      }
    });
  }

  // Vertikal referenslinje
  if (vline !== null) {
    const vlineConfig = typeof vline === "number" ? { value: vline } : vline;
    const vlineX = xScale(vlineConfig.value);
    const vlineColor = vlineConfig.color || "#666";
    const vlineDashed = vlineConfig.dashed !== false;

    if (vlineX >= marginLeft && vlineX <= autoWidth - marginRight) {
      svg.append("line")
        .attr("x1", vlineX).attr("x2", vlineX)
        .attr("y1", xAxisHeight).attr("y2", totalHeight - bottomPadding)
        .attr("stroke", vlineColor).attr("stroke-width", 1)
        .attr("stroke-dasharray", vlineDashed ? "4,3" : "none")
        .attr("stroke-opacity", 0.6);

      if (vlineConfig.label) {
        svg.append("text")
          .attr("x", vlineX).attr("y", xAxisHeight - 6)
          .attr("text-anchor", "middle")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .attr("font-size", "10px").attr("font-weight", "500")
          .attr("fill", vlineColor)
          .text(vlineConfig.label);
      }
    }
  }

  // Row separators
  facetLayout.forEach((fl, i) => {
    if (i === 0) return;
    svg.append("line")
      .attr("x1", marginLeft - 8)
      .attr("x2", autoWidth - marginRight + 8)
      .attr("y1", fl.y)
      .attr("y2", fl.y)
      .attr("stroke", "#e0ddd7")
      .attr("stroke-width", 0.5);
  });

  // X-axis
  const tickFormat = d => {
    if (d >= 1000000) return (d / 1e6) + " mn";
    if (d >= 1000) return (d / 1000) + " k";
    return d;
  };

  const xAxis = logScale
    ? d3.axisTop(xScale).tickValues(axisTickValues).tickFormat(tickFormat)
    : d3.axisTop(xScale).ticks(5).tickFormat(tickFormat);

  svg.append("g")
    .attr("transform", `translate(0,${xAxisHeight})`)
    .call(xAxis)
    .call(g => g.select(".domain")
      .attr("stroke", "#ccc")
      .attr("stroke-width", 0.5))
    .call(g => g.selectAll(".tick line")
      .attr("stroke", "#ccc")
      .attr("y2", -4))
    .call(g => g.selectAll(".tick text")
      .attr("fill", "#555")
      .attr("font-size", "11px")
      .attr("font-family", "'IBM Plex Sans', sans-serif"));

  if (xLabel) {
    svg.append("text")
      .attr("x", (marginLeft + autoWidth - marginRight) / 2)
      .attr("y", 10)
      .attr("text-anchor", "middle")
      .attr("font-family", "'IBM Plex Sans', sans-serif")
      .attr("font-size", "10px")
      .attr("fill", "#888")
      .text(xLabel);
  }

  // ================================================================
  // DYNAMIC GROUPS (redrawn on updateChart)
  // ================================================================
  const rowBgGroup = svg.append("g").attr("class", "row-bg");
  const rangeGroup = svg.append("g").attr("class", "range-lines");
  const medianGroup = svg.append("g").attr("class", "median-markers");
  const decorGroup = svg.append("g").attr("class", "row-decor");
  const labelGroup = svg.append("g").attr("class", "facet-labels");
  const countGroup = svg.append("g").attr("class", "facet-counts");
  const dotsGroup = svg.append("g").attr("class", "dots");

  // ================================================================
  // ROW HOVER STATE
  // ================================================================
  let hoveredFacet = null;

  function highlightRow(facetName, show) {
    if (show) {
      hoveredFacet = facetName;
    } else if (hoveredFacet === facetName) {
      hoveredFacet = null;
    }
    rowBgGroup.selectAll("rect")
      .attr("fill", d => {
        if (d.name === hoveredFacet) return "#f5f3f0";
        if (isHlFacet(d.name)) return "rgba(0,102,77,0.04)";
        return d.zebra ? "rgba(0,0,0,0.02)" : "transparent";
      });
    labelGroup.selectAll("text")
      .attr("font-weight", function() {
        const name = d3.select(this).attr("data-facet");
        if (name === hoveredFacet) return 700;
        return isHlFacet(name) ? 700 : 400;
      })
      .attr("fill", function() {
        const name = d3.select(this).attr("data-facet");
        if (name === hoveredFacet) return "#1a1a1a";
        return isHlFacet(name) ? "#1a1a1a" : "#777";
      });
  }

  // ================================================================
  // UPDATE CHART - redraws dynamic elements
  // ================================================================
  function updateChart() {
    rowBgGroup.selectAll("*").remove();
    rangeGroup.selectAll("*").remove();
    medianGroup.selectAll("*").remove();
    decorGroup.selectAll("*").remove();
    labelGroup.selectAll("*").remove();
    countGroup.selectAll("*").remove();
    dotsGroup.selectAll("*").remove();

    // --- Row backgrounds (zebra + highlight tint) ---
    rowBgGroup.selectAll("rect")
      .data(facetLayout.map((fl, i) => ({ ...fl, zebra: i % 2 === 1 })))
      .join("rect")
      .attr("x", 0)
      .attr("y", d => d.y)
      .attr("width", autoWidth)
      .attr("height", d => d.height)
      .attr("fill", d => {
        if (isHlFacet(d.name)) return "rgba(0,102,77,0.04)";
        return d.zebra ? "rgba(0,0,0,0.02)" : "transparent";
      });

    // --- Range lines ---
    for (const fl of facetLayout) {
      const isHl = isHlFacet(fl.name);
      rangeGroup.append("line")
        .attr("x1", fl.rangeMinX)
        .attr("x2", fl.rangeMaxX)
        .attr("y1", fl.centerY)
        .attr("y2", fl.centerY)
        .attr("stroke", isHl ? highlightColor : lineColor)
        .attr("stroke-width", isHl ? 1.5 : 1)
        .attr("stroke-opacity", isHl ? 0.3 : 0.5);
    }

    // --- Median markers ---
    for (const fl of facetLayout) {
      const isHl = isHlFacet(fl.name);
      const medianX = xScale(fl.median);
      const markerH = isHl ? 18 : 14;
      medianGroup.append("line")
        .attr("x1", medianX).attr("x2", medianX)
        .attr("y1", fl.centerY - markerH / 2)
        .attr("y2", fl.centerY + markerH / 2)
        .attr("stroke", isHl ? highlightColor : "#888")
        .attr("stroke-width", isHl ? 2 : 1.5)
        .attr("stroke-opacity", isHl ? 0.8 : 0.4)
        .attr("stroke-linecap", "round");
    }

    // --- Accent bar for highlighted rows ---
    for (const fl of facetLayout) {
      if (isHlFacet(fl.name)) {
        decorGroup.append("line")
          .attr("x1", marginLeft - 6).attr("x2", marginLeft - 6)
          .attr("y1", fl.y + 4).attr("y2", fl.y + fl.height - 4)
          .attr("stroke", highlightColor)
          .attr("stroke-width", 2.5)
          .attr("stroke-linecap", "round");
      }
    }

    // --- Facet labels ---
    for (const fl of facetLayout) {
      const isHl = isHlFacet(fl.name);
      labelGroup.append("text")
        .attr("data-facet", fl.name)
        .attr("x", marginLeft - 12)
        .attr("y", fl.centerY)
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "central")
        .attr("font-family", "'IBM Plex Sans', sans-serif")
        .attr("font-size", isHl ? "12px" : "11px")
        .attr("font-weight", isHl ? 700 : 400)
        .attr("fill", isHl ? "#1a1a1a" : "#777")
        .text(fl.name);
    }

    // --- Count annotations (right side) ---
    for (const fl of facetLayout) {
      countGroup.append("text")
        .attr("x", autoWidth - 6)
        .attr("y", fl.centerY)
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "central")
        .attr("font-family", "'IBM Plex Sans', sans-serif")
        .attr("font-size", "9px")
        .attr("fill", "#aaa")
        .text(`n=${fl.count}`);
    }

    // --- Dots: muted first, then highlighted on top ---
    for (const fl of facetLayout) {
      if (isHlFacet(fl.name)) continue;
      dotsGroup.selectAll(null)
        .data(fl.nodes)
        .join("circle")
        .attr("cx", d => d.x).attr("cy", d => d.y)
        .attr("r", d => d.r)
        .attr("fill", mutedColor)
        .attr("fill-opacity", 0.55)
        .attr("stroke", "#8a8680")
        .attr("stroke-width", 0.5)
        .attr("stroke-opacity", 0.3);
    }

    for (const fl of facetLayout) {
      if (!isHlFacet(fl.name)) continue;
      dotsGroup.selectAll(null)
        .data(fl.nodes)
        .join("circle")
        .attr("cx", d => d.x).attr("cy", d => d.y)
        .attr("r", d => d.r + highlightBoost)
        .attr("fill", highlightColor)
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5);
    }

    if (selectorCtrl) selectorCtrl.update();
  }

  // Initial render
  updateChart();

  // ================================================================
  // HOVER INTERACTION
  // ================================================================
  const highlightRing = svg.append("circle")
    .attr("fill", "none")
    .attr("stroke", "#1a1a1a")
    .attr("stroke-width", 1.5)
    .style("opacity", 0)
    .style("pointer-events", "none");

  svg.append("rect")
    .attr("x", 0)
    .attr("y", xAxisHeight)
    .attr("width", autoWidth)
    .attr("height", totalHeight - xAxisHeight - bottomPadding)
    .attr("fill", "transparent")
    .style("cursor", "default")
    .on("mousemove", function(event) {
      const [mx, my] = d3.pointer(event);

      const hoveredRow = facetLayout.find(fl => my >= fl.y && my < fl.y + fl.height);
      const newHoveredFacet = hoveredRow ? hoveredRow.name : null;

      if (newHoveredFacet !== hoveredFacet) {
        if (hoveredFacet) highlightRow(hoveredFacet, false);
        if (newHoveredFacet) highlightRow(newHoveredFacet, true);
      }

      let closest = null;
      let minDist = Infinity;
      for (const node of allNodes) {
        const dist = Math.sqrt((mx - node.x) ** 2 + (my - node.y) ** 2);
        if (dist < minDist) {
          minDist = dist;
          closest = node;
        }
      }

      if (closest && minDist < 25) {
        const isHl = isHlFacet(closest[facet]);
        const dotColor = isHl ? highlightColor : "#666";
        const r = closest.r + (isHl ? highlightBoost : 0);

        highlightRing
          .attr("cx", closest.x)
          .attr("cy", closest.y)
          .attr("r", r + 3)
          .attr("stroke", dotColor)
          .style("opacity", 1);

        const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};margin-right:5px;vertical-align:middle"></span>`;
        valueDisplay.html(
          `<span style="display:inline-flex;align-items:center;justify-content:center;width:100%">`
          + `${dot}<b style="margin-right:6px">${closest[label]}</b>`
          + `<span style="opacity:0.2;margin-right:6px">\u2502</span>`
          + `<span style="opacity:0.6;margin-right:6px">${closest[facet]}</span>`
          + `<span style="opacity:0.2;margin-right:6px">\u2502</span>`
          + `<b>${formatValue(closest[value])}</b></span>`
        );
      } else {
        highlightRing.style("opacity", 0);
        valueDisplay.html("<span style='opacity:0.35'>Peka för värden</span>");
      }
    })
    .on("mouseleave", () => {
      if (hoveredFacet) highlightRow(hoveredFacet, false);
      highlightRing.style("opacity", 0);
      valueDisplay.html("<span style='opacity:0.35'>Peka för värden</span>");
    });

  // ================================================================
  // CAPTION + EXPORT
  // ================================================================
  if (caption) {
    container.append("div")
      .attr("class", "graf-caption")
      .text(caption);
  }

  addExportButton(container, svg.node(), {
    title, subtitle, caption,
    width: autoWidth,
    height: totalHeight,
    altText, info, logo
  });

  return container.node();
}
