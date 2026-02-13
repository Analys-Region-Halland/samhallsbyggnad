// =============================================================================
// LOLLIPOP - Universell D3-komponent (vertikal och horisontell)
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "./exportSvg.js";
import { createFilterState, createSelectorPanel } from "./filterUtils.js";

// Hjälpfunktion: beräkna snyggt intervall och max för y-axeln
function niceScale(dataMax, targetTicks = 5) {
  if (dataMax <= 0) return { max: 10, interval: 2, ticks: [0, 2, 4, 6, 8, 10] };

  const roughInterval = dataMax / targetTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughInterval)));
  const normalized = roughInterval / magnitude;

  let niceInterval;
  if (normalized <= 1) niceInterval = 1;
  else if (normalized <= 2) niceInterval = 2;
  else if (normalized <= 2.5) niceInterval = 2.5;
  else if (normalized <= 5) niceInterval = 5;
  else niceInterval = 10;

  const interval = niceInterval * magnitude;
  const max = Math.ceil(dataMax / interval) * interval;

  const ticks = [];
  for (let v = 0; v <= max; v += interval) {
    ticks.push(v);
  }

  return { max, interval, ticks };
}

export function lollipop(data, {
  x = "kategori",
  y = "värde",
  color = null,
  width = null,
  height = 500,
  title = null,
  subtitle = null,
  caption = null,
  xLabel = null,
  yLabel = null,
  colors = ["#00664D", "#004990", "#FF7E00", "#433C9D", "#2DB8F6", "#A51300"],
  formatY = d => d.toLocaleString("sv-SE"),
  horizontal = false,
  pointRadius = 6,
  lineWidth = 2,
  showGrid = true,
  altText = null,
  info = null,
  logo = null,
  interactive = false,
  filter = null,          // Begränsa valbara items (gruppnamn eller individuella)
  highlight = null,
  vline = null            // { value, label? } — vertikal referenslinje (horisontell lollipop)
} = {}) {

  const filterState = createFilterState(data, { itemField: x, groupField: color, filter, highlight });

  // Kategorier och grupper
  const categories = [...new Set(data.map(d => d[x]))];
  const groups = color ? [...new Set(data.map(d => d[color]))] : ["_all"];

  // Beräkna värde-max
  const dataMax = d3.max(data, d => d[y]);
  const valueNice = niceScale(dataMax, 5);

  // Dimensioner - tydlig breakout-effekt
  // Best practice: ~48px per kategori för god läsbarhet
  const autoWidth = width || 780;
  const marginTop = yLabel ? 36 : 20;
  const marginRight = (color && !interactive) ? 105 : 40;
  const marginBottom = horizontal ? (xLabel ? 58 : 48) : (xLabel ? 62 : 52);

  // Dynamisk höjd för horisontell: 48px per kategori, min 240px, max 600px
  const pixelsPerCategory = 48;
  const dynamicHeight = horizontal
    ? Math.min(600, Math.max(240, marginTop + marginBottom + categories.length * pixelsPerCategory))
    : height;

  // För horisontell: beräkna marginal för högerjusterade etiketter
  // Linjerar med titel/undertitel (14px från vänster)
  let marginLeft = 14;
  if (horizontal) {
    const maxLabelLength = Math.max(...categories.map(c => String(c).length));
    marginLeft = 16 + maxLabelLength * 8 + 10;
  }

  const maxTickWidth = formatY(valueNice.max).length * 6 + 8;
  const axisLeft = horizontal ? marginLeft : marginLeft + maxTickWidth;

  // Färgskala
  const colorScale = d3.scaleOrdinal()
    .domain(groups)
    .range(colors);


  // Skapa wrapper-container
  const container = d3.create("div")
    .attr("class", "graf-container")
    .attr("data-base-width", autoWidth);

  // Header
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

  // ==========================================================================
  // INTERAKTIV HIGHLIGHT-VÄLJARE (via filterUtils)
  // ==========================================================================
  const mutedColor = "#d0d0d0";

  const isHighlighted = (cat) => filterState.isHighlighted(cat);

  const getCategoryColor = (cat, groupKey = "_all") => {
    if (!isHighlighted(cat)) return mutedColor;
    return colorScale(groupKey);
  };

  let selectorCtrl = null;
  if (interactive) {
    selectorCtrl = createSelectorPanel(header, {
      filterState,
      allItems: categories,
      colorScale: color ? colorScale : () => colors[0],
      triggerText: "Markera \u203a",
      onUpdate: () => updateLollipopsAll()
    });
  }

  // Smart toggle: samma logik som selector-panelen
  const smartToggle = (item, allItems) => {
    const hl = filterState.getHighlight();
    const selectable = filterState.filterSet || allItems;
    const allOn = !hl || selectable.every(i => hl.includes(i));
    if (allOn) {
      if (hl) hl.forEach(c => { if (c !== item) filterState.toggle(c); });
      if (!filterState.isHighlighted(item) || !filterState.getHighlight()) filterState.toggle(item);
    } else {
      filterState.toggle(item);
    }
  };

  // Wrapper som anropar rätt updateLollipops beroende på orientering
  let updateLollipopsAll = null;

  // Värde-display för hover
  const valueDisplay = container.append("div")
    .attr("class", "graf-value-display")
    .html("<span style='opacity:0.35'>Peka för värden</span>");

  // SVG-container
  const svgContainer = container.append("div")
    .attr("class", "graf-svg-container");

  // Använd dynamisk höjd för horisontell
  const chartHeight = horizontal ? dynamicHeight : height;

  const svg = svgContainer.append("svg")
    .attr("viewBox", `0 0 ${autoWidth} ${chartHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("class", "graf-svg");

  // Hjälpfunktion för hover
  const showValue = (category, value, groupKey) => {
    const groupLabel = groupKey !== "_all" ? groupKey : "";
    const chips = `<span style="display:inline-flex;align-items:center;margin:0 8px"><span style="width:7px;height:7px;border-radius:50%;background:${colorScale(groupKey)};margin-right:5px;flex-shrink:0"></span>${groupLabel ? `<span style="color:#666;margin-right:4px">${groupLabel}</span>` : ""}<b>${formatY(value)}</b></span>`;
    valueDisplay.html(`<span style="display:inline-flex;align-items:center;justify-content:center;width:100%"><b style="margin-right:8px">${category}</b><span style="opacity:0.2;margin-right:8px">│</span>${chips}</span>`);
  };

  const hideValue = () => {
    valueDisplay.html("<span style='opacity:0.35'>Peka för värden</span>");
  };

  if (horizontal) {
    // =======================================================================
    // HORISONTELL LOLLIPOP - Ren, modern design med zebra-rader
    // =======================================================================

    // Sortera data efter värde (högst först) för bättre läsbarhet
    const sortedData = [...data].sort((a, b) => b[y] - a[y]);
    const sortedCategories = sortedData.map(d => d[x]);

    // Padding 0.33 ger ~2:1 ratio (bar:space) enligt Stephen Few
    const yScale = d3.scaleBand()
      .domain(sortedCategories)
      .range([marginTop, chartHeight - marginBottom])
      .padding(0.33);

    const xScale = d3.scaleLinear()
      .domain([0, valueNice.max])
      .range([axisLeft, autoWidth - marginRight]);

    // Alternerande radbakgrunder (zebra) - linjerar med titel (18px)
    sortedCategories.forEach((cat, i) => {
      if (i % 2 === 0) {
        svg.append("rect")
          .attr("x", 18)
          .attr("y", yScale(cat))
          .attr("width", autoWidth - 36) // 18px marginal på varje sida
          .attr("height", yScale.bandwidth())
          .attr("fill", "#f8f8f8")
          .attr("rx", 3); // Lätt rundade hörn
      }
    });

    // X-axel (värden) - OWID-stil (ingen grid för horisontell - zebra räcker)
    svg.append("g")
      .attr("transform", `translate(0,${chartHeight - marginBottom})`)
      .call(d3.axisBottom(xScale).tickFormat(formatY).tickValues(valueNice.ticks).tickSize(0))
      .call(g => g.select(".domain").remove())
      .call(g => g.selectAll(".tick text")
        .attr("fill", "#666")
        .attr("font-size", "12px")
        .attr("font-family", "'IBM Plex Sans', sans-serif"));

    // X-label
    if (xLabel) {
      svg.append("text")
        .attr("x", axisLeft + (autoWidth - marginRight - axisLeft) / 2)
        .attr("y", chartHeight - 8)
        .attr("text-anchor", "middle")
        .attr("class", "graf-axis-label")
        .text(xLabel);
    }

    // Vertikal referenslinje (vline) — ritas bakom lollipops
    if (vline) {
      const vx = xScale(vline.value);
      svg.append("line")
        .attr("x1", vx).attr("x2", vx)
        .attr("y1", marginTop).attr("y2", chartHeight - marginBottom)
        .attr("stroke", "#1a1a1a").attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "8,4").attr("stroke-opacity", 0.35);
      if (vline.label) {
        svg.append("text")
          .attr("x", vx).attr("y", marginTop - 6)
          .attr("text-anchor", "middle")
          .attr("font-size", "11px").attr("fill", "#666")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .text(vline.label);
      }
    }

    // Grupp för lollipops (för uppdatering)
    const lollipopsGroup = svg.append("g").attr("class", "lollipops-group");

    // Funktion för att rita/uppdatera lollipops
    function updateLollipops() {
      lollipopsGroup.selectAll("*").remove();

      sortedData.forEach(d => {
        const groupKey = color ? d[color] : "_all";
        const yPos = yScale(d[x]) + yScale.bandwidth() / 2;
        const labelText = String(d[x]);
        const barColor = getCategoryColor(d[x], groupKey);
        const isHl = isHighlighted(d[x]);

        // Högerjusterad etikett
        lollipopsGroup.append("text")
          .attr("x", axisLeft - 10)
          .attr("y", yPos)
          .attr("dy", "0.35em")
          .attr("text-anchor", "end")
          .attr("fill", isHl ? "#1a1a1a" : "#999")
          .attr("font-size", "13px")
          .attr("font-weight", isHl ? "500" : "400")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .text(labelText);

        // Huvudlinje (lollipop) med rundade ändar
        lollipopsGroup.append("line")
          .attr("x1", axisLeft)
          .attr("x2", xScale(d[y]))
          .attr("y1", yPos)
          .attr("y2", yPos)
          .attr("stroke", barColor)
          .attr("stroke-width", lineWidth + 1)
          .attr("stroke-linecap", "round");

        // Punkt med subtil skugga
        lollipopsGroup.append("circle")
          .attr("data-category", d[x])
          .attr("cx", xScale(d[y]))
          .attr("cy", yPos)
          .attr("r", pointRadius + 1)
          .attr("fill", barColor)
          .attr("stroke", "#fff")
          .attr("stroke-width", 2.5)
          .style("cursor", "pointer")
          .on("mouseenter", function() {
            d3.select(this).attr("r", pointRadius + 3);
            showValue(d[x], d[y], groupKey);
          })
          .on("mouseleave", function() {
            d3.select(this).attr("r", pointRadius + 1);
            hideValue();
          })
          .on("click", function() {
            smartToggle(d[x], categories);
            updateLollipops();
          });

        // Värde-etikett vid punkten
        lollipopsGroup.append("text")
          .attr("x", xScale(d[y]) + pointRadius + 6)
          .attr("y", yPos)
          .attr("dy", "0.35em")
          .attr("text-anchor", "start")
          .attr("fill", isHl ? "#666" : "#aaa")
          .attr("font-size", "12px")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .text(formatY(d[y]));
      });

      // Uppdatera väljaren
      if (selectorCtrl) selectorCtrl.update();
    }

    updateLollipopsAll = updateLollipops;

    // Initial rendering
    updateLollipops();

    // Panel hover → chart highlight
    if (selectorCtrl) {
      const panelGrid = selectorCtrl.element.select(".graf-selector-grid");
      panelGrid.node().addEventListener("mouseover", (event) => {
        const opt = event.target.closest(".graf-selector-option");
        if (!opt) {
          lollipopsGroup.selectAll("circle[data-category]").attr("r", pointRadius + 1).attr("stroke", "#fff").attr("stroke-width", 2.5);
          hideValue();
          return;
        }
        const catName = opt.querySelector(".opt-name")?.textContent;
        if (catName) {
          lollipopsGroup.selectAll("circle[data-category]").each(function() {
            const el = d3.select(this);
            if (el.attr("data-category") === catName) {
              el.attr("r", pointRadius + 4).attr("stroke", "#1a1a1a").attr("stroke-width", 2);
            } else {
              el.attr("r", pointRadius + 1).attr("stroke", "#fff").attr("stroke-width", 2.5);
            }
          });
          const item = sortedData.find(d => d[x] === catName);
          if (item) {
            const gk = color ? item[color] : "_all";
            showValue(catName, item[y], gk);
          }
        }
      });
      panelGrid.node().addEventListener("mouseout", (event) => {
        const related = event.relatedTarget;
        if (related && panelGrid.node().contains(related)) return;
        lollipopsGroup.selectAll("circle[data-category]").attr("r", pointRadius + 1).attr("stroke", "#fff").attr("stroke-width", 2.5);
        hideValue();
      });
    }

  } else {
    // =======================================================================
    // VERTIKAL LOLLIPOP
    // =======================================================================

    const xScale = d3.scaleBand()
      .domain(categories)
      .range([axisLeft, autoWidth - marginRight])
      .padding(0.4);

    const yScale = d3.scaleLinear()
      .domain([0, valueNice.max])
      .range([height - marginBottom, marginTop]);

    // X-axel (kategorier)
    svg.append("g")
      .attr("transform", `translate(0,${height - marginBottom})`)
      .call(d3.axisBottom(xScale).tickSizeOuter(0))
      .call(g => g.select(".domain").attr("stroke", "#1a1a1a"))
      .call(g => g.selectAll(".tick line").remove())
      .call(g => g.selectAll(".tick text")
        .attr("fill", "#1a1a1a")
        .attr("font-size", "13px")
        .attr("font-family", "'IBM Plex Sans', sans-serif")
        .attr("transform", categories.length > 6 ? "rotate(-35)" : null)
        .attr("text-anchor", categories.length > 6 ? "end" : "middle")
        .attr("dy", categories.length > 6 ? "0.5em" : "0.71em"));

    // X-label
    if (xLabel) {
      svg.append("text")
        .attr("x", axisLeft + (autoWidth - marginRight - axisLeft) / 2)
        .attr("y", height - 8)
        .attr("text-anchor", "middle")
        .attr("class", "graf-axis-label")
        .text(xLabel);
    }

    // Grid lines - OWID-stil (horisontella streckade linjer)
    if (showGrid) {
      const gridGroup = svg.insert("g", ":first-child").attr("class", "grid-lines");
      const gridTicks = valueNice.ticks.length > 6
        ? valueNice.ticks.filter((_, i) => i % 2 === 0)
        : valueNice.ticks;
      gridTicks.forEach(tickVal => {
        const tickY = yScale(tickVal);
        gridGroup.append("line")
          .attr("x1", axisLeft)
          .attr("x2", autoWidth - marginRight)
          .attr("y1", tickY)
          .attr("y2", tickY)
          .attr("stroke", "#e0e0e0")
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", "12,6");
      });
    }

    // Y-axel - OWID-stil: bara tick-labels, ingen axellinje
    svg.append("g")
      .attr("transform", `translate(${axisLeft},0)`)
      .call(d3.axisLeft(yScale).tickFormat(formatY).tickValues(valueNice.ticks))
      .call(g => g.select(".domain").remove())
      .call(g => g.selectAll(".tick line").remove())
      .call(g => g.selectAll(".tick text")
        .attr("x", -8)
        .attr("text-anchor", "end")
        .attr("fill", "#666")
        .attr("font-size", "12px")
        .attr("font-family", "'IBM Plex Sans', sans-serif"));

    // Y-label
    if (yLabel) {
      svg.append("text")
        .attr("x", axisLeft + 4)
        .attr("y", marginTop - 10)
        .attr("text-anchor", "start")
        .attr("font-family", "'IBM Plex Sans', sans-serif")
        .attr("font-size", "13px")
        .attr("fill", "#1a1a1a")
        .text(yLabel);
    }

    // Grupp för lollipops (för uppdatering)
    const lollipopsGroup = svg.append("g").attr("class", "lollipops-group");

    // Funktion för att rita/uppdatera lollipops
    function updateLollipops() {
      lollipopsGroup.selectAll("*").remove();

      data.forEach(d => {
        const groupKey = color ? d[color] : "_all";
        const barColor = getCategoryColor(d[x], groupKey);

        // Linje
        lollipopsGroup.append("line")
          .attr("x1", xScale(d[x]) + xScale.bandwidth() / 2)
          .attr("x2", xScale(d[x]) + xScale.bandwidth() / 2)
          .attr("y1", yScale(0))
          .attr("y2", yScale(d[y]))
          .attr("stroke", barColor)
          .attr("stroke-width", lineWidth);

        // Punkt
        lollipopsGroup.append("circle")
          .attr("data-category", d[x])
          .attr("cx", xScale(d[x]) + xScale.bandwidth() / 2)
          .attr("cy", yScale(d[y]))
          .attr("r", pointRadius)
          .attr("fill", barColor)
          .attr("stroke", "#fff")
          .attr("stroke-width", 2)
          .style("cursor", "pointer")
          .on("mouseenter", function() {
            d3.select(this).attr("r", pointRadius + 2);
            showValue(d[x], d[y], groupKey);
          })
          .on("mouseleave", function() {
            d3.select(this).attr("r", pointRadius);
            hideValue();
          })
          .on("click", function() {
            smartToggle(d[x], categories);
            updateLollipops();
          });
      });

      // Uppdatera väljaren
      if (selectorCtrl) selectorCtrl.update();
    }

    updateLollipopsAll = updateLollipops;

    // Initial rendering
    updateLollipops();

    // Panel hover → chart highlight
    if (selectorCtrl) {
      const panelGrid = selectorCtrl.element.select(".graf-selector-grid");
      panelGrid.node().addEventListener("mouseover", (event) => {
        const opt = event.target.closest(".graf-selector-option");
        if (!opt) {
          lollipopsGroup.selectAll("circle[data-category]").attr("r", pointRadius).attr("stroke", "#fff").attr("stroke-width", 2);
          hideValue();
          return;
        }
        const catName = opt.querySelector(".opt-name")?.textContent;
        if (catName) {
          lollipopsGroup.selectAll("circle[data-category]").each(function() {
            const el = d3.select(this);
            if (el.attr("data-category") === catName) {
              el.attr("r", pointRadius + 3).attr("stroke", "#1a1a1a").attr("stroke-width", 2);
            } else {
              el.attr("r", pointRadius).attr("stroke", "#fff").attr("stroke-width", 2);
            }
          });
          const item = data.find(d => d[x] === catName);
          if (item) {
            const gk = color ? item[color] : "_all";
            showValue(catName, item[y], gk);
          }
        }
      });
      panelGrid.node().addEventListener("mouseout", (event) => {
        const related = event.relatedTarget;
        if (related && panelGrid.node().contains(related)) return;
        lollipopsGroup.selectAll("circle[data-category]").attr("r", pointRadius).attr("stroke", "#fff").attr("stroke-width", 2);
        hideValue();
      });
    }
  }

  // =========================================================================
  // CROSSHAIR INTERAKTIVITET
  // =========================================================================

  if (horizontal) {
    // Horisontell: crosshair + highlight
    // Använd samma skalor som ritningen (valueNice.max för domän)
    const sortedDataCH = [...data].sort((a, b) => b[y] - a[y]);
    const sortedCategoriesCH = sortedDataCH.map(d => d[x]);

    const yScaleCH = d3.scaleBand()
      .domain(sortedCategoriesCH)
      .range([marginTop, chartHeight - marginBottom])
      .padding(0.33);

    const xScaleCH = d3.scaleLinear()
      .domain([0, valueNice.max])
      .range([axisLeft, autoWidth - marginRight]);

    const crosshair = svg.append("line")
      .attr("class", "crosshair")
      .attr("x1", axisLeft)
      .attr("x2", autoWidth - marginRight)
      .attr("stroke", "#bbb")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4,3")
      .style("opacity", 0)
      .style("pointer-events", "none");

    // Highlight-ring - matchar punktens faktiska storlek (pointRadius + 1)
    const highlightRing = svg.append("circle")
      .attr("class", "highlight-ring")
      .attr("r", pointRadius + 4)
      .attr("fill", "none")
      .attr("stroke", "#1a1a1a")
      .attr("stroke-width", 2)
      .style("opacity", 0)
      .style("pointer-events", "none");

    svg.append("rect")
      .attr("class", "overlay")
      .attr("x", axisLeft)
      .attr("y", marginTop)
      .attr("width", autoWidth - marginRight - axisLeft)
      .attr("height", chartHeight - marginTop - marginBottom)
      .attr("fill", "transparent")
      .style("cursor", "default")
      .on("mouseenter", () => crosshair.style("opacity", 1))
      .on("mouseleave", () => {
        crosshair.style("opacity", 0);
        highlightRing.style("opacity", 0);
        hideValue();
      })
      .on("mousemove", function(event) {
        const [, my] = d3.pointer(event);
        crosshair.attr("y1", my).attr("y2", my);

        // Hitta närmaste kategori
        let closestCat = null;
        let minDist = Infinity;
        for (const cat of sortedCategoriesCH) {
          const catY = yScaleCH(cat) + yScaleCH.bandwidth() / 2;
          const dist = Math.abs(my - catY);
          if (dist < minDist) {
            minDist = dist;
            closestCat = cat;
          }
        }

        if (closestCat && minDist < yScaleCH.bandwidth()) {
          const item = data.find(d => d[x] === closestCat);
          if (item) {
            const groupKey = color ? item[color] : "_all";
            // Använd exakt samma beräkning som ritningen
            const pointX = xScaleCH(item[y]);
            const pointY = yScaleCH(closestCat) + yScaleCH.bandwidth() / 2;

            highlightRing
              .attr("cx", pointX)
              .attr("cy", pointY)
              .attr("stroke", colorScale(groupKey))
              .style("opacity", 1);

            showValue(closestCat, item[y], groupKey);
          }
        } else {
          highlightRing.style("opacity", 0);
        }
      })
      .on("click", function(event) {
        const [, my] = d3.pointer(event);
        let closestCat = null;
        let minDist = Infinity;
        for (const cat of sortedCategoriesCH) {
          const catY = yScaleCH(cat) + yScaleCH.bandwidth() / 2;
          const dist = Math.abs(my - catY);
          if (dist < minDist) { minDist = dist; closestCat = cat; }
        }
        if (closestCat && minDist < yScaleCH.bandwidth()) {
          smartToggle(closestCat, categories);
          if (updateLollipopsAll) updateLollipopsAll();
        }
      });
  } else {
    // Vertikal: crosshair + highlight
    const crosshair = svg.append("line")
      .attr("class", "crosshair")
      .attr("y1", marginTop)
      .attr("y2", height - marginBottom)
      .attr("stroke", "#bbb")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4,3")
      .style("opacity", 0)
      .style("pointer-events", "none");

    const xScaleCH = d3.scaleBand()
      .domain(categories)
      .range([axisLeft, autoWidth - marginRight])
      .padding(0.4);

    const yScaleCH = d3.scaleLinear()
      .domain([0, valueNice.max])
      .range([height - marginBottom, marginTop]);

    // Highlight-ring - matchar punktens faktiska storlek
    const highlightRing = svg.append("circle")
      .attr("class", "highlight-ring")
      .attr("r", pointRadius + 3)
      .attr("fill", "none")
      .attr("stroke", "#1a1a1a")
      .attr("stroke-width", 2)
      .style("opacity", 0)
      .style("pointer-events", "none");

    svg.append("rect")
      .attr("class", "overlay")
      .attr("x", axisLeft)
      .attr("y", marginTop)
      .attr("width", autoWidth - marginRight - axisLeft)
      .attr("height", height - marginTop - marginBottom)
      .attr("fill", "transparent")
      .style("cursor", "default")
      .on("mouseenter", () => crosshair.style("opacity", 1))
      .on("mouseleave", () => {
        crosshair.style("opacity", 0);
        highlightRing.style("opacity", 0);
        hideValue();
      })
      .on("mousemove", function(event) {
        const [mx] = d3.pointer(event);
        crosshair.attr("x1", mx).attr("x2", mx);

        // Hitta närmaste kategori
        let closestCat = null;
        let minDist = Infinity;
        for (const cat of categories) {
          const catX = xScaleCH(cat) + xScaleCH.bandwidth() / 2;
          const dist = Math.abs(mx - catX);
          if (dist < minDist) {
            minDist = dist;
            closestCat = cat;
          }
        }

        if (closestCat && minDist < xScaleCH.bandwidth()) {
          const item = data.find(d => d[x] === closestCat);
          if (item) {
            const groupKey = color ? item[color] : "_all";
            const pointX = xScaleCH(closestCat) + xScaleCH.bandwidth() / 2;
            const pointY = yScaleCH(item[y]);

            highlightRing
              .attr("cx", pointX)
              .attr("cy", pointY)
              .attr("stroke", colorScale(groupKey))
              .style("opacity", 1);

            showValue(closestCat, item[y], groupKey);
          }
        } else {
          highlightRing.style("opacity", 0);
        }
      })
      .on("click", function(event) {
        const [mx] = d3.pointer(event);
        let closestCat = null;
        let minDist = Infinity;
        for (const cat of categories) {
          const catX = xScaleCH(cat) + xScaleCH.bandwidth() / 2;
          const dist = Math.abs(mx - catX);
          if (dist < minDist) { minDist = dist; closestCat = cat; }
        }
        if (closestCat && minDist < xScaleCH.bandwidth()) {
          smartToggle(closestCat, categories);
          if (updateLollipopsAll) updateLollipopsAll();
        }
      });
  }

  // Legend om color finns
  if (color && groups.length > 1 && groups[0] !== "_all" && !interactive) {
    const labelFontSize = 13;
    const legend = svg.append("g")
      .attr("transform", `translate(${autoWidth - marginRight + 15}, ${marginTop + 15})`);

    groups.forEach((group, i) => {
      const g = legend.append("g")
        .attr("transform", `translate(0, ${i * 22})`);

      g.append("circle")
        .attr("cx", 0)
        .attr("cy", 0)
        .attr("r", 5)
        .attr("fill", colorScale(group));

      g.append("text")
        .attr("x", 12)
        .attr("y", 0)
        .attr("dy", "0.35em")
        .attr("font-size", `${labelFontSize}px`)
        .attr("font-family", "'IBM Plex Sans', sans-serif")
        .attr("font-weight", 600)
        .attr("fill", colorScale(group))
        .text(group);
    });
  }

  // Caption
  if (caption) {
    container.append("div")
      .attr("class", "graf-caption")
      .text(caption);
  }

  // Export-knapp och logga
  addExportButton(container, svg.node(), {
    title,
    subtitle,
    caption,
    width: autoWidth,
    height: chartHeight,
    altText,
    info,
    logo
  });

  return container.node();
}
