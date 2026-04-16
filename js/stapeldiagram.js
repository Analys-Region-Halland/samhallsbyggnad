// =============================================================================
// STAPELDIAGRAM - Universell D3-komponent (vertikal och horisontell)
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "./exportSvg.js";
import { createFilterState, createSelectorPanel } from "./filterUtils.js";

// Hjälpfunktion: beräkna snyggt intervall och max för axeln
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

export function stapeldiagram(data, {
  x = "kategori",
  y = "värde",
  color = null,
  time = null,            // Fält för tid (t.ex. "år") - aktiverar play-animation för ranking
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
  grouped = false,
  showGrid = true,
  altText = null,
  info = null,
  logo = null,
  interactive = false,
  filter = null,          // Begränsa valbara items (gruppnamn eller individuella)
  highlight = null,
  filterBy = "x"          // "x" = filtrera kategorier, "color" = filtrera grupper
} = {}) {

  const filterByColor = filterBy === "color" && color;

  const filterState = filterByColor
    ? createFilterState(data, { itemField: color, groupField: null, filter, highlight })
    : createFilterState(data, { itemField: x, groupField: color, filter, highlight });

  const categories = [...new Set(data.map(d => d[x]))];
  const groups = color ? [...new Set(data.map(d => d[color]))] : ["_all"];

  // Tidshantering för ranking-animation
  const allTimes = time ? [...new Set(data.map(d => d[time]))].sort((a, b) => a - b) : [];
  let currentTime = allTimes.length > 0 ? allTimes[allTimes.length - 1] : null;
  const hasTimeAnimation = time && allTimes.length > 1 && !color;  // Endast för enkla stapeldiagram

  // Hämta data för aktuell tid
  const getDataForTime = (t) => {
    if (!time) return data;
    return data.filter(d => d[time] === t);
  };

  // Beräkna min/max-värde över alla tider (för stabil skala)
  const dataMax = d3.max(data, d => d[y]);
  const dataMin = d3.min(data, d => d[y]);
  const valueNice = niceScale(dataMax, 5);

  // Hantera negativa värden: utöka ticks och domän nedåt
  if (dataMin < 0) {
    const negMin = Math.floor(dataMin / valueNice.interval) * valueNice.interval;
    const newTicks = [];
    for (let v = negMin; v <= valueNice.max; v += valueNice.interval) {
      newTicks.push(Math.round(v * 1000) / 1000);
    }
    valueNice.ticks = newTicks;
    valueNice.min = negMin;
  } else {
    valueNice.min = 0;
  }

  // Dimensioner - tydlig breakout-effekt
  // Best practice: ~48px per kategori för god läsbarhet
  const autoWidth = width || 780;
  const marginTop = (horizontal ? 20 : (yLabel ? 36 : 20));
  const marginRight = (color && !(interactive && filterByColor)) ? 105 : 40;
  const marginBottom = horizontal
    ? (xLabel ? 58 : 48)
    : (xLabel ? 58 : 48);

  // Dynamisk höjd för horisontell: 48px per kategori, min 240px, max 600px
  const pixelsPerCategory = 48;
  const dynamicHeight = horizontal
    ? Math.min(600, Math.max(240, marginTop + marginBottom + categories.length * pixelsPerCategory))
    : height;

  // För horisontell: beräkna marginal för högerjusterade etiketter
  let marginLeft = 14;
  if (horizontal) {
    const maxLabelLength = Math.max(...categories.map(c => String(c).length));
    marginLeft = 16 + maxLabelLength * 8 + 10;
  }

  const maxTickWidth = formatY(valueNice.max).length * 6 + 8;
  const axisLeft = horizontal ? marginLeft : marginLeft + maxTickWidth;

  const colorScale = d3.scaleOrdinal()
    .domain(groups)
    .range(colors);

  // Färgkoda gruppnamn i undertiteln (fungerar som inbäddad legend)
  const colorizeSubtitle = (text) => {
    if (!color || groups[0] === "_all" || !text) return null;
    let html = text;
    const sortedGroups = [...groups].sort((a, b) => b.length - a.length);
    let anyMatch = false;
    for (const group of sortedGroups) {
      const escaped = group.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'gi');
      const c = colorScale(group);
      html = html.replace(regex, (match) => {
        anyMatch = true;
        return `<span style="background:${c};color:#fff;padding:2px 7px;border-radius:3px;font-weight:600;white-space:nowrap;letter-spacing:0.01em">${match}</span>`;
      });
    }
    return anyMatch ? html : null;
  };

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

  // ==========================================================================
  // UNDERTITEL MED INTEGRERAD TIDSKONTROLL
  // ==========================================================================
  let timeControl = null;
  let isAnimating = false;
  let animationInterval = null;
  let updateBars = null;  // Definieras senare

  if (subtitle || hasTimeAnimation) {
    // Inject CSS för tidskontroll (delad med scatterplot)
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
            if (updateBars) updateBars(true);
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

          playBtn.html("⏸");

          let idx = 0;
          currentTime = allTimes[0];
          updateTimeDisplay();
          if (updateBars) updateBars(true);

          animationInterval = setInterval(() => {
            idx++;
            if (idx >= allTimes.length) {
              stopAnimation();
              return;
            }
            currentTime = allTimes[idx];
            updateTimeDisplay();
            if (updateBars) updateBars(true);
          }, 500);
        }

        function stopAnimation() {
          if (animationInterval) {
            clearInterval(animationInterval);
            animationInterval = null;
          }
          isAnimating = false;
          playBtn.html("▶");
        }

      } else {
        const el = subtitleWrapper.append("span").attr("class", "graf-subtitle-text");
        const colored = colorizeSubtitle(subtitle);
        colored ? el.html(colored) : el.text(subtitle);
      }
    } else if (subtitle) {
      const el = subtitleWrapper.append("span").attr("class", "graf-subtitle-text");
      const colored = colorizeSubtitle(subtitle);
      colored ? el.html(colored) : el.text(subtitle);
    }
  }

  // ==========================================================================
  // INTERAKTIV HIGHLIGHT-VÄLJARE (via filterUtils)
  // ==========================================================================
  const mutedColor = "#d0d0d0";

  const isHighlighted = (cat, groupKey) => {
    return filterByColor
      ? filterState.isHighlighted(groupKey || "_all")
      : filterState.isHighlighted(cat);
  };

  const isStacked = color && !grouped;

  const getCategoryColor = (cat, groupKey = "_all") => {
    // In stacked mode: always show the group color (muting via opacity instead)
    if (isStacked) return colorScale(groupKey);
    if (!isHighlighted(cat, groupKey)) return mutedColor;
    return colorScale(groupKey);
  };

  const getBarOpacity = (cat, groupKey = "_all") => {
    if (!isStacked) return 1;
    return isHighlighted(cat, groupKey) ? 1 : 0.3;
  };

  let selectorCtrl = null;
  if (interactive) {
    selectorCtrl = createSelectorPanel(header, {
      filterState,
      allItems: filterByColor ? groups : categories,
      colorScale: (filterByColor || color) ? colorScale : () => colors[0],
      triggerText: "Markera \u203a",
      onUpdate: () => { if (updateBars) updateBars(); }
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
  const showValue = (category, values) => {
    const chips = values.map(v => {
      const label = v.label || "";
      return `<span style="display:inline-flex;align-items:center;margin:0 8px"><span style="width:7px;height:7px;border-radius:50%;background:${v.color};margin-right:5px;flex-shrink:0"></span>${label ? `<span style="color:#666;margin-right:4px">${label}</span>` : ""}<b>${formatY(v.value)}</b></span>`;
    }).join("");
    valueDisplay.html(`<span style="display:inline-flex;align-items:center;justify-content:center;width:100%"><b style="margin-right:8px">${category}</b><span style="opacity:0.2;margin-right:8px">│</span>${chips}</span>`);
  };

  const hideValue = () => {
    valueDisplay.html("<span style='opacity:0.35'>Peka för värden</span>");
  };

  if (horizontal) {
    // =======================================================================
    // HORISONTELLT STAPELDIAGRAM (med valfri ranking-animation)
    // =======================================================================

    // Initiala data (för senaste tidpunkten eller all data)
    let currentData = getDataForTime(currentTime);
    let sortedData = [...currentData].sort((a, b) => b[y] - a[y]);
    let sortedCategories = sortedData.map(d => d[x]);

    // Alla kategorier (för konsekvent färgtilldelning)
    const allCategories = categories;

    // Padding 0.33 ger ~2:1 ratio (bar:space) enligt Stephen Few
    const yScale = d3.scaleBand()
      .domain(sortedCategories)
      .range([marginTop, chartHeight - marginBottom])
      .padding(0.33);

    const xScale = d3.scaleLinear()
      .domain([valueNice.min, valueNice.max])
      .range([axisLeft, autoWidth - marginRight]);

    const hasNegValues = dataMin < 0;

    // Grupp för zebra-bakgrund (uppdateras vid animation)
    const zebraGroup = svg.append("g").attr("class", "zebra-group");

    // Nollinje vid negativa värden
    if (hasNegValues) {
      svg.append("line")
        .attr("x1", xScale(0)).attr("x2", xScale(0))
        .attr("y1", marginTop).attr("y2", chartHeight - marginBottom)
        .attr("stroke", "#999").attr("stroke-width", 1)
        .attr("stroke-dasharray", "3,2");
    }

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
        .attr("y", hasTimeAnimation ? chartHeight - marginBottom + 28 : chartHeight - 8)
        .attr("text-anchor", "middle")
        .attr("class", "graf-axis-label")
        .text(xLabel);
    }

    // Grupp för staplar och etiketter (för uppdatering)
    const barsGroup = svg.append("g").attr("class", "bars-group");

    // Funktion för att rita/uppdatera staplar (med animation-stöd)
    updateBars = function(animate = false) {
      // Uppdatera data för aktuell tid
      currentData = getDataForTime(currentTime);

      if (isStacked) {
        // =================================================================
        // HORISONTELL STACKED
        // =================================================================
        // Sortera kategorier efter ordning i datan (behåll extern sortering)
        sortedCategories = categories;
        yScale.domain(sortedCategories);

        // Zebra
        zebraGroup.selectAll("*").remove();
        sortedCategories.forEach((cat, i) => {
          if (i % 2 === 0) {
            zebraGroup.append("rect")
              .attr("x", 18).attr("y", yScale(cat))
              .attr("width", autoWidth - 36).attr("height", yScale.bandwidth())
              .attr("fill", "#f8f8f8").attr("rx", 3);
          }
        });

        const barHeight = yScale.bandwidth();
        barsGroup.selectAll("*").remove();

        // Etiketter
        sortedCategories.forEach(cat => {
          const isHl = isHighlighted(cat, "_all");
          barsGroup.append("text")
            .attr("x", axisLeft - 10)
            .attr("y", yScale(cat) + barHeight / 2)
            .attr("dy", "0.35em")
            .attr("text-anchor", "end")
            .attr("font-family", "'IBM Plex Sans', sans-serif")
            .attr("font-size", "13px")
            .attr("font-weight", isHl ? "600" : "400")
            .attr("fill", isHl ? "#1a1a1a" : "#999")
            .text(cat);
        });

        // Stacked bars
        const stackedData = d3.stack()
          .keys(groups)
          .value((cat, key) => {
            const found = data.find(item => item[x] === cat && item[color] === key);
            return found ? found[y] : 0;
          })(sortedCategories);

        stackedData.forEach((layerData) => {
          layerData.forEach((d, i) => {
            const cat = sortedCategories[i];
            const barColor = getCategoryColor(cat, layerData.key);
            const baseOpacity = getBarOpacity(cat, layerData.key);
            barsGroup.append("rect")
              .attr("data-category", cat)
              .attr("data-group", layerData.key)
              .attr("y", yScale(cat))
              .attr("x", xScale(d[0]))
              .attr("width", Math.max(0, xScale(d[1]) - xScale(d[0])))
              .attr("height", barHeight)
              .attr("fill", barColor)
              .attr("opacity", baseOpacity)
              .attr("rx", 2)
              .style("cursor", "pointer")
              .on("mouseenter", function() {
                d3.select(this).attr("opacity", Math.min(baseOpacity + 0.15, 1));
                const catValues = groups.map(g => {
                  const item = data.find(item => item[x] === cat && item[color] === g);
                  return { label: g, value: item ? item[y] : 0, color: getCategoryColor(cat, g) };
                });
                showValue(cat, catValues);
              })
              .on("mouseleave", function() {
                d3.select(this).attr("opacity", baseOpacity);
                hideValue();
              })
              .on("click", function() {
                smartToggle(cat, categories);
                updateBars(false);
              });
          });
        });

      } else {
        // =================================================================
        // HORISONTELL ENKEL / GROUPED (befintlig logik)
        // =================================================================
        sortedData = [...currentData].sort((a, b) => b[y] - a[y]);
        sortedCategories = sortedData.map(d => d[x]);

        // Uppdatera yScale domain
        yScale.domain(sortedCategories);

        // Uppdatera zebra-bakgrund
        zebraGroup.selectAll("*").remove();
        sortedCategories.forEach((cat, i) => {
          if (i % 2 === 0) {
            zebraGroup.append("rect")
              .attr("x", 18)
              .attr("y", yScale(cat))
              .attr("width", autoWidth - 36)
              .attr("height", yScale.bandwidth())
              .attr("fill", "#f8f8f8")
              .attr("rx", 3);
          }
        });

        const barHeight = yScale.bandwidth();
        const duration = animate ? 400 : 0;

        // Data join för staplar
        const barGroups = barsGroup.selectAll(".bar-group")
          .data(sortedData, d => d[x]);

        // Exit
        barGroups.exit().remove();

        // Enter
        const barGroupsEnter = barGroups.enter()
          .append("g")
          .attr("class", "bar-group")
          .attr("transform", d => `translate(0, ${yScale(d[x])})`);

        // Etikett (högerjusterad mot stapelstart)
        barGroupsEnter.append("text")
          .attr("class", "bar-label")
          .attr("x", axisLeft - 10)
          .attr("dy", "0.35em")
          .attr("text-anchor", "end")
          .attr("font-family", "'IBM Plex Sans', sans-serif");

        // Stapel
        barGroupsEnter.append("rect")
          .attr("class", "bar-rect")
          .attr("x", hasNegValues ? xScale(0) : axisLeft)
          .attr("rx", 3)
          .style("cursor", "pointer");

        // Värde-etikett
        barGroupsEnter.append("text")
          .attr("class", "bar-value")
          .attr("dy", "0.35em")
          .attr("text-anchor", "start")
          .attr("font-family", "'IBM Plex Sans', sans-serif");

        // Merge enter + update
        const allBarGroups = barGroupsEnter.merge(barGroups);

        // Animera position
        const transition = allBarGroups.transition().duration(duration)
          .attr("transform", d => `translate(0, ${yScale(d[x])})`);

        // Uppdatera innehåll
        allBarGroups.each(function(d) {
          const g = d3.select(this);
          const catIndex = allCategories.indexOf(d[x]);
          const groupKey = color ? d[color] : "_all";
          const barColor = getCategoryColor(d[x], groupKey);
          const isHl = isHighlighted(d[x], groupKey);

          // Etikett
          g.select(".bar-label")
            .attr("y", barHeight / 2)
            .attr("fill", isHl ? "#1a1a1a" : "#999")
            .attr("font-size", "13px")
            .attr("font-weight", isHl ? "500" : "400")
            .text(d[x]);

          // Stapel
          g.select(".bar-rect")
            .attr("data-category", d[x])
            .attr("data-group", groupKey)
            .attr("y", 0)
            .attr("height", barHeight)
            .attr("fill", barColor)
            .on("mouseenter", function() {
              d3.select(this).attr("opacity", 0.8);
              showValue(d[x], [{ label: hasTimeAnimation ? String(currentTime) : "", value: d[y], color: barColor }]);
            })
            .on("mouseleave", function() {
              d3.select(this).attr("opacity", 1);
              hideValue();
            })
            .on("click", function() {
              smartToggle(filterByColor ? groupKey : d[x], filterByColor ? groups : categories);
              updateBars(false);
            });

          // Animera stapelbredd (hantera negativa värden)
          if (hasNegValues) {
            const zeroX = xScale(0);
            const valX = xScale(d[y]);
            g.select(".bar-rect").transition().duration(duration)
              .attr("x", Math.min(zeroX, valX))
              .attr("width", Math.max(0, Math.abs(valX - zeroX)));
          } else {
            g.select(".bar-rect").transition().duration(duration)
              .attr("width", Math.max(0, xScale(d[y]) - axisLeft));
          }

          // Värde-etikett
          g.select(".bar-value")
            .attr("y", barHeight / 2)
            .attr("fill", isHl ? "#666" : "#aaa")
            .attr("font-size", "12px")
            .attr("text-anchor", hasNegValues && d[y] < 0 ? "end" : "start")
            .text(formatY(d[y]));

          g.select(".bar-value").transition().duration(duration)
            .attr("x", hasNegValues && d[y] < 0 ? xScale(d[y]) - 6 : xScale(d[y]) + 6);
        });
      }

      // Uppdatera väljaren
      if (selectorCtrl) {
        selectorCtrl.update();
      }
    }

    // Initial rendering
    updateBars(false);

    // Panel hover → chart highlight
    if (selectorCtrl) {
      const panelGrid = selectorCtrl.element.select(".graf-selector-grid");
      const matchAttrH = filterByColor ? "data-group" : "data-category";
      panelGrid.node().addEventListener("mouseover", (event) => {
        const opt = event.target.closest(".graf-selector-option");
        if (!opt) {
          barsGroup.selectAll(".bar-rect").attr("stroke", "none");
          hideValue();
          return;
        }
        const itemName = opt.querySelector(".opt-name")?.textContent;
        if (itemName) {
          barsGroup.selectAll(".bar-rect").each(function() {
            const el = d3.select(this);
            if (el.attr(matchAttrH) === itemName) {
              el.attr("stroke", "#1a1a1a").attr("stroke-width", 2);
            } else {
              el.attr("stroke", "none");
            }
          });
          if (filterByColor) {
            const total = d3.sum(getDataForTime(currentTime).filter(d => d[color] === itemName), d => d[y]);
            showValue(itemName, [{ label: "", value: total, color: colorScale(itemName) }]);
          } else {
            const item = getDataForTime(currentTime).find(d => d[x] === itemName);
            if (item) {
              const gk = color ? item[color] : "_all";
              showValue(itemName, [{ label: hasTimeAnimation ? String(currentTime) : "", value: item[y], color: getCategoryColor(itemName, gk) }]);
            }
          }
        }
      });
      panelGrid.node().addEventListener("mouseout", (event) => {
        const related = event.relatedTarget;
        if (related && panelGrid.node().contains(related)) return;
        barsGroup.selectAll(".bar-rect").attr("stroke", "none");
        hideValue();
      });
    }

    // Tooltip for stacked horizontal
    let stackedTooltip = null;
    if (isStacked) {
      container.style("position", "relative");
      stackedTooltip = container.append("div")
        .style("position", "absolute")
        .style("display", "none")
        .style("background", "#fff")
        .style("border", "1px solid #1a1a1a")
        .style("font-family", "'IBM Plex Sans', sans-serif")
        .style("font-size", "11px")
        .style("pointer-events", "none")
        .style("z-index", "1000")
        .style("box-shadow", "0 2px 8px rgba(0,0,0,0.12),0 8px 24px rgba(0,0,0,0.08)")
        .style("overflow", "hidden");
    }

    // Crosshair + highlight för horisontell
    const crosshair = svg.append("line")
      .attr("class", "crosshair")
      .attr("x1", axisLeft)
      .attr("x2", autoWidth - marginRight)
      .attr("stroke", "#bbb")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4,3")
      .style("opacity", 0)
      .style("pointer-events", "none");

    // Highlight-panel för kategori (subtil bakgrund)
    const highlightPanel = svg.insert("rect", ".bars-group")
      .attr("class", "highlight-panel")
      .attr("fill", "#f5f5f5")
      .attr("stroke", "none")
      .attr("rx", 3)
      .style("opacity", 0)
      .style("pointer-events", "none");

    // Highlight-ram för enskilda staplar
    const highlightRect = svg.append("rect")
      .attr("class", "highlight-rect")
      .attr("fill", "none")
      .attr("stroke", "#1a1a1a")
      .attr("stroke-width", 2)
      .attr("rx", 3)
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
        highlightPanel.style("opacity", 0);
        highlightRect.style("opacity", 0);
        if (stackedTooltip) {
          stackedTooltip.style("display", "none");
          barsGroup.selectAll("rect[data-category]").attr("stroke", "none");
        }
        hideValue();
      })
      .on("mousemove", function(event) {
        const [mx, my] = d3.pointer(event);
        crosshair.attr("y1", my).attr("y2", my);

        let closestCat = null;
        let minDist = Infinity;
        for (const cat of sortedCategories) {
          const catY = yScale(cat) + yScale.bandwidth() / 2;
          const dist = Math.abs(my - catY);
          if (dist < minDist) {
            minDist = dist;
            closestCat = cat;
          }
        }

        if (closestCat && minDist < yScale.bandwidth()) {
          const barY = yScale(closestCat);

          if (isStacked && stackedTooltip) {
            // Stacked: tooltip popup
            highlightPanel
              .attr("x", 18)
              .attr("y", barY - 4)
              .attr("width", autoWidth - 36)
              .attr("height", yScale.bandwidth() + 8)
              .style("opacity", 1);
            highlightRect.style("opacity", 0);

            // Find which segment the mouse is over
            let hoveredGroup = null;
            barsGroup.selectAll("rect[data-category]").each(function() {
              const el = d3.select(this);
              if (el.attr("data-category") === closestCat) {
                const rx = +el.attr("x"), rw = +el.attr("width");
                if (mx >= rx && mx <= rx + rw) {
                  hoveredGroup = el.attr("data-group");
                }
              }
            });

            // Highlight hovered segment
            barsGroup.selectAll("rect[data-category]").each(function() {
              const el = d3.select(this);
              if (el.attr("data-category") === closestCat && el.attr("data-group") === hoveredGroup) {
                el.attr("stroke", "#fff").attr("stroke-width", 2);
              } else {
                el.attr("stroke", "none");
              }
            });

            // Build tooltip
            const catValues = groups.map(g => {
              const item = data.find(item => item[x] === closestCat && item[color] === g);
              return { label: g, value: item ? item[y] : 0, color: getCategoryColor(closestCat, g) };
            });

            let html = `<div style="font-size:12px;font-weight:700;color:#fff;background:#1a1a1a;padding:5px 10px;letter-spacing:0.02em">${closestCat}</div>`;
            html += `<div style="display:flex;flex-direction:column">`;
            for (const v of catValues) {
              if (v.value === 0) continue;
              const focused = v.label === hoveredGroup;
              html += `<div style="display:flex;align-items:center;gap:6px;padding:3px 10px;line-height:1.3${focused ? ";background:#f0f0f0" : ""}">`;
              html += `<span style="width:8px;height:8px;border-radius:2px;background:${v.color};flex-shrink:0"></span>`;
              html += `<span style="color:${focused ? "#1a1a1a" : "#666"};flex:1;white-space:nowrap${focused ? ";font-weight:600" : ""}">${v.label}</span>`;
              html += `<span style="font-weight:600;font-variant-numeric:tabular-nums;color:#1a1a1a;margin-left:8px">${formatY(v.value)}</span>`;
              html += `</div>`;
            }
            html += `</div>`;

            stackedTooltip.html(html).style("display", "block");

            // Position tooltip
            const svgRect = svgContainer.node().getBoundingClientRect();
            const containerRect = container.node().getBoundingClientRect();
            const tooltipRect = stackedTooltip.node().getBoundingClientRect();
            const pixelX = mx * (svgRect.width / autoWidth) + svgRect.left - containerRect.left;
            const pixelY = my * (svgRect.height / chartHeight) + svgRect.top - containerRect.top;

            let tooltipX = pixelX + 15;
            let tooltipY = pixelY - tooltipRect.height / 2;
            if (tooltipX + tooltipRect.width > containerRect.width - 10) {
              tooltipX = pixelX - tooltipRect.width - 15;
            }
            tooltipY = Math.max(10, Math.min(tooltipY, containerRect.height - tooltipRect.height - 10));

            stackedTooltip.style("left", tooltipX + "px").style("top", tooltipY + "px");
          } else {
            if (stackedTooltip) stackedTooltip.style("display", "none");
            const item = currentData.find(d => d[x] === closestCat);
            if (item) {
              const groupKey = color ? item[color] : "_all";

              if (color) {
                highlightPanel
                  .attr("x", 18)
                  .attr("y", barY - 4)
                  .attr("width", autoWidth - 36)
                  .attr("height", yScale.bandwidth() + 8)
                  .style("opacity", 1);
                highlightRect.style("opacity", 0);
              } else {
                const barWidth = Math.max(0, xScale(item[y]) - axisLeft);
                highlightRect
                  .attr("x", axisLeft - 2)
                  .attr("y", barY - 2)
                  .attr("width", barWidth + 4)
                  .attr("height", yScale.bandwidth() + 4)
                  .style("opacity", 1);
                highlightPanel.style("opacity", 0);
              }

              showValue(closestCat, [{ label: hasTimeAnimation ? String(currentTime) : "", value: item[y], color: colorScale(groupKey) }]);
            }
          }
        } else {
          highlightPanel.style("opacity", 0);
          highlightRect.style("opacity", 0);
          if (stackedTooltip) {
            stackedTooltip.style("display", "none");
            barsGroup.selectAll("rect[data-category]").attr("stroke", "none");
          }
        }
      })
      .on("click", function(event) {
        const [, my] = d3.pointer(event);
        let closestCat = null;
        let minDist = Infinity;
        for (const cat of sortedCategories) {
          const catY = yScale(cat) + yScale.bandwidth() / 2;
          const dist = Math.abs(my - catY);
          if (dist < minDist) { minDist = dist; closestCat = cat; }
        }
        if (closestCat && minDist < yScale.bandwidth()) {
          if (filterByColor) {
            const item = currentData.find(d => d[x] === closestCat);
            if (item) smartToggle(color ? item[color] : "_all", groups);
          } else {
            smartToggle(closestCat, categories);
          }
          updateBars(false);
        }
      });

  } else {
    // =======================================================================
    // VERTIKALT STAPELDIAGRAM (original)
    // =======================================================================

    const innerWidth = autoWidth - axisLeft - marginRight;

    const xScale = d3.scaleBand()
      .domain(categories)
      .range([axisLeft, autoWidth - marginRight])
      .padding(0.25);

    const xSubScale = grouped && color
      ? d3.scaleBand()
          .domain(groups)
          .range([0, xScale.bandwidth()])
          .padding(0.08)
      : null;

    const yScale = d3.scaleLinear()
      .domain([0, valueNice.max])
      .range([height - marginBottom, marginTop]);

    // X-axel
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
        .attr("x", axisLeft + innerWidth / 2)
        .attr("y", height - 6)
        .attr("text-anchor", "middle")
        .attr("class", "graf-axis-label")
        .text(xLabel);
    }

    // Grid lines - OWID-stil (horisontella streckade linjer)
    if (showGrid) {
      const gridGroup = svg.insert("g", ":first-child").attr("class", "grid-lines");
      // Färre linjer: hoppa över varje tick om det blir för många
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

    // Grupp för staplar (för uppdatering)
    const barsGroup = svg.append("g").attr("class", "bars-group");

    // Funktion för att rita/uppdatera staplar
    updateBars = function() {
      barsGroup.selectAll("*").remove();

      if (grouped && color) {
        for (const group of groups) {
          const groupData = data.filter(d => d[color] === group);

          groupData.forEach(d => {
            const barColor = getCategoryColor(d[x], group);
            barsGroup.append("rect")
              .attr("data-category", d[x])
              .attr("data-group", group)
              .attr("x", xScale(d[x]) + xSubScale(group))
              .attr("y", yScale(d[y]))
              .attr("width", xSubScale.bandwidth())
              .attr("height", yScale(0) - yScale(d[y]))
              .attr("fill", barColor)
              .attr("rx", 2)
              .style("cursor", "pointer")
              .on("mouseenter", function() {
                d3.select(this).attr("opacity", 0.8);
                const catValues = groups.map(g => {
                  const item = data.find(item => item[x] === d[x] && item[color] === g);
                  return { label: g, value: item ? item[y] : 0, color: getCategoryColor(d[x], g) };
                });
                showValue(d[x], catValues);
              })
              .on("mouseleave", function() {
                d3.select(this).attr("opacity", 1);
                hideValue();
              })
              .on("click", function() {
                smartToggle(filterByColor ? group : d[x], filterByColor ? groups : categories);
                updateBars();
              });
          });
        }
      } else if (color) {
        const stackedData = d3.stack()
          .keys(groups)
          .value((d, key) => {
            const found = data.find(item => item[x] === d && item[color] === key);
            return found ? found[y] : 0;
          })(categories);

        stackedData.forEach((layerData, layerIdx) => {
          layerData.forEach((d, i) => {
            const cat = categories[i];
            const barColor = getCategoryColor(cat, layerData.key);
            const baseOpacity = getBarOpacity(cat, layerData.key);
            barsGroup.append("rect")
              .attr("data-category", cat)
              .attr("data-group", layerData.key)
              .attr("x", xScale(cat))
              .attr("y", yScale(d[1]))
              .attr("height", yScale(d[0]) - yScale(d[1]))
              .attr("width", xScale.bandwidth())
              .attr("fill", barColor)
              .attr("opacity", baseOpacity)
              .attr("rx", 2)
              .style("cursor", "pointer")
              .on("mouseenter", function() {
                d3.select(this).attr("opacity", Math.min(baseOpacity + 0.15, 1));
                const catValues = groups.map(g => {
                  const item = data.find(item => item[x] === cat && item[color] === g);
                  return { label: g, value: item ? item[y] : 0, color: getCategoryColor(cat, g) };
                });
                showValue(cat, catValues);
              })
              .on("mouseleave", function() {
                d3.select(this).attr("opacity", baseOpacity);
                hideValue();
              })
              .on("click", function() {
                smartToggle(filterByColor ? layerData.key : cat, filterByColor ? groups : categories);
                updateBars();
              });
          });
        });
      } else {
        data.forEach(d => {
          const barColor = getCategoryColor(d[x]);
          barsGroup.append("rect")
            .attr("data-category", d[x])
            .attr("data-group", "_all")
            .attr("x", xScale(d[x]))
            .attr("y", yScale(d[y]))
            .attr("width", xScale.bandwidth())
            .attr("height", yScale(0) - yScale(d[y]))
            .attr("fill", barColor)
            .attr("rx", 2)
            .style("cursor", "pointer")
            .on("mouseenter", function() {
              d3.select(this).attr("opacity", 0.8);
              showValue(d[x], [{ label: yLabel || "Värde", value: d[y], color: barColor }]);
            })
            .on("mouseleave", function() {
              d3.select(this).attr("opacity", 1);
              hideValue();
            })
            .on("click", function() {
              smartToggle(d[x], categories);
              updateBars();
            });
        });
      }

      // Uppdatera väljaren
      if (selectorCtrl) {
        selectorCtrl.update();
      }
    };

    // Initial rendering
    updateBars();

    // Panel hover → chart highlight
    if (selectorCtrl) {
      const panelGrid = selectorCtrl.element.select(".graf-selector-grid");
      const matchAttrV = filterByColor ? "data-group" : "data-category";
      panelGrid.node().addEventListener("mouseover", (event) => {
        const opt = event.target.closest(".graf-selector-option");
        if (!opt) {
          barsGroup.selectAll("rect[data-category]").attr("stroke", "none");
          hideValue();
          return;
        }
        const itemName = opt.querySelector(".opt-name")?.textContent;
        if (itemName) {
          barsGroup.selectAll("rect[data-category]").each(function() {
            const el = d3.select(this);
            if (el.attr(matchAttrV) === itemName) {
              el.attr("stroke", "#1a1a1a").attr("stroke-width", 2);
            } else {
              el.attr("stroke", "none");
            }
          });
          if (filterByColor) {
            const total = d3.sum(data.filter(d => d[color] === itemName), d => d[y]);
            showValue(itemName, [{ label: "", value: total, color: colorScale(itemName) }]);
          } else {
            const item = data.find(d => d[x] === itemName);
            if (item) {
              const gk = color ? item[color] : "_all";
              showValue(itemName, [{ label: "", value: item[y], color: getCategoryColor(itemName, gk) }]);
            }
          }
        }
      });
      panelGrid.node().addEventListener("mouseout", (event) => {
        const related = event.relatedTarget;
        if (related && panelGrid.node().contains(related)) return;
        barsGroup.selectAll("rect[data-category]").attr("stroke", "none");
        hideValue();
      });
    }

    // Crosshair + highlight för vertikal stapeldiagram
    const crosshair = svg.append("line")
      .attr("class", "crosshair")
      .attr("y1", marginTop)
      .attr("y2", height - marginBottom)
      .attr("stroke", "#bbb")
      .attr("stroke-width", 1)
      .attr("stroke-dasharray", "4,3")
      .style("opacity", 0)
      .style("pointer-events", "none");

    // Highlight-panel för kategori (subtil bakgrund för grouped, ram för enkel)
    const highlightPanel = svg.insert("rect", ":first-child")
      .attr("class", "highlight-panel")
      .attr("fill", "#f5f5f5")
      .attr("stroke", "none")
      .attr("rx", 3)
      .style("opacity", 0)
      .style("pointer-events", "none");

    // Highlight-ram för enskilda staplar (endast för icke-grupperade)
    const highlightRect = svg.append("rect")
      .attr("class", "highlight-rect")
      .attr("fill", "none")
      .attr("stroke", "#1a1a1a")
      .attr("stroke-width", 2)
      .attr("rx", 2)
      .style("opacity", 0)
      .style("pointer-events", "none");

    const isGrouped = (grouped && color) || (color && !grouped);
    let currentHighlightCat = null;

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
        highlightPanel.style("opacity", 0);
        highlightRect.style("opacity", 0);
        currentHighlightCat = null;
        hideValue();
      })
      .on("mousemove", function(event) {
        const [mx] = d3.pointer(event);
        crosshair.attr("x1", mx).attr("x2", mx);

        // Hitta närmaste kategori
        let closestCat = null;
        let minDist = Infinity;
        for (const cat of categories) {
          const catX = xScale(cat) + xScale.bandwidth() / 2;
          const dist = Math.abs(mx - catX);
          if (dist < minDist) {
            minDist = dist;
            closestCat = cat;
          }
        }

        if (closestCat && minDist < xScale.bandwidth()) {
          currentHighlightCat = closestCat;
          const barX = xScale(closestCat);

          if (color) {
            // Grouped eller stacked: visa subtil panel över hela kategorin
            highlightPanel
              .attr("x", barX - 4)
              .attr("y", marginTop)
              .attr("width", xScale.bandwidth() + 8)
              .attr("height", height - marginBottom - marginTop)
              .style("opacity", 1);
            highlightRect.style("opacity", 0);

            const catValues = groups.map(g => {
              const item = data.find(item => item[x] === closestCat && item[color] === g);
              return { label: g, value: item ? item[y] : 0, color: colorScale(g) };
            });
            showValue(closestCat, catValues);
          } else {
            // Enkel stapel: visa ram runt stapeln
            const item = data.find(d => d[x] === closestCat);
            if (item) {
              const barY = yScale(item[y]);
              const barHeight = yScale(0) - yScale(item[y]);

              highlightRect
                .attr("x", barX - 2)
                .attr("y", barY - 2)
                .attr("width", xScale.bandwidth() + 4)
                .attr("height", barHeight + 4)
                .style("opacity", 1);
              highlightPanel.style("opacity", 0);

              showValue(closestCat, [{ label: "", value: item[y], color: colors[0] }]);
            }
          }
        } else {
          highlightPanel.style("opacity", 0);
          highlightRect.style("opacity", 0);
          currentHighlightCat = null;
        }
      })
      .on("click", function(event) {
        const [mx, my] = d3.pointer(event);
        if (filterByColor) {
          let clickedGroup = null;
          barsGroup.selectAll("rect[data-group]").each(function() {
            const rect = d3.select(this);
            const bx = +rect.attr("x"), by = +rect.attr("y");
            const bw = +rect.attr("width"), bh = +rect.attr("height");
            if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) {
              clickedGroup = rect.attr("data-group");
            }
          });
          if (clickedGroup) {
            smartToggle(clickedGroup, groups);
            updateBars();
          }
        } else {
          let closestCat = null;
          let minDist = Infinity;
          for (const cat of categories) {
            const catX = xScale(cat) + xScale.bandwidth() / 2;
            const dist = Math.abs(mx - catX);
            if (dist < minDist) { minDist = dist; closestCat = cat; }
          }
          if (closestCat && minDist < xScale.bandwidth()) {
            smartToggle(closestCat, categories);
            updateBars();
          }
        }
      });
  }

  // Legend om color finns
  if (color && groups.length > 1 && groups[0] !== "_all" && !(interactive && filterByColor)) {
    if (isStacked && horizontal) {
      // HTML-legend ovanför diagrammet för stacked horisontell
      const legendDiv = container.insert("div", ".graf-svg-container")
        .style("display", "flex")
        .style("flex-wrap", "wrap")
        .style("justify-content", "center")
        .style("gap", "4px 16px")
        .style("padding", "0 0 8px 0")
        .style("font-family", "'IBM Plex Sans', sans-serif")
        .style("font-size", "12px");

      groups.forEach(group => {
        const item = legendDiv.append("span")
          .style("display", "inline-flex")
          .style("align-items", "center")
          .style("gap", "5px");

        item.append("span")
          .style("width", "12px")
          .style("height", "12px")
          .style("border-radius", "2px")
          .style("background", colorScale(group))
          .style("flex-shrink", "0");

        item.append("span")
          .style("color", "#444")
          .text(group);
      });
    } else {
      // SVG-legend till höger (standard)
      const legend = svg.append("g")
        .attr("transform", `translate(${autoWidth - marginRight + 20}, ${marginTop + 10})`);

      groups.forEach((group, i) => {
        const g = legend.append("g")
          .attr("transform", `translate(0, ${i * 24})`);

        g.append("rect")
          .attr("width", 18)
          .attr("height", 18)
          .attr("fill", colorScale(group))
          .attr("rx", 2);

        g.append("text")
          .attr("x", 26)
          .attr("y", 14)
          .attr("font-size", "12px")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .attr("fill", "#1a1a1a")
          .text(group);
      });
    }
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
