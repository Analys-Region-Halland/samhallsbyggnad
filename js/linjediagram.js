// =============================================================================
// LINJEDIAGRAM - Universell D3-komponent med highlight-stöd
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "./exportSvg.js";
import { createFilterState, createSelectorPanel } from "./filterUtils.js";

// Hjälpfunktion: beräkna y-skala TIGHT mot data
function niceScaleRange(dataMin, dataMax, targetTicks = 5) {
  if (dataMax <= dataMin) return { min: 0, max: 10, ticks: [0, 2, 4, 6, 8, 10] };

  const range = dataMax - dataMin;

  // Hitta lämpligt tick-intervall
  const rawInterval = range / (targetTicks - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
  const normalized = rawInterval / magnitude;

  let niceInterval;
  if (normalized <= 1) niceInterval = 1;
  else if (normalized <= 2) niceInterval = 2;
  else if (normalized <= 5) niceInterval = 5;
  else niceInterval = 10;

  const interval = niceInterval * magnitude;

  // Ticks: täck data med snygga värden
  const firstTick = Math.floor(dataMin / interval) * interval;
  const lastTick = Math.round(dataMax / interval) * interval;

  const ticks = [];
  for (let v = firstTick; v <= lastTick + interval * 0.01; v += interval) {
    ticks.push(Math.round(v * 1000) / 1000);
  }

  if (ticks.length < 2) {
    ticks.push(firstTick + interval);
  }

  // Skala: börja vid första tick, sluta strax ovanför data
  const scaleMin = firstTick;
  const scaleMax = dataMax + (range * 0.03); // Liten luft så max-värdet inte kläms

  return { min: scaleMin, max: scaleMax, interval, ticks };
}

// Hjälpfunktion: skala som börjar på 0 (tight version)
function niceScaleFromZero(dataMax, targetTicks = 5) {
  if (dataMax <= 0) return { min: 0, max: 10, ticks: [0, 2, 4, 6, 8, 10] };

  // Minimal padding ovanför data
  const scaleMax = dataMax * 1.02;

  const rawInterval = dataMax / (targetTicks - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawInterval)));
  const normalized = rawInterval / magnitude;

  let niceInterval;
  if (normalized <= 1) niceInterval = 1;
  else if (normalized <= 2) niceInterval = 2;
  else if (normalized <= 5) niceInterval = 5;
  else niceInterval = 10;

  const interval = niceInterval * magnitude;

  // Ticks från 0 upp till (men inte nödvändigtvis förbi) scaleMax
  const ticks = [];
  for (let v = 0; v <= scaleMax + interval * 0.01; v += interval) {
    ticks.push(v);
  }

  return { min: 0, max: scaleMax, interval, ticks };
}

