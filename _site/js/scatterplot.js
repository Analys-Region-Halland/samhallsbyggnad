// =============================================================================
// SCATTERPLOT - Avancerad D3-komponent med tidsanimation och trace
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "./exportSvg.js";
import { createFilterState, createSelectorPanel } from "./filterUtils.js";

// Hjälpfunktion: beräkna snyggt intervall och max för axlar
function niceScale(dataMin, dataMax, targetTicks = 5) {
  if (dataMax <= dataMin) return { min: 0, max: 10, interval: 2, ticks: [0, 2, 4, 6, 8, 10] };

  const range = dataMax - dataMin;
  const roughInterval = range / targetTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughInterval)));
  const normalized = roughInterval / magnitude;

  let niceInterval;
  if (normalized <= 1) niceInterval = 1;
  else if (normalized <= 2) niceInterval = 2;
  else if (normalized <= 2.5) niceInterval = 2.5;
  else if (normalized <= 5) niceInterval = 5;
  else niceInterval = 10;

  const interval = niceInterval * magnitude;
  const min = Math.floor(dataMin / interval) * interval;
  const max = Math.ceil(dataMax / interval) * interval;

  const ticks = [];
  for (let v = min; v <= max; v += interval) {
    ticks.push(v);
  }

  return { min, max, interval, ticks };
}

export function scatterplot(data, {
  x = "x",
  y = "y",
  label = null,           // Fält för punkt-etiketter (t.ex. "kommun")
  time = null,            // Fält för tid (t.ex. "år") - aktiverar trace/play
  color = null,           // Fält för färggruppering (t.ex. "län")
  size = null,
  width = null,
  height = 500,
  title = null,
  subtitle = null,
  caption = null,
  xLabel = null,
  yLabel = null,
  colors = ["#00664D", "#004990", "#FF7E00", "#433C9D", "#2DB8F6", "#A51300", "#8B4513", "#2F4F4F"],
  formatX = d => d.toLocaleString("sv-SE"),
  formatY = d => d.toLocaleString("sv-SE"),
  pointRadius = 7,
  pointOpacity = 0.85,
  showGrid = true,
  altText = null,
  info = null,
  logo = null,
  interactive = false,
  filter = null,          // Begränsa valbara items (gruppnamn eller individuella)
  highlight = null        // Förvalda highlightade labels
} = {}) {

  // Dimensioner
  const autoWidth = width || 780;
  const marginTop = yLabel ? 36 : 20;
  const marginRight = (interactive || highlight || color) ? 140 : 50;
  const marginBottom = xLabel ? 58 : 48;  // Ingen extra plats för tidslinje längre
  const marginLeft = 18;

  // Skapa wrapper-container
  const container = d3.create("div")
    .attr("class", "graf-container")
    .style("position", "relative");

  // Header
  const header = container.append("div")
    .attr("class", "graf-header");

  if (title) {
    header.append("div")
      .attr("class", "graf-title")
      .text(title);
  }

  // Tidshantering
  const allTimes = time ? [...new Set(data.map(d => d[time]))].sort((a, b) => a - b) : [];
  let currentTime = allTimes.length > 0 ? allTimes[allTimes.length - 1] : null;
  const hasTimeAnimation = time && allTimes.length > 1;
  let isAnimating = false;
  let animationInterval = null;

  // Hämta data för aktuell tid
  const getDataForTime = (t) => {
    if (!time) return data;
    return data.filter(d => d[time] === t);
  };

  // ==========================================================================
  // UNDERTITEL MED INTEGRERAD TIDSKONTROLL
  // ==========================================================================
  let subtitleEl = null;
  let timeControl = null;
  let updateChart = null;  // Definieras senare

  if (subtitle || hasTimeAnimation) {
    // Inject CSS för tidskontroll
    if (hasTimeAnimation && !document.getElementById("graf-time-control-styles")) {
      const styles = document.createElement("style");
      styles.id = "graf-time-control-styles";
      styles.textContent = `
        .graf-subtitle-wrapper {
          display: flex;
          align-items: baseline;
          gap: 0;
          flex-wrap: wrap;
        }
        .graf-subtitle-text {
          font-family: 'IBM Plex Sans', sans-serif;
          font-size: 14px;
          color: #666;
        }
        .graf-time-control {
          display: inline-flex;
          align-items: center;
          font-family: 'IBM Plex Sans', sans-serif;
          user-select: none;
          position: relative;
        }
        .graf-time-trigger {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          cursor: pointer;
          padding: 2px 0;
        }
        .graf-time-year {
          font-size: 14px;
          font-weight: 600;
          color: #1a1a1a;
          text-decoration: underline;
          text-decoration-color: #ccc;
          text-underline-offset: 2px;
          transition: text-decoration-color 0.15s;
        }
        .graf-time-trigger:hover .graf-time-year {
          text-decoration-color: #00664D;
        }
        .graf-time-panel {
          display: none;
          position: absolute;
          top: 50%;
          left: 100%;
          transform: translateY(-50%);
          margin-left: 8px;
          padding: 8px 12px;
          background: #fff;
          border: 1px solid #1a1a1a;
          z-index: 100;
          white-space: nowrap;
        }
        .graf-time-control.expanded .graf-time-panel {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .graf-time-slider {
          width: 120px;
          height: 4px;
          -webkit-appearance: none;
          appearance: none;
          background: #ddd;
          border-radius: 2px;
          outline: none;
          cursor: pointer;
        }
        .graf-time-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #00664D;
          cursor: pointer;
          border: 2px solid #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .graf-time-slider::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #00664D;
          cursor: pointer;
          border: 2px solid #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        .graf-time-play-btn {
          width: 24px;
          height: 24px;
          border: none;
          background: #1a1a1a;
          border-radius: 3px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s;
          color: #fff;
          font-size: 10px;
          line-height: 1;
        }
        .graf-time-play-btn:hover {
          background: #333;
        }
        .graf-time-range {
          font-size: 11px;
          color: #888;
        }
      `;
      document.head.appendChild(styles);
    }

    const subtitleWrapper = header.append("div")
      .attr("class", "graf-subtitle-wrapper");

    if (hasTimeAnimation && subtitle) {
      // Dela upp subtitle för att ersätta årtalsspan
      // Förväntat format: "Text, YYYY–YYYY" eller "Text YYYY-YYYY"
      const yearRangeMatch = subtitle.match(/^(.+?)(\d{4})\s*[–\-]\s*(\d{4})(.*)$/);

      if (yearRangeMatch) {
        const [, prefix, startYear, endYear, suffix] = yearRangeMatch;

        // Ta bort eventuellt komma/mellanslag i slutet av prefix
        const cleanPrefix = prefix.replace(/[,\s]+$/, '');

        subtitleWrapper.append("span")
          .attr("class", "graf-subtitle-text")
          .text(cleanPrefix);

        timeControl = subtitleWrapper.append("span")
          .attr("class", "graf-time-control");

        const trigger = timeControl.append("span")
          .attr("class", "graf-time-trigger");

        trigger.append("span")
          .text("\u00A0(");

        trigger.append("span")
          .attr("class", "graf-time-year")
          .text(currentTime);

        trigger.append("span")
          .text(")");

        const panel = timeControl.append("div")
          .attr("class", "graf-time-panel");

        panel.append("span")
          .attr("class", "graf-time-range")
          .text(allTimes[0]);

        const slider = panel.append("input")
          .attr("type", "range")
          .attr("class", "graf-time-slider")
          .attr("min", 0)
          .attr("max", allTimes.length - 1)
          .attr("value", allTimes.length - 1)
          .on("input", function() {
            if (isAnimating) stopAnimation();
            currentTime = allTimes[+this.value];
            updateTimeDisplay();
            if (updateChart) updateChart();
          });

        panel.append("span")
          .attr("class", "graf-time-range")
          .text(allTimes[allTimes.length - 1]);

        const playBtn = panel.append("button")
          .attr("class", "graf-time-play-btn")
          .attr("title", "Spela animation")
          .html("▶")
          .on("click", () => {
            if (isAnimating) {
              stopAnimation();
            } else {
              playAnimation();
            }
          });

        if (suffix) {
          subtitleWrapper.append("span")
            .attr("class", "graf-subtitle-text")
            .text(suffix);
        }

        // Hover-hantering
        let hoverTimeout = null;
        timeControl.on("mouseenter", () => {
          clearTimeout(hoverTimeout);
          timeControl.classed("expanded", true);
        });
        timeControl.on("mouseleave", () => {
          clearTimeout(hoverTimeout);
          hoverTimeout = setTimeout(() => {
            timeControl.classed("expanded", false);
          }, 300);
        });

        // Uppdatera slider vid animation
        function updateTimeDisplay() {
          const idx = allTimes.indexOf(currentTime);
          slider.property("value", idx);
          trigger.select(".graf-time-year").text(currentTime);
        }

        function playAnimation() {
          if (isAnimating) return;
          isAnimating = true;

          // Uppdatera ikon till paus
          playBtn.html("⏸");

          let idx = 0;
          currentTime = allTimes[0];
          updateTimeDisplay();
          if (updateChart) updateChart();

          animationInterval = setInterval(() => {
            idx++;
            if (idx >= allTimes.length) {
              stopAnimation();
              return;
            }
            currentTime = allTimes[idx];
            updateTimeDisplay();
            if (updateChart) updateChart();
          }, 150);
        }

        function stopAnimation() {
          if (animationInterval) {
            clearInterval(animationInterval);
            animationInterval = null;
          }
          isAnimating = false;
          // Återställ ikon till play
          playBtn.html("▶");
        }

        // Exponera funktioner
        timeControl.playAnimation = playAnimation;
        timeControl.stopAnimation = stopAnimation;
        timeControl.updateTimeDisplay = updateTimeDisplay;

      } else {
        // Ingen årtalsmatchning - visa vanlig subtitle
        subtitleWrapper.append("span")
          .attr("class", "graf-subtitle-text")
          .text(subtitle);
      }
    } else if (subtitle) {
      subtitleWrapper.append("span")
        .attr("class", "graf-subtitle-text")
        .text(subtitle);
    }
  }

  // ==========================================================================
  // INTERAKTIV HIGHLIGHT-VÄLJARE (via filterUtils)
  // ==========================================================================
  let categorySelector = null;

  const filterState = label
    ? createFilterState(data, { itemField: label, groupField: color, filter, highlight })
    : null;

  const allLabels = label ? [...new Set(data.map(d => d[label]))] : [];

  const mutedColor = "#d0d0d0";

  const isHighlighted = (lbl) => {
    if (!filterState) return true;
    return filterState.isHighlighted(lbl);
  };

  // Färgskala baserad på color (län) eller label
  const colorGroups = color ? [...new Set(data.map(d => d[color]))] : ["_all"];
  const colorScale = d3.scaleOrdinal()
    .domain(colorGroups)
    .range(colors);

  const getPointColor = (d) => {
    const lbl = label ? d[label] : null;
    if (lbl && !isHighlighted(lbl)) return mutedColor;
    return color ? colorScale(d[color]) : colors[0];
  };

  let selectorPanel = null;
  if (interactive && label && filterState) {
    const panel = createSelectorPanel(header, {
      filterState,
      allItems: allLabels,
      colorScale,
      triggerText: "Markera \u203a",
      onUpdate: () => updateChart(),
      onItemHover: null,
      onItemLeave: null
    });
    selectorPanel = panel;
    categorySelector = panel.element;
  }

  // Värde-display för hover
  const valueDisplay = container.append("div")
    .attr("class", "graf-value-display")
    .html("<span style='opacity:0.35'>Peka för värden</span>");

  // SVG-container
  const svgContainer = container.append("div")
    .attr("class", "graf-svg-container");

  const svg = svgContainer.append("svg")
    .attr("viewBox", `0 0 ${autoWidth} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("class", "graf-svg");

  // Beräkna axel-skalor (global över alla tider)
  const xExtent = d3.extent(data, d => d[x]);
  const yExtent = d3.extent(data, d => d[y]);

  const xNice = niceScale(xExtent[0] * 0.95, xExtent[1] * 1.05, 5);
  const yNice = niceScale(0, yExtent[1] * 1.1, 5);

  const maxTickWidth = formatY(yNice.max).length * 6 + 8;
  const axisLeft = marginLeft + maxTickWidth;

  // Skalor
  const xScale = d3.scaleLinear()
    .domain([xNice.min, xNice.max])
    .range([axisLeft, autoWidth - marginRight]);

  const yScale = d3.scaleLinear()
    .domain([yNice.min, yNice.max])
    .range([height - marginBottom, marginTop]);

  // Clip path för zoomed view
  const clipId = "clip-" + Math.random().toString(36).substr(2, 9);
  svg.append("defs").append("clipPath")
    .attr("id", clipId)
    .append("rect")
    .attr("x", axisLeft)
    .attr("y", marginTop)
    .attr("width", autoWidth - marginRight - axisLeft)
    .attr("height", height - marginTop - marginBottom);

  // Grid lines (med data binding för uppdatering)
  const xGridTicks = xNice.ticks.length > 6
    ? xNice.ticks.filter((_, i) => i % 2 === 0)
    : xNice.ticks;
  const yGridTicks = yNice.ticks.length > 6
    ? yNice.ticks.filter((_, i) => i % 2 === 0)
    : yNice.ticks;

  const xGridGroup = svg.insert("g", ":first-child")
    .attr("class", "grid-lines-x")
    .attr("clip-path", `url(#${clipId})`);

  if (showGrid) {
    xGridGroup.selectAll("line")
      .data(xGridTicks)
      .join("line")
      .attr("x1", d => xScale(d))
      .attr("x2", d => xScale(d))
      .attr("y1", marginTop)
      .attr("y2", height - marginBottom)
      .attr("stroke", "#e0e0e0")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "12,6");
  }

  const yGridGroup = svg.insert("g", ":first-child")
    .attr("class", "grid-lines-y")
    .attr("clip-path", `url(#${clipId})`);

  if (showGrid) {
    yGridGroup.selectAll("line")
      .data(yGridTicks)
      .join("line")
      .attr("x1", axisLeft)
      .attr("x2", autoWidth - marginRight)
      .attr("y1", d => yScale(d))
      .attr("y2", d => yScale(d))
      .attr("stroke", "#e0e0e0")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "12,6");
  }

  // X-axel - MÖRKA AXLAR
  svg.append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${height - marginBottom})`)
    .call(d3.axisBottom(xScale).tickFormat(formatX).tickValues(xNice.ticks))
    .call(g => g.select(".domain").attr("stroke", "#1a1a1a").attr("stroke-width", 1.5))
    .call(g => g.selectAll(".tick line").attr("stroke", "#1a1a1a"))
    .call(g => g.selectAll(".tick text")
      .attr("fill", "#1a1a1a")
      .attr("font-size", "12px")
      .attr("font-family", "'IBM Plex Sans', sans-serif"));

  if (xLabel) {
    svg.append("text")
      .attr("x", axisLeft + (autoWidth - marginRight - axisLeft) / 2)
      .attr("y", height - marginBottom + 38)
      .attr("text-anchor", "middle")
      .attr("font-family", "'IBM Plex Sans', sans-serif")
      .attr("font-size", "12px")
      .attr("fill", "#1a1a1a")
      .text(xLabel);
  }

  // Y-axel - MÖRKA AXLAR
  svg.append("g")
    .attr("class", "y-axis")
    .attr("transform", `translate(${axisLeft},0)`)
    .call(d3.axisLeft(yScale).tickFormat(formatY).tickValues(yNice.ticks))
    .call(g => g.select(".domain").attr("stroke", "#1a1a1a").attr("stroke-width", 1.5))
    .call(g => g.selectAll(".tick line").attr("stroke", "#1a1a1a"))
    .call(g => g.selectAll(".tick text")
      .attr("x", -8)
      .attr("text-anchor", "end")
      .attr("fill", "#1a1a1a")
      .attr("font-size", "12px")
      .attr("font-family", "'IBM Plex Sans', sans-serif"));

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

  // ==========================================================================
  // GRUPPER FÖR TRACE, PUNKTER OCH ETIKETTER (med clipping för zoom)
  // ==========================================================================
  const traceGroup = svg.append("g").attr("class", "trace-group").attr("clip-path", `url(#${clipId})`);
  const pointsGroup = svg.append("g").attr("class", "points-group").attr("clip-path", `url(#${clipId})`);
  const labelsGroup = svg.append("g").attr("class", "labels-group").attr("clip-path", `url(#${clipId})`);
  const hoverGroup = svg.append("g").attr("class", "hover-group").attr("clip-path", `url(#${clipId})`);

  // ==========================================================================
  // TRACE - Minimalistisk historisk linje med persistent klick-stöd
  // ==========================================================================
  const pinnedTraces = new Set();  // Labels med fastlåsta traces
  const pinnedTraceGroup = svg.insert("g", ".points-group").attr("class", "pinned-trace-group").attr("clip-path", `url(#${clipId})`);
  const pinnedLabelsGroup = svg.append("g").attr("class", "pinned-labels-group").attr("clip-path", `url(#${clipId})`);

  // Trace-linjegenerator
  const traceLine = d3.line()
    .x(d => xScale(d[x]))
    .y(d => yScale(d[y]))
    .curve(d3.curveMonotoneX);

  // Rita en enstaka trace (returnerar inget, ritar i angiven grupp)
  function drawTrace(group, lbl, pointColor, opts = {}) {
    if (!time || !lbl) return;
    const opacity = opts.opacity || 0.5;
    const width = opts.width || 1.5;

    const entityData = data.filter(d => d[label] === lbl).sort((a, b) => a[time] - b[time]);
    if (entityData.length < 2) return;

    const traceData = entityData.filter(d => d[time] <= currentTime);
    if (traceData.length < 2) return;

    // Enkel, ren linje
    group.append("path")
      .datum(traceData)
      .attr("class", `trace-line trace-${lbl.replace(/\s+/g, '-')}`)
      .attr("data-trace", lbl)
      .attr("d", traceLine)
      .attr("fill", "none")
      .attr("stroke", pointColor)
      .attr("stroke-width", width)
      .attr("stroke-opacity", opacity);

    // Liten startpunkt
    const startPoint = traceData[0];
    group.append("circle")
      .attr("class", `trace-start trace-${lbl.replace(/\s+/g, '-')}`)
      .attr("data-trace", lbl)
      .attr("cx", xScale(startPoint[x]))
      .attr("cy", yScale(startPoint[y]))
      .attr("r", 2)
      .attr("fill", pointColor)
      .attr("fill-opacity", opacity);
  }

  // Hover-trace (temporär, visas i traceGroup)
  function showHoverTrace(lbl, pointColor) {
    traceGroup.selectAll("*").remove();
    if (pinnedTraces.has(lbl)) return; // Redan pinnad, behöver inte hover-trace
    drawTrace(traceGroup, lbl, pointColor, { opacity: 0.4, width: 1.5 });
  }

  function hideHoverTrace() {
    traceGroup.selectAll("*").remove();
  }

  // Pinnade traces (persistenta)
  function togglePinnedTrace(lbl) {
    if (pinnedTraces.has(lbl)) {
      pinnedTraces.delete(lbl);
    } else {
      pinnedTraces.add(lbl);
    }
    redrawPinnedTraces();
    updatePinnedPointStyles();
  }

  function redrawPinnedTraces() {
    pinnedTraceGroup.selectAll("*").remove();
    pinnedLabelsGroup.selectAll("*").remove();
    for (const lbl of pinnedTraces) {
      const d = getDataForTime(currentTime).find(d => d[label] === lbl);
      if (!d) continue;
      const isHl = isHighlighted(lbl);
      const ptColor = isHl ? getPointColor(d) : "#666";
      drawTrace(pinnedTraceGroup, lbl, ptColor, { opacity: 0.6, width: 1.8 });

      // Rita persistent etikett för pinnad punkt (icke-highlighted har ingen vanlig label)
      if (!isHl) {
        const px = xScale(d[x]);
        const py = yScale(d[y]);
        pinnedLabelsGroup.append("text")
          .attr("class", "pinned-label")
          .attr("data-label", lbl)
          .attr("x", px)
          .attr("y", py - pointRadius - 8)
          .attr("text-anchor", "middle")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .attr("font-size", "11px")
          .attr("font-weight", 700)
          .attr("fill", ptColor)
          .text(lbl);
      } else {
        // Markera highlighted pinnad label med fetstil
        labelsGroup.select(`.label-text[data-label="${lbl}"]`)
          .attr("font-weight", 700)
          .attr("font-size", "13px");
        labelsGroup.select(`.label-connector[data-label="${lbl}"]`)
          .attr("stroke-width", 2)
          .attr("stroke-opacity", 0.7);
      }
    }
  }

  function updatePinnedPointStyles() {
    pointsGroup.selectAll("circle").each(function() {
      const el = d3.select(this);
      const elLabel = el.attr("data-label");
      const isPinned = pinnedTraces.has(elLabel);
      const elIsHl = isHighlighted(elLabel);

      if (isPinned) {
        el.attr("stroke", "#1a1a1a")
          .attr("stroke-width", 2.5)
          .attr("r", elIsHl ? pointRadius + 2 : pointRadius);
      } else {
        el.attr("stroke", "#fff")
          .attr("stroke-width", elIsHl ? 2 : 1)
          .attr("r", elIsHl ? pointRadius : pointRadius - 2);
      }
    });
  }

  // ==========================================================================
  // UPPDATERA DIAGRAMMET
  // ==========================================================================
  // Sätt updateChart-funktionen
  updateChart = function() {
    pointsGroup.selectAll("*").remove();
    labelsGroup.selectAll("*").remove();
    hoverGroup.selectAll("*").remove();
    hideHoverTrace();
    redrawPinnedTraces();

    const currentData = getDataForTime(currentTime);

    // Separera highlighted och icke-highlighted
    const highlightedData = currentData.filter(d => label ? isHighlighted(d[label]) : true);
    const mutedData = currentData.filter(d => label ? !isHighlighted(d[label]) : false);

    // Rita muted punkter först
    mutedData.forEach(d => {
      pointsGroup.append("circle")
        .attr("class", "point-muted")
        .attr("data-label", d[label])
        .attr("cx", xScale(d[x]))
        .attr("cy", yScale(d[y]))
        .attr("r", pointRadius - 2)
        .attr("fill", mutedColor)
        .attr("fill-opacity", 0.5)
        .attr("stroke", "#fff")
        .attr("stroke-width", 1)
        .style("cursor", "pointer");
    });

    // Rita highlighted punkter
    highlightedData.forEach(d => {
      const ptColor = getPointColor(d);
      pointsGroup.append("circle")
        .attr("class", "point-highlight")
        .attr("data-label", d[label])
        .attr("cx", xScale(d[x]))
        .attr("cy", yScale(d[y]))
        .attr("r", pointRadius)
        .attr("fill", ptColor)
        .attr("fill-opacity", pointOpacity)
        .attr("stroke", "#fff")
        .attr("stroke-width", 2)
        .style("cursor", "pointer");
    });

    // Rita etiketter för highlighted punkter
    if (label && highlightedData.length > 0 && highlightedData.length <= 15) {
      drawLabels(highlightedData);
    }

    // Applicera pinnad stil efter att punkter ritats
    if (pinnedTraces.size > 0) {
      updatePinnedPointStyles();
    }

    // Uppdatera selector
    if (selectorPanel) {
      selectorPanel.update();
    }
  }

  // ==========================================================================
  // ETIKETT-PLACERING MED FÖRBÄTTRAD KOLLISIONSHANTERING
  // ==========================================================================
  function drawLabels(pointData) {
    const labelFontSize = 11;
    const labelPadding = 4;
    const pointPadding = 4;

    // Samla ALLA synliga punkters positioner (för kollisionsdetektering)
    const currentData = getDataForTime(currentTime);
    const allPointPositions = currentData.map(d => ({
      x: xScale(d[x]),
      y: yScale(d[y]),
      r: isHighlighted(d[label]) ? pointRadius : pointRadius - 2
    }));

    // Skapa label-objekt med beräknad bredd
    const labels = pointData.map(d => {
      const px = xScale(d[x]);
      const py = yScale(d[y]);
      const labelWidth = d[label].length * 6.5 + 10;
      const labelHeight = 14;

      return {
        data: d,
        name: d[label],
        px, py,
        labelWidth,
        labelHeight,
        labelX: px,
        labelY: py - pointRadius - 14,
        color: getPointColor(d)
      };
    });

    // Hjälpfunktion: kolla om rektangel överlappar med en punkt
    function rectOverlapsPoint(rx, ry, rw, rh, pt) {
      const closestX = Math.max(rx - rw/2, Math.min(pt.x, rx + rw/2));
      const closestY = Math.max(ry - rh/2, Math.min(pt.y, ry + rh/2));
      const distSq = (closestX - pt.x) ** 2 + (closestY - pt.y) ** 2;
      return distSq < (pt.r + pointPadding) ** 2;
    }

    // Hjälpfunktion: kolla om två rektanglar överlappar
    function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
      return Math.abs(ax - bx) < (aw + bw) / 2 + labelPadding &&
             Math.abs(ay - by) < (ah + bh) / 2 + 2;
    }

    // Hjälpfunktion: beräkna penalty för en position
    function getPositionPenalty(lp, testX, testY, otherLabels) {
      let penalty = 0;

      // Penalty för avstånd från egen punkt (vi vill ha nära)
      const distFromPoint = Math.sqrt((testX - lp.px) ** 2 + (testY - lp.py) ** 2);
      penalty += distFromPoint * 0.5;

      // Stor penalty för överlapp med andra punkter (exkludera egen punkt)
      for (const pt of allPointPositions) {
        if (Math.abs(pt.x - lp.px) < 1 && Math.abs(pt.y - lp.py) < 1) continue; // Skip egen punkt
        if (rectOverlapsPoint(testX, testY, lp.labelWidth, lp.labelHeight, pt)) {
          penalty += 1000;
        }
      }

      // Penalty för överlapp med andra etiketter
      for (const other of otherLabels) {
        if (other === lp) continue;
        if (rectsOverlap(testX, testY, lp.labelWidth, lp.labelHeight,
                         other.labelX, other.labelY, other.labelWidth, other.labelHeight)) {
          penalty += 500;
        }
      }

      // Penalty för att vara utanför bounds
      if (testX - lp.labelWidth/2 < axisLeft) penalty += 200;
      if (testX + lp.labelWidth/2 > autoWidth - marginRight) penalty += 200;
      if (testY - lp.labelHeight/2 < marginTop) penalty += 200;
      if (testY + lp.labelHeight/2 > height - marginBottom) penalty += 200;

      return penalty;
    }

    // Steg 1: Hitta bästa startposition för varje etikett
    const offsets = [
      { dx: 0, dy: -pointRadius - 14 },    // Ovan
      { dx: 0, dy: pointRadius + 14 },     // Under
      { dx: pointRadius + 20, dy: 0 },     // Höger
      { dx: -pointRadius - 20, dy: 0 },    // Vänster
      { dx: pointRadius + 15, dy: -12 },   // Höger-ovan
      { dx: -pointRadius - 15, dy: -12 },  // Vänster-ovan
      { dx: pointRadius + 15, dy: 12 },    // Höger-under
      { dx: -pointRadius - 15, dy: 12 },   // Vänster-under
    ];

    // Placera etiketter en i taget, börja med de som har minst utrymme
    const sortedLabels = [...labels].sort((a, b) => {
      // Prioritera punkter nära kanter
      const aEdgeDist = Math.min(a.px - axisLeft, autoWidth - marginRight - a.px, a.py - marginTop, height - marginBottom - a.py);
      const bEdgeDist = Math.min(b.px - axisLeft, autoWidth - marginRight - b.px, b.py - marginTop, height - marginBottom - b.py);
      return aEdgeDist - bEdgeDist;
    });

    const placedLabels = [];
    for (const lp of sortedLabels) {
      let bestX = lp.px;
      let bestY = lp.py - pointRadius - 14;
      let bestPenalty = Infinity;

      for (const offset of offsets) {
        const testX = lp.px + offset.dx;
        const testY = lp.py + offset.dy;
        const penalty = getPositionPenalty(lp, testX, testY, placedLabels);

        if (penalty < bestPenalty) {
          bestPenalty = penalty;
          bestX = testX;
          bestY = testY;
        }
      }

      lp.labelX = bestX;
      lp.labelY = bestY;
      placedLabels.push(lp);
    }

    // Steg 2: Force-directed relaxation för finjustering
    for (let iter = 0; iter < 30; iter++) {
      let totalMovement = 0;

      for (const lp of labels) {
        let fx = 0, fy = 0;

        // Repulsion från andra etiketter
        for (const other of labels) {
          if (other === lp) continue;
          const dx = lp.labelX - other.labelX;
          const dy = lp.labelY - other.labelY;
          const minDistX = (lp.labelWidth + other.labelWidth) / 2 + labelPadding;
          const minDistY = (lp.labelHeight + other.labelHeight) / 2 + 2;

          if (Math.abs(dx) < minDistX && Math.abs(dy) < minDistY) {
            const overlapX = minDistX - Math.abs(dx);
            const overlapY = minDistY - Math.abs(dy);
            const pushX = (dx === 0 ? 0.1 : Math.sign(dx)) * overlapX * 0.3;
            const pushY = (dy === 0 ? 0.1 : Math.sign(dy)) * overlapY * 0.3;
            fx += pushX;
            fy += pushY;
          }
        }

        // Stark repulsion från ALLA punkter (utom egen)
        for (const pt of allPointPositions) {
          if (Math.abs(pt.x - lp.px) < 1 && Math.abs(pt.y - lp.py) < 1) continue;

          const dx = lp.labelX - pt.x;
          const dy = lp.labelY - pt.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const minDist = pt.r + Math.max(lp.labelWidth, lp.labelHeight) / 2 + pointPadding;

          if (dist < minDist && dist > 0) {
            const force = (minDist - dist) * 0.5;
            fx += (dx / dist) * force;
            fy += (dy / dist) * force;
          }
        }

        // Svag attraktion tillbaka mot egen punkt
        const attractX = (lp.px - lp.labelX) * 0.02;
        const attractY = (lp.py - pointRadius - 14 - lp.labelY) * 0.01;
        fx += attractX;
        fy += attractY;

        // Applicera kraft
        lp.labelX += fx;
        lp.labelY += fy;
        totalMovement += Math.abs(fx) + Math.abs(fy);

        // Håll inom bounds
        lp.labelX = Math.max(axisLeft + lp.labelWidth/2 + 2, Math.min(autoWidth - marginRight - lp.labelWidth/2 - 2, lp.labelX));
        lp.labelY = Math.max(marginTop + 8, Math.min(height - marginBottom - 10, lp.labelY));
      }

      if (totalMovement < 0.5) break;
    }

    // Steg 3: Rita connectors och etiketter
    labels.forEach(lp => {
      const dx = lp.labelX - lp.px;
      const dy = lp.labelY - lp.py;
      const needsConnector = Math.abs(dx) > 15 || Math.abs(dy) > 20;

      if (needsConnector) {
        // Beräkna connector-start vid punktens kant
        const angle = Math.atan2(dy, dx);
        const startX = lp.px + Math.cos(angle) * (pointRadius + 2);
        const startY = lp.py + Math.sin(angle) * (pointRadius + 2);

        // Connector-slut vid etikettens kant
        const endX = lp.labelX - Math.cos(angle) * (lp.labelWidth / 2 - 2);
        const endY = lp.labelY - Math.sign(dy) * 2;

        labelsGroup.append("line")
          .attr("class", "label-connector")
          .attr("data-label", lp.name)
          .attr("x1", startX)
          .attr("y1", startY)
          .attr("x2", endX)
          .attr("y2", endY)
          .attr("stroke", lp.color)
          .attr("stroke-width", 1)
          .attr("stroke-opacity", 0.4);
      }

      labelsGroup.append("text")
        .attr("class", "label-text")
        .attr("data-label", lp.name)
        .attr("x", lp.labelX)
        .attr("y", lp.labelY)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("font-size", `${labelFontSize}px`)
        .attr("font-family", "'IBM Plex Sans', sans-serif")
        .attr("font-weight", 600)
        .attr("fill", lp.color)
        .text(lp.name);
    });
  }

  // ==========================================================================
  // HOVER HANTERING
  // ==========================================================================
  function handlePointHover(d, show) {
    const lbl = d[label];
    const isHl = isHighlighted(lbl);
    const ptColor = isHl ? getPointColor(d) : "#666";
    const isPinned = pinnedTraces.has(lbl);

    hoverGroup.selectAll("*").remove();

    if (show) {
      // Visa hover-trace (om inte redan pinnad)
      if (time && lbl) {
        showHoverTrace(lbl, ptColor);
      }

      // Highlighta punkten (men inte om redan pinnad - den har redan stil)
      if (!isPinned) {
        pointsGroup.selectAll("circle").each(function() {
          const el = d3.select(this);
          const elLabel = el.attr("data-label");
          if (elLabel === lbl) {
            el.attr("r", pointRadius + 3)
              .attr("stroke", "#1a1a1a")
              .attr("stroke-width", 2.5);
          }
        });
      }

      // Om inte highlighted - visa temporär etikett vid punkten
      if (!isHl) {
        hoverGroup.append("text")
          .attr("x", xScale(d[x]))
          .attr("y", yScale(d[y]) - pointRadius - 8)
          .attr("text-anchor", "middle")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .attr("font-size", "11px")
          .attr("font-weight", 600)
          .attr("fill", ptColor)
          .text(lbl);
      } else {
        // Highlighta befintlig etikett
        labelsGroup.select(`.label-text[data-label="${lbl}"]`)
          .attr("font-weight", 700)
          .attr("font-size", "13px");
        labelsGroup.select(`.label-connector[data-label="${lbl}"]`)
          .attr("stroke-width", 2)
          .attr("stroke-opacity", 0.7);
      }

      // Visa värden i panelen
      const colorDot = `<span style="width:8px;height:8px;border-radius:50%;background:${ptColor};margin-right:6px"></span>`;
      const labelText = lbl ? `<b style="margin-right:8px">${lbl}</b>` : "";
      const groupText = color && d[color] ? `<span style="color:#888;margin-right:8px">(${d[color]})</span>` : "";
      const xChip = `<span style="color:#666;margin-right:4px">${xLabel || "X"}:</span><b>${formatX(d[x])}</b>`;
      const yChip = `<span style="color:#666;margin-right:4px">${yLabel || "Y"}:</span><b>${formatY(d[y])}</b>`;
      const timeChip = time ? `<span style="opacity:0.2;margin:0 8px">│</span><span style="color:#888">${d[time]}</span>` : "";
      const pinHint = isPinned ? `<span style="opacity:0.3;margin-left:8px;font-size:9px">klicka för att ta bort</span>` : (time ? `<span style="opacity:0.3;margin-left:8px;font-size:9px">klicka för trace</span>` : "");

      valueDisplay.html(`<span style="display:inline-flex;align-items:center;justify-content:center;width:100%">${colorDot}${labelText}${groupText}<span style="opacity:0.2;margin-right:8px">│</span>${xChip}<span style="opacity:0.2;margin:0 8px">│</span>${yChip}${timeChip}${pinHint}</span>`);
    } else {
      // Återställ hover-trace
      hideHoverTrace();

      // Återställ punkt-stil (respektera pinnade)
      pointsGroup.selectAll("circle").each(function() {
        const el = d3.select(this);
        const elLabel = el.attr("data-label");
        const elIsHl = isHighlighted(elLabel);
        const elIsPinned = pinnedTraces.has(elLabel);

        if (elIsPinned) {
          el.attr("r", elIsHl ? pointRadius + 2 : pointRadius)
            .attr("stroke", "#1a1a1a")
            .attr("stroke-width", 2.5);
        } else {
          el.attr("r", elIsHl ? pointRadius : pointRadius - 2)
            .attr("stroke", "#fff")
            .attr("stroke-width", elIsHl ? 2 : 1);
        }
      });

      labelsGroup.selectAll(".label-text").each(function() {
        const el = d3.select(this);
        const elLabel = el.attr("data-label");
        if (pinnedTraces.has(elLabel)) {
          el.attr("font-weight", 700).attr("font-size", "13px");
        } else {
          el.attr("font-weight", 600).attr("font-size", "11px");
        }
      });
      labelsGroup.selectAll(".label-connector").each(function() {
        const el = d3.select(this);
        const elLabel = el.attr("data-label");
        if (pinnedTraces.has(elLabel)) {
          el.attr("stroke-width", 2).attr("stroke-opacity", 0.7);
        } else {
          el.attr("stroke-width", 1).attr("stroke-opacity", 0.4);
        }
      });

      valueDisplay.html("<span style='opacity:0.35'>Peka för värden</span>");
    }
  }

  // ==========================================================================
  // ZOOM/BRUSH FUNKTIONALITET
  // ==========================================================================
  // Spara ursprungliga domäner för reset
  const originalXDomain = [xNice.min, xNice.max];
  const originalYDomain = [yNice.min, yNice.max];
  let isZoomed = false;

  // Inject CSS för brush och zoom
  if (!document.getElementById("graf-brush-styles")) {
    const styles = document.createElement("style");
    styles.id = "graf-brush-styles";
    styles.textContent = `
      .graf-brush .selection {
        fill: rgba(0, 102, 77, 0.15);
        stroke: #00664D;
        stroke-width: 1.5;
        stroke-dasharray: 4,2;
      }
    `;
    document.head.appendChild(styles);
  }

  // Zoom-kontroller som SVG-element (centrerat i grafytan, i linje med y-titel)
  const chartCenterX = axisLeft + (autoWidth - marginRight - axisLeft) / 2;
  const zoomControlsGroup = svg.append("g")
    .attr("class", "zoom-controls")
    .attr("transform", `translate(${chartCenterX}, ${marginTop - 10})`);

  // Hint - visas direkt vid laddning, försvinner efter 4 sekunder eller vid interaktion
  const hintWidth = 110;
  const brushHintBg = zoomControlsGroup.append("rect")
    .attr("x", -hintWidth / 2)
    .attr("y", -9)
    .attr("rx", 3)
    .attr("width", hintWidth)
    .attr("height", 18)
    .attr("fill", "rgba(26, 26, 26, 0.85)")
    .attr("opacity", 0.9);

  const brushHintText = zoomControlsGroup.append("text")
    .attr("x", 0)
    .attr("y", 3)
    .attr("text-anchor", "middle")
    .attr("font-family", "'IBM Plex Sans', sans-serif")
    .attr("font-size", "10px")
    .attr("fill", "#fff")
    .attr("opacity", 1)
    .text("Dra för att zooma");

  // Auto-hide hint efter 4 sekunder
  setTimeout(() => {
    if (!isZoomed) {
      hideBrushHint();
    }
  }, 4000);

  function showBrushHint() {
    brushHintBg.transition().duration(200).attr("opacity", 0.9);
    brushHintText.transition().duration(200).attr("opacity", 1);
  }

  function hideBrushHint() {
    brushHintBg.transition().duration(300).attr("opacity", 0);
    brushHintText.transition().duration(300).attr("opacity", 0);
  }

  // Reset-knapp (centrerad, initialt gömd)
  const resetWidth = 72;
  const resetBtnGroup = zoomControlsGroup.append("g")
    .attr("class", "reset-btn")
    .style("cursor", "pointer")
    .style("opacity", 0)
    .style("pointer-events", "none")
    .on("click", resetZoom)
    .on("mouseenter", function() {
      d3.select(this).select("rect").attr("fill", "#333");
    })
    .on("mouseleave", function() {
      d3.select(this).select("rect").attr("fill", "#1a1a1a");
    });

  resetBtnGroup.append("rect")
    .attr("x", -resetWidth / 2)
    .attr("y", -9)
    .attr("width", resetWidth)
    .attr("height", 18)
    .attr("rx", 3)
    .attr("fill", "#1a1a1a");

  resetBtnGroup.append("text")
    .attr("x", 0)
    .attr("y", 3)
    .attr("text-anchor", "middle")
    .attr("font-family", "'IBM Plex Sans', sans-serif")
    .attr("font-size", "10px")
    .attr("fill", "#fff")
    .text("↺ Återställ");

  function showResetBtn() {
    resetBtnGroup.transition().duration(200)
      .style("opacity", 1)
      .style("pointer-events", "auto");
  }

  function hideResetBtn() {
    resetBtnGroup.transition().duration(200)
      .style("opacity", 0)
      .style("pointer-events", "none");
  }

  // Spara referens till x-axel och y-axel groups för uppdatering
  const xAxisGroup = svg.select(".x-axis");
  const yAxisGroup = svg.select(".y-axis");

  // Brush-beteende
  const brush = d3.brush()
    .extent([[axisLeft, marginTop], [autoWidth - marginRight, height - marginBottom]])
    .on("start", brushStarted)
    .on("brush", brushing)
    .on("end", brushEnded);

  const brushGroup = svg.append("g")
    .attr("class", "graf-brush")
    .call(brush);

  function brushStarted(event) {
    if (event.selection) {
      hideBrushHint();
    }
  }

  function brushing(event) {
    // Kan användas för visuell feedback under brush
  }

  function brushEnded(event) {
    if (!event.selection) {
      // Ingen selektion = klick. Kolla om vi klickade nära en punkt.
      if (time && event.sourceEvent && hoveredPoint) {
        const lbl = hoveredPoint[label];
        if (lbl) {
          togglePinnedTrace(lbl);
          // Uppdatera hover-display
          handlePointHover(hoveredPoint, true);
        }
      }
      return;
    }

    const [[x0, y0], [x1, y1]] = event.selection;

    // Konvertera pixel till data-koordinater
    const newXMin = xScale.invert(x0);
    const newXMax = xScale.invert(x1);
    const newYMin = yScale.invert(y1);  // Y är inverterad (pixel y1 > y0 men data y1 < y0)
    const newYMax = yScale.invert(y0);

    // Rensa brush-selektionen först
    brushGroup.call(brush.move, null);

    // Uppdatera skalor och använd .nice() för snygga avrundade gränser
    // Använder fler ticks (10) för tightare avrundning, visar sedan färre
    xScale.domain([newXMin, newXMax]).nice(10);
    yScale.domain([newYMin, newYMax]).nice(10);

    // Hämta tick-värden (färre för visning)
    const xTickValues = xScale.ticks(5);
    const yTickValues = yScale.ticks(5);

    // Uppdatera X-axel
    xAxisGroup
      .call(d3.axisBottom(xScale).tickFormat(formatX).tickValues(xTickValues));
    xAxisGroup.select(".domain").attr("stroke", "#1a1a1a").attr("stroke-width", 1.5);
    xAxisGroup.selectAll(".tick line").attr("stroke", "#1a1a1a");
    xAxisGroup.selectAll(".tick text")
      .attr("fill", "#1a1a1a")
      .attr("font-size", "12px")
      .attr("font-family", "'IBM Plex Sans', sans-serif");

    // Uppdatera Y-axel
    yAxisGroup
      .call(d3.axisLeft(yScale).tickFormat(formatY).tickValues(yTickValues));
    yAxisGroup.select(".domain").attr("stroke", "#1a1a1a").attr("stroke-width", 1.5);
    yAxisGroup.selectAll(".tick line").attr("stroke", "#1a1a1a");
    yAxisGroup.selectAll(".tick text")
      .attr("x", -8)
      .attr("text-anchor", "end")
      .attr("fill", "#1a1a1a")
      .attr("font-size", "12px")
      .attr("font-family", "'IBM Plex Sans', sans-serif");

    // Rita om gridlinjer med de nya ticks
    if (showGrid) {
      // X grid
      xGridGroup.selectAll("line").remove();
      xTickValues.forEach(tickVal => {
        xGridGroup.append("line")
          .attr("x1", xScale(tickVal))
          .attr("x2", xScale(tickVal))
          .attr("y1", marginTop)
          .attr("y2", height - marginBottom)
          .attr("stroke", "#e0e0e0")
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", "12,6");
      });

      // Y grid
      yGridGroup.selectAll("line").remove();
      yTickValues.forEach(tickVal => {
        yGridGroup.append("line")
          .attr("x1", axisLeft)
          .attr("x2", autoWidth - marginRight)
          .attr("y1", yScale(tickVal))
          .attr("y2", yScale(tickVal))
          .attr("stroke", "#e0e0e0")
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", "12,6");
      });
    }

    // Uppdatera punkter
    isZoomed = true;
    hideBrushHint();
    showResetBtn();
    updateChart();
  }

  function resetZoom() {
    // Återställ skalor
    xScale.domain(originalXDomain);
    yScale.domain(originalYDomain);

    // Uppdatera X-axel
    xAxisGroup
      .call(d3.axisBottom(xScale).tickFormat(formatX).tickValues(xNice.ticks));
    xAxisGroup.select(".domain").attr("stroke", "#1a1a1a").attr("stroke-width", 1.5);
    xAxisGroup.selectAll(".tick line").attr("stroke", "#1a1a1a");
    xAxisGroup.selectAll(".tick text")
      .attr("fill", "#1a1a1a")
      .attr("font-size", "12px")
      .attr("font-family", "'IBM Plex Sans', sans-serif");

    // Uppdatera Y-axel
    yAxisGroup
      .call(d3.axisLeft(yScale).tickFormat(formatY).tickValues(yNice.ticks));
    yAxisGroup.select(".domain").attr("stroke", "#1a1a1a").attr("stroke-width", 1.5);
    yAxisGroup.selectAll(".tick line").attr("stroke", "#1a1a1a");
    yAxisGroup.selectAll(".tick text")
      .attr("x", -8)
      .attr("text-anchor", "end")
      .attr("fill", "#1a1a1a")
      .attr("font-size", "12px")
      .attr("font-family", "'IBM Plex Sans', sans-serif");

    // Återställ gridlinjer
    if (showGrid) {
      xGridGroup.selectAll("line").remove();
      xGridTicks.forEach(tickVal => {
        xGridGroup.append("line")
          .attr("x1", xScale(tickVal))
          .attr("x2", xScale(tickVal))
          .attr("y1", marginTop)
          .attr("y2", height - marginBottom)
          .attr("stroke", "#e0e0e0")
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", "12,6");
      });

      yGridGroup.selectAll("line").remove();
      yGridTicks.forEach(tickVal => {
        yGridGroup.append("line")
          .attr("x1", axisLeft)
          .attr("x2", autoWidth - marginRight)
          .attr("y1", yScale(tickVal))
          .attr("y2", yScale(tickVal))
          .attr("stroke", "#e0e0e0")
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", "12,6");
      });
    }

    isZoomed = false;
    hideResetBtn();

    // Visa hint igen och auto-hide efter 3 sekunder
    showBrushHint();
    setTimeout(() => {
      if (!isZoomed) {
        hideBrushHint();
      }
    }, 3000);

    updateChart();
  }


  // ==========================================================================
  // MOUSE OVERLAY FÖR HOVER (anpassad för brush)
  // ==========================================================================
  let hoveredPoint = null;

  // Hover-hantering via brush-overlay (brush fångar events, så vi lyssnar på brushGroup)
  brushGroup
    .on("mousemove.hover", function(event) {
      const [mx, my] = d3.pointer(event);
      const currentData = getDataForTime(currentTime);

      // Hitta närmaste punkt
      let closest = null;
      let minDist = Infinity;

      currentData.forEach(d => {
        const px = xScale(d[x]);
        const py = yScale(d[y]);
        const dist = Math.sqrt((mx - px) ** 2 + (my - py) ** 2);
        if (dist < minDist && dist < 40) {
          minDist = dist;
          closest = d;
        }
      });

      if (closest !== hoveredPoint) {
        if (hoveredPoint) {
          handlePointHover(hoveredPoint, false);
        }
        hoveredPoint = closest;
        if (hoveredPoint) {
          handlePointHover(hoveredPoint, true);
        }
      }
    })
    .on("mouseleave.hover", function() {
      if (hoveredPoint) {
        handlePointHover(hoveredPoint, false);
        hoveredPoint = null;
      }
    });

  // Initial rendering
  updateChart();

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
    height,
    altText,
    info,
    logo
  });

  return container.node();
}