export function linjediagram(initialData, {
  x = "år",
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
  curve = d3.curveMonotoneX,
  filter = null,
  highlight = null,
  backgroundOpacity = 0.2,
  backgroundStrokeWidth = 1.2,
  yMin = 0,  // 0, "auto", eller specifikt värde
  altText = null,  // Alternativtext för tillgänglighet
  info = null,  // Information om grafen (metodbeskrivning etc)
  hline = null,  // Horisontell referenslinje: nummer eller {value, label, color, dashed}
  vline = null,  // Vertikal referenslinje: nummer eller {value, label, color, dashed}
  logo = null,   // Sökväg till logotyp (visas i övre högra hörnet)
  showGrid = true,  // Visa subtila gridlinjer på y-axeln
  interactive = false,  // Aktivera interaktiv kontrollpanel
  maxHighlights = 6,  // Max antal highlightade serier (för läsbarhet)
  rescaleY = false,  // Omskalera y-axeln baserat på synliga/highlighted serier
  measures = null  // [{key, label, description?, data, yLabel?, yMin?, hline?, formatY?}]
} = {}) {

  // Mutable state (stödjer measures-byte)
  let data = measures ? measures[0].data : initialData;
  let currentMeasureIdx = 0;
  if (measures) {
    const m = measures[0];
    if (m.formatY) formatY = m.formatY;
    if (m.yMin !== undefined) yMin = m.yMin;
    if (m.hline !== undefined) hline = m.hline;
    if (m.yLabel) yLabel = m.yLabel;
    if (m.subtitle) subtitle = m.subtitle;
  }

  // Dimensioner - tydlig breakout-effekt
  const autoWidth = width || 780;
  const marginTop = yLabel ? 32 : 16;
  // Mer högermarginl för snygga etiketter (OWID-stil)
  // Interactive eller highlight kräver plats för etiketter
  const marginRight = (interactive || highlight || color) ? 130 : 28;
  const marginBottom = xLabel ? 44 : 34;
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

  // ==========================================================================
  // TIDSINTERVALL-KONTROLL I UNDERTITELN
  // ==========================================================================
  let allXValues = [...new Set(data.map(d => d[x]))].sort((a, b) => a - b);
  let currentStartYear = allXValues[0];
  let currentEndYear = allXValues[allXValues.length - 1];
  const hasTimeRange = allXValues.length > 1;
  let timeRangeControl = null;
  let updateChartRange = null;  // Definieras senare
  let subtitleTextSpan = null;
  let measurePanel = null;

  if (subtitle || hasTimeRange) {
    // Inject CSS för tidskontroll (delad med andra grafer)
    if (hasTimeRange && !document.getElementById("graf-time-control-styles")) {
      const styles = document.createElement("style");
      styles.id = "graf-time-control-styles";
      styles.textContent = `
        .graf-subtitle-wrapper {
          font-family: 'IBM Plex Sans', sans-serif;
          font-size: 14px;
          color: #666;
          line-height: 1.4;
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
          top: 100%;
          left: 0;
          margin-top: 4px;
          padding: 5px 8px;
          background: #fff;
          border: 1px solid #1a1a1a;
          border-radius: 3px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          z-index: 100;
          white-space: nowrap;
        }
        .graf-time-control.expanded .graf-time-panel {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .graf-time-slider {
          width: 70px;
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
          width: 20px;
          height: 20px;
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
        .graf-time-range-label {
          font-size: 10px;
          color: #666;
          margin-right: 4px;
        }
      `;
      document.head.appendChild(styles);
    }

    // Inject CSS för measure-väljare (en gång)
    if (measures && measures.length > 1 && !document.getElementById("graf-measure-styles")) {
      const mStyles = document.createElement("style");
      mStyles.id = "graf-measure-styles";
      mStyles.textContent = `
        .graf-measure-control {
          display: inline;
          position: relative;
          user-select: none;
        }
        .graf-measure-label {
          cursor: pointer;
          font-weight: 600;
          color: #1a1a1a;
          text-decoration: underline;
          text-decoration-style: dotted;
          text-decoration-color: #bbb;
          text-underline-offset: 2px;
          transition: text-decoration-color 0.15s;
        }
        .graf-measure-label:hover {
          text-decoration-color: #00664D;
          text-decoration-style: solid;
        }
        .graf-measure-panel {
          display: none;
          position: absolute;
          top: 100%;
          left: 0;
          margin-top: 4px;
          background: #fff;
          border: 1px solid #1a1a1a;
          z-index: 100;
          white-space: nowrap;
          padding: 4px 0;
          min-width: 140px;
        }
        .graf-measure-control.expanded .graf-measure-panel {
          display: block;
        }
        .graf-measure-option {
          display: block;
          padding: 5px 14px;
          font-size: 13px;
          cursor: pointer;
          font-family: 'IBM Plex Sans', sans-serif;
          color: #555;
          transition: background 0.1s;
        }
        .graf-measure-option:hover {
          background: #f0f0f0;
          color: #1a1a1a;
        }
        .graf-measure-option.active {
          font-weight: 600;
          color: #1a1a1a;
        }
      `;
      document.head.appendChild(mStyles);
    }

    const subtitleWrapper = header.append("div")
      .attr("class", "graf-subtitle-wrapper");

    // Measure-väljare i subtiteln
    if (measures && measures.length > 1) {
      const measureControl = subtitleWrapper.append("span")
        .attr("class", "graf-measure-control");

      const measureLabel = measureControl.append("span")
        .attr("class", "graf-subtitle-text graf-measure-label")
        .text(measures[currentMeasureIdx].label);

      measurePanel = measureControl.append("div")
        .attr("class", "graf-measure-panel");

      measures.forEach((m, i) => {
        measurePanel.append("div")
          .attr("class", `graf-measure-option${i === currentMeasureIdx ? " active" : ""}`)
          .text(m.filterLabel || m.label)
          .on("click", () => {
            switchMeasure(i);
            measureLabel.text(measures[currentMeasureIdx].label);
            measurePanel.selectAll(".graf-measure-option")
              .each(function(d, j) { d3.select(this).classed("active", j === i); });
            measureControl.classed("expanded", false);
          });
      });

      // Hover expand/collapse
      let mTimeout;
      measureControl.on("mouseenter", () => {
        clearTimeout(mTimeout);
        measureControl.classed("expanded", true);
      });
      measureControl.on("mouseleave", () => {
        clearTimeout(mTimeout);
        mTimeout = setTimeout(() => measureControl.classed("expanded", false), 200);
      });
    }

    if (hasTimeRange && subtitle) {
      // Dela upp subtitle för att ersätta årtalsspan
      const yearRangeMatch = subtitle.match(/^(.+?)(\d{4})\s*[–\-]\s*(\d{4})(.*)$/);

      if (yearRangeMatch) {
        const [, prefix, startYear, endYear, suffix] = yearRangeMatch;
        const cleanPrefix = prefix.replace(/[,\s]+$/, '');

        // Om measures → label är hela titeltexten, skippa description
        if (!measures) {
          subtitleTextSpan = subtitleWrapper.append("span")
            .attr("class", "graf-subtitle-text")
            .text(cleanPrefix);
        }

        timeRangeControl = subtitleWrapper.append("span")
          .attr("class", "graf-time-control");

        const trigger = timeRangeControl.append("span")
          .attr("class", "graf-time-trigger");

        trigger.append("span")
          .text(measures ? ",\u00A0" : "\u00A0(");

        trigger.append("span")
          .attr("class", "graf-time-year graf-time-start")
          .text(currentStartYear);

        trigger.append("span")
          .text("–");

        trigger.append("span")
          .attr("class", "graf-time-year graf-time-end")
          .text(currentEndYear);

        trigger.append("span")
          .text(measures ? "" : ")");

        const panel = timeRangeControl.append("div")
          .attr("class", "graf-time-panel");

        // Start-år kontroll
        panel.append("span")
          .attr("class", "graf-time-range-label")
          .text("Från:");

        const startSlider = panel.append("input")
          .attr("type", "range")
          .attr("class", "graf-time-slider")
          .attr("min", 0)
          .attr("max", allXValues.length - 2)
          .attr("value", 0)
          .on("input", function() {
            const startIdx = +this.value;
            const endIdx = +endSlider.property("value");
            if (startIdx >= endIdx) {
              endSlider.property("value", startIdx + 1);
            }
            updateTimeRange();
          });

        panel.append("span")
          .attr("class", "graf-time-range-label")
          .style("margin-left", "12px")
          .text("Till:");

        const endSlider = panel.append("input")
          .attr("type", "range")
          .attr("class", "graf-time-slider")
          .attr("min", 1)
          .attr("max", allXValues.length - 1)
          .attr("value", allXValues.length - 1)
          .on("input", function() {
            const endIdx = +this.value;
            const startIdx = +startSlider.property("value");
            if (endIdx <= startIdx) {
              startSlider.property("value", endIdx - 1);
            }
            updateTimeRange();
          });

        // Reset-knapp
        const resetBtn = panel.append("button")
          .attr("class", "graf-time-play-btn")
          .attr("title", "Återställ")
          .html("↺")
          .on("click", () => {
            startSlider.property("value", 0);
            endSlider.property("value", allXValues.length - 1);
            updateTimeRange();
          });

        if (suffix) {
          subtitleWrapper.append("span")
            .attr("class", "graf-subtitle-text")
            .text(suffix);
        }

        // Hover-hantering
        let hoverTimeout = null;
        timeRangeControl.on("mouseenter", () => {
          clearTimeout(hoverTimeout);
          timeRangeControl.classed("expanded", true);
        });
        timeRangeControl.on("mouseleave", () => {
          clearTimeout(hoverTimeout);
          hoverTimeout = setTimeout(() => {
            timeRangeControl.classed("expanded", false);
          }, 300);
        });

        function updateTimeRange() {
          const startIdx = +startSlider.property("value");
          const endIdx = +endSlider.property("value");
          currentStartYear = allXValues[startIdx];
          currentEndYear = allXValues[endIdx];

          trigger.select(".graf-time-start").text(currentStartYear);
          trigger.select(".graf-time-end").text(currentEndYear);

          if (updateChartRange) updateChartRange();
        }

      } else {
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

  // Gruppera data (behövs före selektor-skapande)
  let groups = color
    ? d3.group(data, d => d[color])
    : new Map([["_all", data]]);

  let allKeys = [...groups.keys()];

  // FilterState via filterUtils (groupField: null → flat lista av serienamn)
  const filterState = color
    ? createFilterState(data, { itemField: color, groupField: null, filter, highlight })
    : null;

  const isHighlighted = (key) => {
    if (!filterState) return true;
    return filterState.isHighlighted(key);
  };

  // Färgpalett
  const mutedColor = "#d0d0d0";
  const otherColor = "#7a8b99";

  const getColor = (key) => {
    const hl = filterState ? filterState.getHighlight() : null;
    if (!hl) return colors[allKeys.indexOf(key) % colors.length];
    const idx = hl.indexOf(key);
    if (idx === 0) return colors[0];
    if (idx === 1) return colors[1];
    if (idx >= 2) return otherColor;
    return mutedColor;
  };

  const colorScale = (key) => getColor(key);

  // ==========================================================================
  // INTERAKTIV REGIONVÄLJARE (via filterUtils)
  // ==========================================================================
  let selectorCtrl = null;

  if (interactive && color && filterState) {
    selectorCtrl = createSelectorPanel(header, {
      filterState,
      allItems: allKeys,
      colorScale,
      triggerText: "Jämför regioner \u203a",
      onUpdate: () => { rescaleYAxis(true); updateChart(); },
      onItemHover: (item) => {
        const hoverColor = isHighlighted(item) ? colorScale(item) : "#555";
        linesGroup.selectAll("path").each(function() {
          const el = d3.select(this);
          const key = el.attr("data-key");
          if (key === item) {
            el.attr("stroke-width", 2.8).attr("stroke-opacity", 1).attr("stroke", hoverColor);
          } else {
            el.attr("stroke-opacity", 0.12);
          }
        });
        linesGroup.selectAll("circle").each(function() {
          const el = d3.select(this);
          el.attr("fill-opacity", el.attr("data-key") === item ? 1 : 0.12);
        });
        // Visa etikett vid slutet (för ej redan highlightade)
        if (!isHighlighted(item)) {
          const groupData = groups.get(item);
          if (groupData) {
            const sortedData = [...groupData]
              .filter(d => d[x] >= currentStartYear && d[x] <= currentEndYear)
              .sort((a, b) => a[x] - b[x]);
            if (sortedData.length > 0) {
              const lastPoint = sortedData[sortedData.length - 1];
              labelsGroup.selectAll(".hover-label").remove();
              labelsGroup.append("circle")
                .attr("class", "hover-label")
                .attr("cx", xScale(lastPoint[x]))
                .attr("cy", yScale(lastPoint[y]))
                .attr("r", 5)
                .attr("fill", hoverColor);
              labelsGroup.append("text")
                .attr("class", "hover-label")
                .attr("x", xScale(lastPoint[x]) + 8)
                .attr("y", yScale(lastPoint[y]))
                .attr("dy", "0.35em")
                .attr("font-family", "'IBM Plex Sans', sans-serif")
                .attr("font-size", "11px")
                .attr("font-weight", "600")
                .attr("fill", hoverColor)
                .text(item);
            }
          }
        }
      },
      onItemLeave: () => {
        linesGroup.selectAll("path").each(function() {
          const el = d3.select(this);
          const key = el.attr("data-key");
          if (el.classed("line-highlight")) {
            el.attr("stroke-width", 2).attr("stroke-opacity", 1).attr("stroke", colorScale(key));
          } else {
            el.attr("stroke-width", 1.2).attr("stroke-opacity", 0.25).attr("stroke", "#aaa");
          }
        });
        linesGroup.selectAll("circle").attr("fill-opacity", 1);
        labelsGroup.selectAll(".hover-label").remove();
      }
    });
  }

  // Inject tooltip CSS (en gång)
  if (!document.getElementById("graf-tooltip-styles")) {
    const styles = document.createElement("style");
    styles.id = "graf-tooltip-styles";
    styles.textContent = `
      .graf-tooltip {
        position: absolute;
        background: #fff;
        font-family: 'IBM Plex Sans', sans-serif;
        font-size: 11px;
        pointer-events: none;
        z-index: 1000;
        box-shadow: 0 2px 8px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.08);
        border: 1px solid #1a1a1a;
        min-width: 140px;
        overflow: hidden;
      }
      .graf-tooltip-year {
        font-size: 12px;
        font-weight: 700;
        color: #fff;
        background: #1a1a1a;
        padding: 6px 10px;
        letter-spacing: 0.02em;
      }
      .graf-tooltip-list {
        display: flex;
        flex-direction: column;
      }
      .graf-tooltip-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 5px 10px;
        line-height: 1.3;
      }
      .graf-tooltip-row:nth-child(odd) {
        background: #f8f8f8;
      }
      .graf-tooltip-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .graf-tooltip-name {
        color: #444;
        flex: 1;
      }
      .graf-tooltip-val {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: #1a1a1a;
      }
      .graf-tooltip-row.focused {
        background: #e8f4ec !important;
      }
      .graf-tooltip-row.focused .graf-tooltip-name {
        font-weight: 600;
        color: #1a1a1a;
      }
      .graf-tooltip-preview {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        margin-top: 1px;
        border-top: 1px dashed #ddd;
        background: #f5f5f5;
        font-style: italic;
        line-height: 1.3;
      }
      .graf-tooltip-add {
        font-size: 9px;
        color: #888;
        margin-left: auto;
      }
    `;
    document.head.appendChild(styles);
  }

  // Tooltip (för hover på grafen)
  const tooltip = container.append("div")
    .attr("class", "graf-tooltip")
    .style("display", "none");

  // SVG-container
  const svgContainer = container.append("div")
    .attr("class", "graf-svg-container");

  const svg = svgContainer.append("svg")
    .attr("viewBox", `0 0 ${autoWidth} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("class", "graf-svg");


  // Beräkna y-skala baserat på yMin-inställning
  const dataMax = d3.max(data, d => d[y]);
  const dataMinVal = d3.min(data, d => d[y]);

  let yNice;
  if (yMin === "auto") {
    // Tight fit till data - niceScaleRange hanterar minimal padding
    yNice = niceScaleRange(dataMinVal, dataMax, 5);
  } else if (typeof yMin === "number") {
    // Specifikt startvärde
    yNice = niceScaleRange(yMin, dataMax, 5);
  } else {
    // Default: börja på 0
    yNice = niceScaleFromZero(dataMax, 5);
  }

  const maxTickWidth = formatY(yNice.max).length * 6 + 8;
  const axisLeft = marginLeft + maxTickWidth;

  // Skalor (initialt baserade på currentStartYear/currentEndYear)
  const xScale = d3.scaleLinear()
    .domain([currentStartYear, currentEndYear])
    .range([axisLeft, autoWidth - marginRight]);

  const yScale = d3.scaleLinear()
    .domain([yNice.min, yNice.max])
    .range([height - marginBottom, marginTop]);

  // Axlar
  const xAxis = d3.axisBottom(xScale)
    .tickFormat(d3.format("d"))
    .ticks(Math.min(10, currentEndYear - currentStartYear));

  const yAxis = d3.axisLeft(yScale)
    .tickFormat(formatY)
    .tickValues(yNice.ticks);

  // X-axel (spara referens för uppdatering)
  const xAxisGroup = svg.append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${height - marginBottom})`)
    .call(xAxis)
    .call(g => g.select(".domain").attr("stroke", "#1a1a1a"))
    .call(g => g.selectAll(".tick line").attr("stroke", "#1a1a1a"))
    .call(g => g.selectAll(".tick text")
      .attr("fill", "#1a1a1a")
      .attr("font-size", "13px")
      .attr("font-family", "'IBM Plex Sans', sans-serif"));

  if (xLabel) {
    svg.append("text")
      .attr("x", axisLeft + (autoWidth - marginRight - axisLeft) / 2)
      .attr("y", height - 8)
      .attr("text-anchor", "middle")
      .attr("class", "graf-axis-label")
      .text(xLabel);
  }

  // ==========================================================================
  // PLAY-KNAPP - Animerar linjerna från start till slut
  // ==========================================================================
  let isAnimating = false;

  const playBtn = svg.append("g")
    .attr("class", "play-btn")
    .attr("transform", `translate(${autoWidth - marginRight + 28}, ${height - marginBottom + 8})`)
    .style("cursor", "pointer")
    .on("mouseenter", function() {
      d3.select(this).select("rect").attr("fill", "#333");
    })
    .on("mouseleave", function() {
      d3.select(this).select("rect").attr("fill", "#000");
    })
    .on("click", playAnimation);

  playBtn.append("rect")
    .attr("x", -8)
    .attr("y", -8)
    .attr("width", 16)
    .attr("height", 16)
    .attr("fill", "#000");

  playBtn.append("path")
    .attr("d", "M-2.5,-4 L-2.5,4 L4,0 Z")
    .attr("fill", "#fff");

  function playAnimation() {
    if (isAnimating) return;
    isAnimating = true;
    playBtn.style("opacity", 0.8);

    // Animera alla synliga linjer
    linesGroup.selectAll("path").each(function() {
      const path = d3.select(this);
      const totalLength = this.getTotalLength();

      path
        .attr("stroke-dasharray", totalLength)
        .attr("stroke-dashoffset", totalLength)
        .transition()
        .duration(2000)
        .ease(d3.easeLinear)
        .attr("stroke-dashoffset", 0)
        .on("end", function() {
          d3.select(this).attr("stroke-dasharray", null);
        });
    });

    // Animera slutpunkter (visa efter linjerna)
    linesGroup.selectAll("circle")
      .style("opacity", 0)
      .transition()
      .delay(1800)
      .duration(300)
      .style("opacity", 1);

    // Återställ play-knapp
    setTimeout(() => {
      isAnimating = false;
      playBtn.style("opacity", 0.3);
    }, 2200);
  }

  // Y-axel - OWID-stil: bara tick-labels, ingen axellinje
  const yAxisGroup = svg.append("g")
    .attr("class", "y-axis")
    .attr("transform", `translate(${axisLeft},0)`)
    .call(yAxis)
    .call(g => g.select(".domain").remove())  // Ta bort y-axellinjen
    .call(g => g.selectAll(".tick line").remove())  // Ta bort tick-strecken
    .call(g => g.selectAll(".tick text")
      .attr("x", -8)
      .attr("text-anchor", "end")
      .attr("fill", "#666")
      .attr("font-size", "12px")
      .attr("font-family", "'IBM Plex Sans', sans-serif"));

  const yLabelEl = svg.append("text")
    .attr("x", axisLeft)
    .attr("y", marginTop - 14)
    .attr("text-anchor", "start")
    .attr("font-family", "'IBM Plex Sans', sans-serif")
    .attr("font-size", "11px")
    .attr("font-weight", "600")
    .attr("fill", "#555")
    .text(yLabel || "")
    .style("display", yLabel ? null : "none");

  // ==========================================================================
  // GRIDLINJER (OWID-stil) - subtila streckade horisontella linjer
  // ==========================================================================
  const gridGroup = svg.insert("g", ":first-child").attr("class", "grid-lines");

  if (showGrid) {
    yNice.ticks.forEach(tickVal => {
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


  // Linjegenerator
  const line = d3.line()
    .x(d => xScale(d[x]))
    .y(d => yScale(d[y]))
    .curve(curve);

  // ==========================================================================
  // REFERENSLINJER (hline/vline) - ritas först så de hamnar under data
  // ==========================================================================

  // Horisontell referenslinje - i grupp för enkel uppdatering vid measure-byte
  const hlineGroup = svg.append("g").attr("class", "hline-group");

  function renderHline() {
    hlineGroup.selectAll("*").remove();
    if (hline === null) return;

    const hlineConfig = typeof hline === "number"
      ? { value: hline }
      : hline;

    const hlineY = yScale(hlineConfig.value);
    const hlineColor = hlineConfig.color || "#1a1a1a";
    const hlineDashed = hlineConfig.dashed === true;

    hlineGroup.append("line")
      .attr("class", "reference-line hline")
      .attr("x1", axisLeft)
      .attr("x2", autoWidth - marginRight)
      .attr("y1", hlineY)
      .attr("y2", hlineY)
      .attr("stroke", hlineColor)
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", hlineDashed ? "6,4" : "none")
      .attr("stroke-opacity", 0.5);

    if (hlineConfig.label) {
      hlineGroup.append("text")
        .attr("class", "reference-label")
        .attr("x", autoWidth - marginRight + 6)
        .attr("y", hlineY)
        .attr("dy", "0.35em")
        .attr("font-family", "'IBM Plex Sans', sans-serif")
        .attr("font-size", "10px")
        .attr("font-weight", "500")
        .attr("fill", hlineColor)
        .attr("opacity", 0.7)
        .text(hlineConfig.label);
    }
  }
  renderHline();

  // Vertikal referenslinje
  if (vline !== null) {
    const vlineConfig = typeof vline === "number"
      ? { value: vline }
      : vline;

    const vlineX = xScale(vlineConfig.value);
    const vlineColor = vlineConfig.color || "#666";
    const vlineDashed = vlineConfig.dashed !== false;

    // Rita linjen
    svg.append("line")
      .attr("class", "reference-line vline")
      .attr("x1", vlineX)
      .attr("x2", vlineX)
      .attr("y1", marginTop)
      .attr("y2", height - marginBottom)
      .attr("stroke", vlineColor)
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", vlineDashed ? "4,3" : "none")
      .attr("stroke-opacity", 0.6);

    // Etikett om den finns
    if (vlineConfig.label) {
      svg.append("text")
        .attr("class", "reference-label")
        .attr("x", vlineX + 6)
        .attr("y", marginTop + 14)
        .attr("font-family", "'IBM Plex Sans', sans-serif")
        .attr("font-size", "11px")
        .attr("font-weight", "500")
        .attr("fill", vlineColor)
        .text(vlineConfig.label);
    }
  }

  // ==========================================================================
  // SWITCH MEASURE (om measures är aktiverat)
  // ==========================================================================
  function switchMeasure(idx) {
    if (!measures || idx === currentMeasureIdx || idx < 0 || idx >= measures.length) return;
    currentMeasureIdx = idx;
    const m = measures[idx];

    // Uppdatera mutable state
    data = m.data;
    if (m.formatY) formatY = m.formatY;
    if (m.yMin !== undefined) yMin = m.yMin;
    if (m.hline !== undefined) hline = m.hline;
    if (m.yLabel) yLabel = m.yLabel;

    // Beräkna om grupper
    groups = color
      ? d3.group(data, d => d[color])
      : new Map([["_all", data]]);
    allKeys = [...groups.keys()];

    // Beräkna om x-intervall
    allXValues = [...new Set(data.map(d => d[x]))].sort((a, b) => a - b);
    currentStartYear = Math.max(currentStartYear, allXValues[0]);
    currentEndYear = Math.min(currentEndYear, allXValues[allXValues.length - 1]);

    // Beräkna om y-skala
    const newMax = d3.max(data, d => d[y]);
    const newMin = d3.min(data, d => d[y]);
    if (yMin === "auto") {
      yNice = niceScaleRange(newMin, newMax, 5);
    } else if (typeof yMin === "number") {
      yNice = niceScaleRange(yMin, newMax, 5);
    } else {
      yNice = niceScaleFromZero(newMax, 5);
    }
    yScale.domain([yNice.min, yNice.max]);

    // Uppdatera y-axel med transition
    const newYAxis = d3.axisLeft(yScale)
      .tickFormat(formatY)
      .tickValues(yNice.ticks);
    yAxisGroup.transition().duration(400)
      .call(newYAxis)
      .call(g => g.select(".domain").remove())
      .call(g => g.selectAll(".tick line").remove())
      .call(g => g.selectAll(".tick text")
        .attr("x", -8).attr("text-anchor", "end")
        .attr("fill", "#666").attr("font-size", "12px")
        .attr("font-family", "'IBM Plex Sans', sans-serif"));

    // Uppdatera gridlinjer
    gridGroup.selectAll("*").remove();
    if (showGrid) {
      yNice.ticks.forEach(tickVal => {
        gridGroup.append("line")
          .attr("x1", axisLeft).attr("x2", autoWidth - marginRight)
          .attr("y1", yScale(tickVal)).attr("y2", yScale(tickVal))
          .attr("stroke", "#e0e0e0").attr("stroke-width", 1)
          .attr("stroke-dasharray", "12,6");
      });
    }

    // Uppdatera hline
    renderHline();

    // Uppdatera y-label
    if (yLabelEl) {
      yLabelEl.text(yLabel || "").style("display", yLabel ? null : "none");
    }

    // Rita om linjer
    updateChart();
  }

  // ==========================================================================
  // GRUPPER FÖR LINJER OCH ETIKETTER (för uppdatering)
  // ==========================================================================
  const linesGroup = svg.append("g").attr("class", "lines-group");
  const labelsGroup = svg.append("g").attr("class", "line-labels");

  // ==========================================================================
  // RESCALE Y-AXEL (om rescaleY är aktiverat)
  // ==========================================================================
  function rescaleYAxis(force = false) {
    if (!rescaleY && !force) return;

    // Samla data från synliga serier (exkludera dolda) inom aktuellt tidsintervall
    // Vid force (hide/unhide): inkludera ALLA icke-dolda linjer (även grå bakgrund)
    // Vid vanlig rescale: bara highlighted om sådana finns
    const hidden = filterState ? filterState.getHidden() : [];
    const hiddenSet = new Set(hidden);
    const hl = filterState ? filterState.getHighlight() : null;
    let visibleData;

    if (force || !hl || hl.length === 0) {
      // Alla synliga (exkl dolda) - säkerställer att grå bakgrundslinjer inte klipps
      visibleData = data.filter(d =>
        !hiddenSet.has(d[color]) && d[x] >= currentStartYear && d[x] <= currentEndYear
      );
    } else {
      // Bara highlighted serier (exkl dolda)
      const hlSet = new Set(hl);
      visibleData = data.filter(d =>
        hlSet.has(d[color]) && !hiddenSet.has(d[color]) && d[x] >= currentStartYear && d[x] <= currentEndYear
      );
    }

    if (visibleData.length === 0) return;

    const newMax = d3.max(visibleData, d => d[y]);
    const newMin = d3.min(visibleData, d => d[y]);

    let newYNice;
    if (yMin === "auto") {
      newYNice = niceScaleRange(newMin, newMax, 5);
    } else if (typeof yMin === "number") {
      newYNice = niceScaleRange(yMin, newMax, 5);
    } else {
      newYNice = niceScaleFromZero(newMax, 5);
    }

    yNice = newYNice;
    yScale.domain([yNice.min, yNice.max]);

    // Uppdatera y-axel med transition
    const newYAxis = d3.axisLeft(yScale)
      .tickFormat(formatY)
      .tickValues(yNice.ticks);

    yAxisGroup
      .transition().duration(400)
      .call(newYAxis)
      .call(g => g.select(".domain").remove())
      .call(g => g.selectAll(".tick line").remove())
      .call(g => g.selectAll(".tick text")
        .attr("x", -8)
        .attr("text-anchor", "end")
        .attr("fill", "#666")
        .attr("font-size", "12px")
        .attr("font-family", "'IBM Plex Sans', sans-serif"));

    // Uppdatera gridlinjer
    gridGroup.selectAll("*").remove();
    if (showGrid) {
      yNice.ticks.forEach(tickVal => {
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

    // Uppdatera hline-position
    renderHline();
  }

  // ==========================================================================
  // UPPDATERINGSFUNKTION - Ritar om linjer och etiketter
  // ==========================================================================
  function updateChart() {
    // Omskalera y-axeln baserat på synliga serier
    rescaleYAxis();

    // Rensa befintliga linjer och etiketter
    linesGroup.selectAll("*").remove();
    labelsGroup.selectAll("*").remove();

    const allEndpoints = [];

    // Rita bakgrundslinjer (ej highlighted, ej dolda) först
    for (const [key, values] of groups) {
      if (isHighlighted(key)) continue;
      if (filterState && filterState.isHidden(key)) continue;

      const sortedValues = [...values]
        .filter(d => d[x] >= currentStartYear && d[x] <= currentEndYear)
        .sort((a, b) => a[x] - b[x]);

      if (sortedValues.length < 2) continue;

      linesGroup.append("path")
        .datum(sortedValues)
        .attr("class", "line-bg")
        .attr("data-key", key)
        .attr("fill", "none")
        .attr("stroke", "#aaa")
        .attr("stroke-width", backgroundStrokeWidth)
        .attr("stroke-opacity", backgroundOpacity)
        .attr("d", line);
    }

    // Rita highlighted linjer ovanpå (ej dolda)
    for (const [key, values] of groups) {
      if (!isHighlighted(key)) continue;
      if (filterState && filterState.isHidden(key)) continue;

      const sortedValues = [...values]
        .filter(d => d[x] >= currentStartYear && d[x] <= currentEndYear)
        .sort((a, b) => a[x] - b[x]);

      if (sortedValues.length < 2) continue;

      const lineColor = colorScale(key);

      // Linje
      linesGroup.append("path")
        .datum(sortedValues)
        .attr("class", "line-highlight")
        .attr("data-key", key)
        .attr("fill", "none")
        .attr("stroke", lineColor)
        .attr("stroke-width", 2)
        .attr("d", line);

      // Endast sista punkten som cirkel
      const lastPoint = sortedValues[sortedValues.length - 1];
      linesGroup.append("circle")
        .attr("class", "endpoint")
        .attr("data-key", key)
        .attr("cx", xScale(lastPoint[x]))
        .attr("cy", yScale(lastPoint[y]))
        .attr("r", 4)
        .attr("fill", lineColor);

      allEndpoints.push({
        key,
        xPos: xScale(lastPoint[x]),
        yPos: yScale(lastPoint[y]),
        yVal: lastPoint[y],
        color: lineColor
      });
    }

    // Direktetiketter - OWID-stil med eleganta connector-linjer
    if (allEndpoints.length > 0) {
      const labelFontSize = 12;
      const minSpacing = 18;

      // Sortera efter y-position (pixel)
      allEndpoints.sort((a, b) => a.yPos - b.yPos);

      // Beräkna optimala etikett-positioner med kollisionshantering
      const chartTop = marginTop + 8;
      const chartBottom = height - marginBottom - 8;

      const labelPositions = allEndpoints.map(ep => ({
        ...ep,
        labelY: ep.yPos,
        idealY: ep.yPos
      }));

      // Relaxation: flytta isär överlappande etiketter
      for (let iteration = 0; iteration < 20; iteration++) {
        let moved = false;

        for (let i = 0; i < labelPositions.length; i++) {
          const current = labelPositions[i];

          for (let j = 0; j < i; j++) {
            const prev = labelPositions[j];
            const overlap = (prev.labelY + minSpacing) - current.labelY;

            if (overlap > 0) {
              current.labelY += overlap * 0.6;
              prev.labelY -= overlap * 0.4;
              moved = true;
            }
          }

          current.labelY = Math.max(chartTop, Math.min(chartBottom, current.labelY));
        }

        if (!moved) break;
      }

      labelPositions.forEach(lp => {
        lp.labelY = Math.max(chartTop, Math.min(chartBottom, lp.labelY));
      });

      // Rita etiketter
      const connectorStartX = autoWidth - marginRight + 8;
      const labelX = autoWidth - marginRight + 14;

      for (const lp of labelPositions) {
        const pointEndX = lp.xPos + 7;
        const needsDiagonal = Math.abs(lp.labelY - lp.yPos) > 3;

        if (needsDiagonal) {
          const midX = connectorStartX - 6;

          labelsGroup.append("path")
            .attr("d", `M ${pointEndX} ${lp.yPos}
                        L ${midX} ${lp.yPos}
                        L ${connectorStartX} ${lp.labelY}
                        L ${labelX - 4} ${lp.labelY}`)
            .attr("fill", "none")
            .attr("stroke", lp.color)
            .attr("stroke-width", 1)
            .attr("stroke-opacity", 0.35);
        } else {
          labelsGroup.append("line")
            .attr("x1", pointEndX)
            .attr("y1", lp.yPos)
            .attr("x2", labelX - 4)
            .attr("y2", lp.labelY)
            .attr("stroke", lp.color)
            .attr("stroke-width", 1)
            .attr("stroke-opacity", 0.35);
        }

        const labelText = labelsGroup.append("text")
          .attr("x", labelX)
          .attr("y", lp.labelY)
          .attr("dy", "0.35em")
          .attr("font-family", "'IBM Plex Sans', sans-serif");

        labelText.append("tspan")
          .attr("font-size", `${labelFontSize}px`)
          .attr("font-weight", 500)
          .attr("fill", lp.color)
          .text(lp.key);
      }
    }

    // Uppdatera regionväljaren (om interaktiv)
    if (selectorCtrl) selectorCtrl.update();
  }

  // ==========================================================================
  // TOGGLE HIGHLIGHT (för crosshair-klick)
  // ==========================================================================
  function toggleHighlight(key) {
    if (!filterState) return;
    filterState.toggle(key);
    updateChart();
  }

  // Initial rendering
  updateChart();

  // ==========================================================================
  // UPPDATERA TIDSINTERVALL - updateChartRange
  // ==========================================================================
  updateChartRange = function() {
    // Uppdatera xScale-domän
    xScale.domain([currentStartYear, currentEndYear]);

    // Uppdatera x-axel ticks
    xAxis.ticks(Math.min(10, currentEndYear - currentStartYear));

    // Rendera om x-axeln med transition
    xAxisGroup
      .transition()
      .duration(300)
      .call(xAxis)
      .call(g => g.select(".domain").attr("stroke", "#1a1a1a"))
      .call(g => g.selectAll(".tick line").attr("stroke", "#1a1a1a"))
      .call(g => g.selectAll(".tick text")
        .attr("fill", "#1a1a1a")
        .attr("font-size", "13px")
        .attr("font-family", "'IBM Plex Sans', sans-serif"));

    // Uppdatera linjerna (med ny skala och filtrerad data)
    linesGroup.selectAll("*").remove();
    labelsGroup.selectAll("*").remove();

    const allEndpoints = [];

    // Rita bakgrundslinjer (ej highlighted, ej dolda) först
    for (const [key, values] of groups) {
      if (isHighlighted(key)) continue;
      if (filterState && filterState.isHidden(key)) continue;

      const sortedValues = [...values]
        .filter(d => d[x] >= currentStartYear && d[x] <= currentEndYear)
        .sort((a, b) => a[x] - b[x]);

      if (sortedValues.length < 2) continue;

      linesGroup.append("path")
        .datum(sortedValues)
        .attr("class", "line-bg")
        .attr("data-key", key)
        .attr("fill", "none")
        .attr("stroke", "#aaa")
        .attr("stroke-width", backgroundStrokeWidth)
        .attr("stroke-opacity", backgroundOpacity)
        .attr("d", line);
    }

    // Rita highlighted linjer ovanpå (ej dolda)
    for (const [key, values] of groups) {
      if (!isHighlighted(key)) continue;
      if (filterState && filterState.isHidden(key)) continue;

      const sortedValues = [...values]
        .filter(d => d[x] >= currentStartYear && d[x] <= currentEndYear)
        .sort((a, b) => a[x] - b[x]);

      if (sortedValues.length < 2) continue;

      const lineColor = colorScale(key);

      linesGroup.append("path")
        .datum(sortedValues)
        .attr("class", "line-highlight")
        .attr("data-key", key)
        .attr("fill", "none")
        .attr("stroke", lineColor)
        .attr("stroke-width", 2)
        .attr("d", line);

      const lastPoint = sortedValues[sortedValues.length - 1];
      linesGroup.append("circle")
        .attr("class", "endpoint")
        .attr("data-key", key)
        .attr("cx", xScale(lastPoint[x]))
        .attr("cy", yScale(lastPoint[y]))
        .attr("r", 4)
        .attr("fill", lineColor);

      allEndpoints.push({
        key,
        xPos: xScale(lastPoint[x]),
        yPos: yScale(lastPoint[y]),
        yVal: lastPoint[y],
        color: lineColor
      });
    }

    // Direktetiketter med kollisionshantering
    if (allEndpoints.length > 0) {
      const labelFontSize = 12;
      const minSpacing = 18;
      const chartTop = marginTop + 8;
      const chartBottom = height - marginBottom - 8;

      allEndpoints.sort((a, b) => a.yPos - b.yPos);

      const labelPositions = allEndpoints.map(ep => ({
        ...ep,
        labelY: ep.yPos,
        idealY: ep.yPos
      }));

      for (let iteration = 0; iteration < 20; iteration++) {
        let moved = false;
        for (let i = 0; i < labelPositions.length; i++) {
          const current = labelPositions[i];
          for (let j = 0; j < i; j++) {
            const prev = labelPositions[j];
            const overlap = (prev.labelY + minSpacing) - current.labelY;
            if (overlap > 0) {
              current.labelY += overlap * 0.6;
              prev.labelY -= overlap * 0.4;
              moved = true;
            }
          }
          current.labelY = Math.max(chartTop, Math.min(chartBottom, current.labelY));
        }
        if (!moved) break;
      }

      labelPositions.forEach(lp => {
        lp.labelY = Math.max(chartTop, Math.min(chartBottom, lp.labelY));
      });

      const connectorStartX = autoWidth - marginRight + 8;
      const labelX = autoWidth - marginRight + 14;

      for (const lp of labelPositions) {
        const pointEndX = lp.xPos + 7;
        const needsDiagonal = Math.abs(lp.labelY - lp.yPos) > 3;

        if (needsDiagonal) {
          const midX = connectorStartX - 6;
          labelsGroup.append("path")
            .attr("d", `M ${pointEndX} ${lp.yPos}
                        L ${midX} ${lp.yPos}
                        L ${connectorStartX} ${lp.labelY}
                        L ${labelX - 4} ${lp.labelY}`)
            .attr("fill", "none")
            .attr("stroke", lp.color)
            .attr("stroke-width", 1)
            .attr("stroke-opacity", 0.35);
        } else {
          labelsGroup.append("line")
            .attr("x1", pointEndX)
            .attr("y1", lp.yPos)
            .attr("x2", labelX - 4)
            .attr("y2", lp.labelY)
            .attr("stroke", lp.color)
            .attr("stroke-width", 1)
            .attr("stroke-opacity", 0.35);
        }

        const labelText = labelsGroup.append("text")
          .attr("x", labelX)
          .attr("y", lp.labelY)
          .attr("dy", "0.35em")
          .attr("font-family", "'IBM Plex Sans', sans-serif");

        labelText.append("tspan")
          .attr("font-size", `${labelFontSize}px`)
          .attr("font-weight", 500)
          .attr("fill", lp.color)
          .text(lp.key);
      }
    }

    // Uppdatera regionväljaren
    if (selectorCtrl) selectorCtrl.update();
  };

  // ==========================================================================
  // CROSSHAIR - Subtil vertikal linje som snappar till datapunkter
  // ==========================================================================
  // Filtrera x-värden baserat på aktuellt intervall
  const getFilteredXValues = () => allXValues.filter(v => v >= currentStartYear && v <= currentEndYear);

  const crosshair = svg.append("line")
    .attr("class", "crosshair")
    .attr("y1", marginTop)
    .attr("y2", height - marginBottom)
    .attr("stroke", "#bbb")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,3")
    .style("opacity", 0)
    .style("pointer-events", "none");

  const highlights = svg.append("g").attr("class", "highlights");

  // Spara senast fokuserade för klick-hantering
  let lastFocusedKey = null;

  // Overlay täcker hela grafytan + lite extra utrymme ovanför
  const overlayPadding = 20;
  svg.append("rect")
    .attr("class", "overlay")
    .attr("x", axisLeft)
    .attr("y", marginTop - overlayPadding)
    .attr("width", autoWidth - marginRight - axisLeft)
    .attr("height", height - marginTop - marginBottom + overlayPadding * 2)
    .attr("fill", "transparent")
    .style("cursor", "default")
    .on("mouseenter", () => {
      crosshair.style("opacity", 1);
      tooltip.style("display", "block");
    })
    .on("mouseleave", () => {
      crosshair.style("opacity", 0);
      highlights.selectAll("*").remove();
      tooltip.style("display", "none");
      lastFocusedKey = null;
      // Återställ linjestil
      linesGroup.selectAll("path").each(function() {
        const el = d3.select(this);
        const key = el.attr("data-key");
        if (el.classed("line-highlight")) {
          el.attr("stroke-width", 2)
            .attr("stroke-opacity", 1)
            .attr("stroke", colorScale(key));
        } else {
          el.attr("stroke-width", 1.2)
            .attr("stroke-opacity", 0.25)
            .attr("stroke", "#aaa");
        }
      });
    })
    .on("click", () => {
      // Klick på fokuserad linje - lägg till eller ta bort
      if (lastFocusedKey) {
        toggleHighlight(lastFocusedKey);
      }
    })
    .on("mousemove", function(event) {
      const [mx, my] = d3.pointer(event);

      const xValue = xScale.invert(mx);
      const filteredXValues = getFilteredXValues();
      if (filteredXValues.length === 0) return;

      const closestX = filteredXValues.reduce((prev, curr) =>
        Math.abs(curr - xValue) < Math.abs(prev - xValue) ? curr : prev
      );

      const xPos = xScale(closestX);
      crosshair.attr("x1", xPos).attr("x2", xPos);

      // Samla ALLA serier för att hitta närmaste (inkl grå, exkl dolda)
      const allValues = [];
      for (const [key, groupData] of groups) {
        if (filterState && filterState.isHidden(key)) continue;
        const point = groupData.find(d => d[x] === closestX);
        if (point) {
          allValues.push({
            key: key === "_all" ? "" : key,
            value: point[y],
            yPos: yScale(point[y]),
            color: colorScale(key),
            highlighted: isHighlighted(key)
          });
        }
      }

      // Hitta vilken linje som är närmast muspekaren (vertikalt) - alla linjer
      const maxFocusDistance = 20; // Max pixlar för att fokusera
      let focusedKey = null;
      let focusedIsGray = false;
      let minDist = Infinity;
      for (const v of allValues) {
        const dist = Math.abs(v.yPos - my);
        if (dist < minDist && dist < maxFocusDistance) {
          minDist = dist;
          focusedKey = v.key;
          focusedIsGray = !v.highlighted;
        }
      }

      // Spara för klick-hantering
      lastFocusedKey = focusedKey;

      // Cursor: pointer om nära en linje
      d3.select(this).style("cursor", focusedKey ? "pointer" : "default");

      // Endast highlighted i tooltip
      const values = allValues.filter(v => v.highlighted);

      // Hantera linjestil baserat på fokus
      linesGroup.selectAll("path").each(function() {
        const el = d3.select(this);
        const key = el.attr("data-key");

        if (!focusedKey) {
          // Ingen fokuserad - normal stil
          if (el.classed("line-highlight")) {
            el.attr("stroke-width", 2)
              .attr("stroke-opacity", 1)
              .attr("stroke", colorScale(key));
          } else {
            el.attr("stroke-width", 1.2)
              .attr("stroke-opacity", 0.25)
              .attr("stroke", "#aaa");
          }
        } else if (key === focusedKey) {
          // Fokuserad linje - lyft fram
          el.attr("stroke-width", 2.8)
            .attr("stroke-opacity", 1)
            .attr("stroke", focusedIsGray ? "#555" : colorScale(key));
        } else if (isHighlighted(key)) {
          // Annan highlightad - dämpa lite
          el.attr("stroke-width", 1.8)
            .attr("stroke-opacity", 0.5);
        } else {
          // Grå bakgrundslinje - dämpa mer
          el.attr("stroke-width", 1)
            .attr("stroke-opacity", 0.12);
        }
      });

      // Sortera efter värde (högst först)
      values.sort((a, b) => b.value - a.value);

      // Bygg tooltip HTML
      let rows = values.map(v =>
        `<div class="graf-tooltip-row${v.key === focusedKey && !focusedIsGray ? " focused" : ""}">
          <span class="graf-tooltip-dot" style="background:${v.color}"></span>
          <span class="graf-tooltip-name">${v.key}</span>
          <span class="graf-tooltip-val">${formatY(v.value)}</span>
        </div>`
      ).join("");

      // Om fokuserad är grå - lägg till som preview-rad
      let previewRow = "";
      if (focusedIsGray && focusedKey) {
        const grayItem = allValues.find(v => v.key === focusedKey);
        if (grayItem) {
          previewRow = `<div class="graf-tooltip-preview">
            <span class="graf-tooltip-dot" style="background:#555"></span>
            <span class="graf-tooltip-name">${grayItem.key}</span>
            <span class="graf-tooltip-val">${formatY(grayItem.value)}</span>
            <span class="graf-tooltip-add">+ klicka</span>
          </div>`;
        }
      }

      tooltip.html(`
        <div class="graf-tooltip-year">${closestX}</div>
        <div class="graf-tooltip-list">${rows}</div>
        ${previewRow}
      `);

      // Positionera tooltip - undvik overflow
      const svgRect = svgContainer.node().getBoundingClientRect();
      const containerRect = container.node().getBoundingClientRect();
      const tooltipNode = tooltip.node();
      const tooltipRect = tooltipNode.getBoundingClientRect();

      // Tooltip till VÄNSTER om crosshair (skymmer inte linjer framåt)
      let tooltipX = xPos + (svgRect.left - containerRect.left) - tooltipRect.width - 15;
      let tooltipY = my + (svgRect.top - containerRect.top) - 10;

      // Flippa till höger om för nära vänster kant
      if (tooltipX < 10) {
        tooltipX = xPos + (svgRect.left - containerRect.left) + 15;
      }

      // Håll tooltip inom container vertikalt
      const maxY = containerRect.height - tooltipRect.height - 10;
      tooltipY = Math.max(10, Math.min(tooltipY, maxY));

      tooltip
        .style("left", tooltipX + "px")
        .style("top", tooltipY + "px");

      // Highlight-cirklar och etikett vid slutet för fokuserad linje
      highlights.selectAll("*").remove();

      // Hjälpfunktion: visa etikett vid linjens slut
      function showEndLabel(key, color) {
        const groupData = groups.get(key);
        if (!groupData) return;
        const sortedData = [...groupData]
          .filter(d => d[x] >= currentStartYear && d[x] <= currentEndYear)
          .sort((a, b) => a[x] - b[x]);
        if (sortedData.length === 0) return;
        const lastPoint = sortedData[sortedData.length - 1];
        const endX = xScale(lastPoint[x]);
        const endY = yScale(lastPoint[y]);

        highlights.append("circle")
          .attr("cx", endX).attr("cy", endY).attr("r", 5)
          .attr("fill", color).style("pointer-events", "none");

        highlights.append("text")
          .attr("x", endX + 8).attr("y", endY).attr("dy", "0.35em")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .attr("font-size", "11px").attr("font-weight", "600")
          .attr("fill", color).text(key)
          .style("pointer-events", "none");
      }

      // Om fokuserad är grå linje - visa tydlig markör + etikett
      if (focusedIsGray && focusedKey) {
        const grayItem = allValues.find(v => v.key === focusedKey);
        if (grayItem) {
          highlights.append("circle")
            .attr("cx", xPos).attr("cy", grayItem.yPos).attr("r", 8)
            .attr("fill", "none").attr("stroke", "#555")
            .attr("stroke-width", 2).attr("stroke-opacity", 0.5)
            .style("pointer-events", "none");
          highlights.append("circle")
            .attr("cx", xPos).attr("cy", grayItem.yPos).attr("r", 4)
            .attr("fill", "#555").style("pointer-events", "none");

          showEndLabel(focusedKey, "#555");
        }
      }

      // Om fokuserad är highlightad - INTE visa extra etikett (finns redan)

      // Highlighted seriers cirklar vid crosshair
      for (const v of values) {
        const isFocused = v.key === focusedKey && !focusedIsGray;
        const cy = v.yPos;

        // Yttre ring
        highlights.append("circle")
          .attr("cx", xPos)
          .attr("cy", cy)
          .attr("r", isFocused ? 9 : 5)
          .attr("fill", "none")
          .attr("stroke", v.color)
          .attr("stroke-width", isFocused ? 2 : 1.5)
          .attr("stroke-opacity", isFocused ? 0.5 : 0.3)
          .style("pointer-events", "none");

        // Inre punkt
        highlights.append("circle")
          .attr("cx", xPos)
          .attr("cy", cy)
          .attr("r", isFocused ? 4 : 2.5)
          .attr("fill", v.color)
          .attr("fill-opacity", isFocused ? 1 : 0.6)
          .style("pointer-events", "none");
      }
    });

  // Caption
  if (caption) {
    container.append("div")
      .attr("class", "graf-caption")
      .text(caption);
  }

  // Export-knapp, info och logga
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
