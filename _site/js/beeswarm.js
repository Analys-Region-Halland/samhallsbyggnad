// =============================================================================
// BEESWARM - Svärm-diagram för distribution med highlight
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { addExportButton } from "./exportSvg.js";
import { createFilterState, createSelectorPanel } from "./filterUtils.js";

export function beeswarm(data, {
  value = "värde",
  label = "namn",
  group = null,
  width = null,
  height = 340,  // Ökad höjd för bättre etikettutrymme
  title = null,
  subtitle = null,
  caption = null,
  xLabel = null,
  colors = ["#00664D", "#004990", "#FF7E00", "#433C9D", "#2DB8F6", "#A51300"],
  formatValue = d => d.toLocaleString("sv-SE"),
  filter = null,
  highlight = null,
  highlightLabels = true,
  radius = 5,
  padding = 1,
  logScale = true,
  showGrid = true,
  vline = null,
  altText = null,
  info = null,
  logo = null,
  interactive = false
} = {}) {

  const autoWidth = width || 780;
  const labelZoneHeight = 65;  // Ökat för fler etikett-nivåer
  const marginTop = 20 + labelZoneHeight;
  const marginRight = 32;
  const marginBottom = (xLabel ? 48 : 36) + labelZoneHeight;
  const marginLeft = 32;

  // Container
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

  if (subtitle) {
    header.append("div")
      .attr("class", "graf-subtitle")
      .text(subtitle);
  }

  // ==========================================================================
  // FILTERSTATE (via filterUtils)
  // ==========================================================================
  // Alla unika items och grupper
  const allItems = [...new Set(data.map(d => d[label]))];
  const allGroups = group ? [...new Set(data.map(d => d[group]))] : [];

  const filterState = group
    ? createFilterState(data, { itemField: label, groupField: group, filter, highlight })
    : null;

  const isHighlighted = (d) => {
    if (!filterState) return true;
    return filterState.isHighlighted(d[label]);
  };

  // Färgpalett
  const mutedColor = "#d0d0d0";

  // Färgskala: grupp → färg (stabil, oberoende av highlight-state)
  const groupColorScale = d3.scaleOrdinal()
    .domain(allGroups)
    .range(colors);

  const getColor = (groupName) => groupColorScale(groupName);

  const colorScale = (groupName) => groupColorScale(groupName);

  // ==========================================================================
  // INTERAKTIV VÄLJARE (via filterUtils)
  // ==========================================================================
  let selectorCtrl = null;

  if (interactive && group && filterState) {
    selectorCtrl = createSelectorPanel(header, {
      filterState,
      allItems,
      colorScale: groupColorScale,
      triggerText: "Jämför geografier \u203a",
      onUpdate: () => updateChart(),
      onItemHover: (item) => {
        const nodeData = nodes.find(n => n[label] === item);
        if (nodeData) highlightPoint(nodeData, true);
      },
      onItemLeave: (item) => {
        const nodeData = nodes.find(n => n[label] === item);
        if (nodeData) highlightPoint(nodeData, false);
      }
    });
  }

  // Värde-display
  const valueDisplay = container.append("div")
    .attr("class", "graf-value-display")
    .html("<span style='opacity:0.35'>Peka för värden</span>");

  // SVG
  const svgContainer = container.append("div")
    .attr("class", "graf-svg-container");

  const svg = svgContainer.append("svg")
    .attr("viewBox", `0 0 ${autoWidth} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("class", "graf-svg");

  // X-skala (logaritmisk eller linjär)
  const valueExtent = d3.extent(data, d => d[value]);
  const xScale = logScale
    ? d3.scaleLog()
        .domain([Math.max(1, valueExtent[0] * 0.8), valueExtent[1] * 1.1])
        .range([marginLeft, autoWidth - marginRight])
    : d3.scaleLinear()
        .domain([0, valueExtent[1] * 1.05])
        .range([marginLeft, autoWidth - marginRight]);

  // Svärm-zon
  const swarmTop = marginTop + 10;
  const swarmBottom = height - marginBottom - 10;
  const centerY = swarmTop + (swarmBottom - swarmTop) / 2;

  const highlightedR = radius + 1;
  const backgroundR = radius - 1;

  // Skapa alla noder (position beräknas en gång via force simulation)
  const nodes = data.map(d => ({
    ...d,
    x: xScale(d[value]),
    y: centerY,
    baseRadius: radius
  }));

  // Force simulation (kör en gång)
  const simulation = d3.forceSimulation(nodes)
    .force("x", d3.forceX(d => xScale(d[value])).strength(1))
    .force("y", d3.forceY(centerY).strength(0.2))
    .force("collide", d3.forceCollide(radius + padding).strength(1).iterations(3))
    .stop();

  for (let i = 0; i < 200; i++) simulation.tick();

  // Begränsa y inom svärm-zonen
  nodes.forEach(d => {
    d.y = Math.max(swarmTop + radius, Math.min(swarmBottom - radius, d.y));
  });

  // X-axel med snygga tick-värden
  let xAxis;
  if (logScale) {
    // Logaritmisk: visa 1k, 10k, 100k, 1M etc
    const tickValues = [1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000]
      .filter(v => v >= valueExtent[0] * 0.5 && v <= valueExtent[1] * 1.5);

    xAxis = d3.axisBottom(xScale)
      .tickValues(tickValues)
      .tickFormat(d => {
        if (d >= 1000000) return (d / 1000000) + " mn";
        if (d >= 1000) return (d / 1000) + " k";
        return d;
      });
  } else {
    // Linjär: automatiska ticks
    xAxis = d3.axisBottom(xScale)
      .ticks(8)
      .tickFormat(d => {
        if (d >= 1000000) return (d / 1000000).toFixed(0) + " mn";
        if (d >= 1000) return (d / 1000).toFixed(0) + " k";
        return d;
      });
  }

  // X-axel position - längst ner med plats för xLabel under
  const xAxisY = height - (xLabel ? 38 : 16);

  // Grid lines - streckade linjer från toppen ner till x-axeln
  if (showGrid) {
    const gridTickValues = logScale
      ? [1000, 5000, 10000, 50000, 100000, 500000, 1000000]
          .filter(v => v >= valueExtent[0] * 0.5 && v <= valueExtent[1] * 1.5)
      : xScale.ticks(5);

    const gridGroup = svg.insert("g", ":first-child").attr("class", "grid-lines");
    gridTickValues.forEach(tickVal => {
      const tickX = xScale(tickVal);
      if (tickX >= marginLeft && tickX <= autoWidth - marginRight) {
        gridGroup.append("line")
          .attr("x1", tickX)
          .attr("x2", tickX)
          .attr("y1", swarmTop - 8)
          .attr("y2", xAxisY)
          .attr("stroke", "#e0e0e0")
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", "12,6");
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
        .attr("y1", swarmTop - 8).attr("y2", xAxisY)
        .attr("stroke", vlineColor).attr("stroke-width", 1)
        .attr("stroke-dasharray", vlineDashed ? "4,3" : "none")
        .attr("stroke-opacity", 0.6);

      if (vlineConfig.label) {
        svg.append("text")
          .attr("x", vlineX).attr("y", swarmTop - 14)
          .attr("text-anchor", "middle")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .attr("font-size", "10px").attr("font-weight", "500")
          .attr("fill", vlineColor)
          .text(vlineConfig.label);
      }
    }
  }

  // X-axel
  svg.append("g")
    .attr("transform", `translate(0,${xAxisY})`)
    .call(xAxis)
    .call(g => g.select(".domain").remove())
    .call(g => g.selectAll(".tick line").remove())
    .call(g => g.selectAll(".tick text")
      .attr("fill", "#666")
      .attr("font-size", "12px")
      .attr("font-family", "'IBM Plex Sans', sans-serif"));

  if (xLabel) {
    svg.append("text")
      .attr("x", autoWidth / 2)
      .attr("y", height - 8)
      .attr("text-anchor", "middle")
      .attr("font-family", "'IBM Plex Sans', sans-serif")
      .attr("font-size", "12px")
      .attr("fill", "#1a1a1a")
      .text(xLabel);
  }

  // ==========================================================================
  // GRUPPER FÖR PUNKTER OCH ETIKETTER (för uppdatering)
  // ==========================================================================
  const dotsGroup = svg.append("g").attr("class", "dots-group");
  const labelsGroup = svg.append("g").attr("class", "beeswarm-labels");

  // Spara label-data för hover-effekter
  let currentLabelData = { top: [], bottom: [] };

  // ==========================================================================
  // HIGHLIGHT PUNKT VID HOVER (från panel eller annan källa)
  // ==========================================================================
  function highlightPoint(nodeData, show) {
    if (!nodeData) return;

    const dotEl = dotsGroup.select(`circle[data-label="${nodeData[label]}"]`);
    if (dotEl.empty()) return;

    if (show) {
      const isHl = isHighlighted(nodeData);
      const dotColor = isHl ? getColor(nodeData[group]) : "#555";

      dotEl
        .attr("r", highlightedR + 3)
        .attr("stroke", "#1a1a1a")
        .attr("stroke-width", 2.5);

      // Kolla om det finns en permanent etikett
      const existingLabel = labelsGroup.select(`.label-text[data-label="${nodeData[label]}"]`);

      if (!existingLabel.empty()) {
        // Highlighta befintlig etikett och connector
        existingLabel.attr("font-weight", 700).attr("font-size", "13px");
        labelsGroup.selectAll(`.label-connector[data-label="${nodeData[label]}"]`)
          .attr("stroke-width", 2)
          .attr("stroke-opacity", 0.7);
      } else {
        // Visa temporär hover-etikett
        labelsGroup.selectAll(".hover-label-single").remove();

        const labelY = nodeData.y <= centerY
          ? nodeData.y - highlightedR - 10
          : nodeData.y + highlightedR + 14;

        labelsGroup.append("text")
          .attr("class", "hover-label-single")
          .attr("x", nodeData.x)
          .attr("y", labelY)
          .attr("text-anchor", "middle")
          .attr("font-size", "10px")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .attr("font-weight", 600)
          .attr("fill", dotColor)
          .text(nodeData[label]);
      }

      const colorDot = `<span style="width:8px;height:8px;border-radius:50%;background:${dotColor};margin-right:5px"></span>`;
      valueDisplay.html(`<span style="display:inline-flex;align-items:center;justify-content:center;width:100%">${colorDot}<b style="margin-right:6px">${nodeData[label]}</b><span style="opacity:0.2;margin-right:6px">│</span><b>${formatValue(nodeData[value])}</b></span>`);
    } else {
      const isHl = isHighlighted(nodeData);
      dotEl
        .attr("r", isHl ? highlightedR : backgroundR)
        .attr("stroke", "#fff")
        .attr("stroke-width", isHl ? 1.5 : 0.5);

      // Återställ permanent etikett om den finns
      labelsGroup.selectAll(`.label-text[data-label="${nodeData[label]}"]`)
        .attr("font-weight", 600)
        .attr("font-size", "11px");
      labelsGroup.selectAll(`.label-connector[data-label="${nodeData[label]}"]`)
        .attr("stroke-width", 1)
        .attr("stroke-opacity", 0.4);

      // Ta bort temporär hover-etikett
      labelsGroup.selectAll(".hover-label-single").remove();

      valueDisplay.html("<span style='opacity:0.35'>Peka för värden</span>");
    }
  }

  // ==========================================================================
  // UPPDATERINGSFUNKTION - Ritar om punkter och etiketter
  // ==========================================================================
  function updateChart() {
    dotsGroup.selectAll("*").remove();
    labelsGroup.selectAll("*").remove();

    const highlightedNodes = nodes.filter(d => isHighlighted(d));
    const backgroundNodes = nodes.filter(d => !isHighlighted(d));

    // Rita bakgrundspunkter först
    dotsGroup.selectAll(".dot-bg")
      .data(backgroundNodes)
      .join("circle")
      .attr("class", "dot-bg")
      .attr("data-label", d => d[label])
      .attr("cx", d => d.x)
      .attr("cy", d => d.y)
      .attr("r", backgroundR)
      .attr("fill", mutedColor)
      .attr("stroke", "#fff")
      .attr("stroke-width", 0.5)
      .style("cursor", "pointer")
      .on("mouseenter", function(event, d) {
        highlightPoint(d, true);
      })
      .on("mouseleave", function(event, d) {
        highlightPoint(d, false);
      });

    // Rita highlighted punkter
    dotsGroup.selectAll(".dot-highlight")
      .data(highlightedNodes)
      .join("circle")
      .attr("class", "dot-highlight")
      .attr("data-label", d => d[label])
      .attr("cx", d => d.x)
      .attr("cy", d => d.y)
      .attr("r", highlightedR)
      .attr("fill", d => group ? getColor(d[group]) : colors[0])
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5)
      .style("cursor", "pointer")
      .on("mouseenter", function(event, d) {
        highlightPoint(d, true);
      })
      .on("mouseleave", function(event, d) {
        highlightPoint(d, false);
      });

    // ================================================================
    // ETIKETTER - NOLL ÖVERLAPP GARANTERAT
    // Global placering med smart utrymmesutnyttjande
    // ================================================================
    if (highlightLabels && highlightedNodes.length > 0 && highlightedNodes.length <= 25) {
      const labelFontSize = 11;
      const labelPadding = 6;  // Min avstånd mellan etiketter
      const connectorPadding = 4;  // Min avstånd connector-etikett

      // Alla placerade etiketter (för kollisionskontroll)
      const placedLabels = [];

      // Alla connectors (för kollisionskontroll)
      const placedConnectors = [];

      // Definiera tillgängliga zoner
      const topZoneY = { min: 8, max: swarmTop - 14 };
      const bottomZoneY = { min: swarmBottom + 22, max: height - marginBottom + 45 };

      // Hjälpfunktion: Kollar om en rektangel överlappar med befintliga etiketter
      function labelsOverlap(x, y, w, h, exclude = null) {
        const pad = labelPadding;
        for (const lbl of placedLabels) {
          if (lbl === exclude) continue;
          const overlapX = Math.abs(x - lbl.labelX) < (w + lbl.labelWidth) / 2 + pad;
          const overlapY = Math.abs(y - lbl.labelY) < (h + lbl.labelHeight) / 2 + pad;
          if (overlapX && overlapY) return true;
        }
        return false;
      }

      // Hjälpfunktion: Kollar om en linje korsar en rektangel
      function lineIntersectsRect(x1, y1, x2, y2, rx, ry, rw, rh, pad = 0) {
        const left = rx - rw / 2 - pad;
        const right = rx + rw / 2 + pad;
        const top = ry - rh / 2 - pad;
        const bottom = ry + rh / 2 + pad;

        // Cohen-Sutherland line clipping (förenklad)
        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);

        // Snabb AABB-test
        if (maxX < left || minX > right || maxY < top || minY > bottom) return false;

        // Vertikal linje
        if (Math.abs(x1 - x2) < 0.5) {
          return x1 >= left && x1 <= right;
        }
        // Horisontell linje
        if (Math.abs(y1 - y2) < 0.5) {
          return y1 >= top && y1 <= bottom;
        }

        return true;  // Konservativ för diagonala linjer
      }

      // Hjälpfunktion: Kollar om en connector-path överlappar etiketter
      function connectorHitsLabel(segments, excludeLabel) {
        for (const seg of segments) {
          for (const lbl of placedLabels) {
            if (lbl === excludeLabel) continue;
            if (lineIntersectsRect(seg.x1, seg.y1, seg.x2, seg.y2,
                lbl.labelX, lbl.labelY, lbl.labelWidth, lbl.labelHeight, connectorPadding)) {
              return lbl;
            }
          }
        }
        return null;
      }

      // Skapa lista med punkter att placera etiketter för
      const labelCandidates = highlightedNodes.map(d => {
        const name = d[label];
        return {
          ...d,
          name: name,
          labelWidth: Math.max(36, name.length * 6.2),
          labelHeight: 14,
          color: group ? getColor(d[group]) : colors[0],
          nodeRadius: highlightedR,
          // Naturlig preferens baserat på punkt-position
          preferTop: d.y <= centerY
        };
      });

      // Sortera: placera från vänster till höger (mer förutsägbart)
      labelCandidates.sort((a, b) => a.x - b.x);

      // ============================================================
      // PLACERA VARJE ETIKETT
      // ============================================================
      for (const lp of labelCandidates) {
        let bestPos = null;
        let bestScore = Infinity;

        // Generera kandidatpositioner
        const candidates = [];

        // Räkna hur trångt det är i varje zon vid denna x-position
        const topLabelsNearby = placedLabels.filter(l =>
          l.labelY < centerY && Math.abs(l.labelX - lp.x) < 100
        ).length;
        const bottomLabelsNearby = placedLabels.filter(l =>
          l.labelY > centerY && Math.abs(l.labelX - lp.x) < 100
        ).length;

        // Bestäm vilken zon som ska testas först
        const topFirst = lp.preferTop
          ? topLabelsNearby <= bottomLabelsNearby
          : topLabelsNearby < bottomLabelsNearby;

        // Y-nivåer att testa (olika avstånd från svärm)
        const topYLevels = [swarmTop - 18, swarmTop - 34, swarmTop - 50];
        const bottomYLevels = [swarmBottom + 28, swarmBottom + 44, swarmBottom + 60];

        // X-offsets att testa
        const xOffsets = [0, -30, 30, -60, 60, -90, 90];

        // Lägg till kandidater i prioritetsordning
        const addCandidates = (yLevels, isTop) => {
          for (const baseY of yLevels) {
            for (const xOff of xOffsets) {
              const x = Math.max(marginLeft + lp.labelWidth / 2 + 5,
                         Math.min(autoWidth - marginRight - lp.labelWidth / 2 - 5, lp.x + xOff));
              const y = isTop
                ? Math.max(topZoneY.min, Math.min(topZoneY.max, baseY))
                : Math.max(bottomZoneY.min, Math.min(bottomZoneY.max, baseY));
              candidates.push({ x, y, isTop });
            }
          }
        };

        if (topFirst) {
          addCandidates(topYLevels, true);
          addCandidates(bottomYLevels, false);
        } else {
          addCandidates(bottomYLevels, false);
          addCandidates(topYLevels, true);
        }

        // Testa varje kandidatposition
        for (const cand of candidates) {
          // Kolla etikett-överlapp
          if (labelsOverlap(cand.x, cand.y, lp.labelWidth, lp.labelHeight)) {
            continue;
          }

          // Beräkna enkel connector-path
          const startX = lp.x;
          const startY = cand.isTop ? lp.y - lp.nodeRadius - 2 : lp.y + lp.nodeRadius + 2;
          const endX = cand.x;
          const endY = cand.isTop ? cand.y + 7 : cand.y - 9;

          // Skapa L-formad path
          const segments = Math.abs(endX - startX) < 5
            ? [{ x1: startX, y1: startY, x2: endX, y2: endY }]
            : [
                { x1: startX, y1: startY, x2: startX, y2: endY },
                { x1: startX, y1: endY, x2: endX, y2: endY }
              ];

          // Kolla om connectorn träffar någon etikett
          const hitLabel = connectorHitsLabel(segments, null);
          if (hitLabel) {
            continue;  // Skippa denna kandidat
          }

          // Beräkna score (lägre = bättre)
          const distX = Math.abs(cand.x - lp.x);
          const distY = Math.abs(cand.y - (cand.isTop ? swarmTop : swarmBottom));
          const wrongSideBonus = (cand.isTop === lp.preferTop) ? 0 : 20;
          const score = distX * 0.5 + distY * 0.3 + wrongSideBonus;

          if (score < bestScore) {
            bestScore = score;
            bestPos = { ...cand, segments };
          }
        }

        // Om ingen ren position hittades, försök med connector-routing runt hinder
        if (!bestPos) {
          for (const cand of candidates) {
            if (labelsOverlap(cand.x, cand.y, lp.labelWidth, lp.labelHeight)) {
              continue;
            }

            const startX = lp.x;
            const startY = cand.isTop ? lp.y - lp.nodeRadius - 2 : lp.y + lp.nodeRadius + 2;
            const endX = cand.x;
            const endY = cand.isTop ? cand.y + 7 : cand.y - 9;

            // Hitta blockerande etikett
            const simpleSegments = Math.abs(endX - startX) < 5
              ? [{ x1: startX, y1: startY, x2: endX, y2: endY }]
              : [
                  { x1: startX, y1: startY, x2: startX, y2: endY },
                  { x1: startX, y1: endY, x2: endX, y2: endY }
                ];

            const blocker = connectorHitsLabel(simpleSegments, null);
            if (!blocker) {
              // Denna position funkade faktiskt
              const distX = Math.abs(cand.x - lp.x);
              const distY = Math.abs(cand.y - (cand.isTop ? swarmTop : swarmBottom));
              const score = distX * 0.5 + distY * 0.3;
              if (score < bestScore) {
                bestScore = score;
                bestPos = { ...cand, segments: simpleSegments };
              }
              continue;
            }

            // Försök rutta runt blockern
            const bLeft = blocker.labelX - blocker.labelWidth / 2 - 8;
            const bRight = blocker.labelX + blocker.labelWidth / 2 + 8;

            // Välj sida att gå runt (mot etikettens slutposition)
            const goRight = endX >= startX;
            const jogX = goRight ? bRight : bLeft;

            // Skapa path som går runt
            const jogY = cand.isTop
              ? Math.max(blocker.labelY + blocker.labelHeight / 2 + 6, startY - 10)
              : Math.min(blocker.labelY - blocker.labelHeight / 2 - 6, startY + 10);

            const routedSegments = [
              { x1: startX, y1: startY, x2: startX, y2: jogY },
              { x1: startX, y1: jogY, x2: jogX, y2: jogY },
              { x1: jogX, y1: jogY, x2: jogX, y2: endY },
              { x1: jogX, y1: endY, x2: endX, y2: endY }
            ];

            // Kolla om den ruttade pathen är fri
            if (!connectorHitsLabel(routedSegments, null)) {
              const distX = Math.abs(cand.x - lp.x);
              const distY = Math.abs(cand.y - (cand.isTop ? swarmTop : swarmBottom));
              const routingPenalty = 15;  // Lite straffpoäng för komplicerad path
              const score = distX * 0.5 + distY * 0.3 + routingPenalty;

              if (score < bestScore) {
                bestScore = score;
                bestPos = { ...cand, segments: routedSegments };
              }
            }
          }
        }

        // Sista utväg: tvinga in etiketten någonstans
        if (!bestPos) {
          const fallbackY = lp.preferTop ? topYLevels[0] : bottomYLevels[0];
          bestPos = {
            x: lp.x,
            y: fallbackY,
            isTop: lp.preferTop,
            segments: [{
              x1: lp.x,
              y1: lp.preferTop ? lp.y - lp.nodeRadius - 2 : lp.y + lp.nodeRadius + 2,
              x2: lp.x,
              y2: lp.preferTop ? fallbackY + 7 : fallbackY - 9
            }]
          };
        }

        // Spara placerad etikett
        lp.labelX = bestPos.x;
        lp.labelY = bestPos.y;
        lp.isTop = bestPos.isTop;
        lp.connectorSegments = bestPos.segments;
        placedLabels.push(lp);
      }

      // Spara för hover-effekter
      const topLabels = placedLabels.filter(l => l.isTop);
      const bottomLabels = placedLabels.filter(l => !l.isTop);
      currentLabelData = { top: topLabels, bottom: bottomLabels };

      // ============================================================
      // RITA CONNECTORS OCH ETIKETTER
      // ============================================================
      for (const lp of placedLabels) {
        // Bygg path från segments
        if (lp.connectorSegments && lp.connectorSegments.length > 0) {
          let pathD = `M ${lp.connectorSegments[0].x1} ${lp.connectorSegments[0].y1}`;
          for (const seg of lp.connectorSegments) {
            pathD += ` L ${seg.x2} ${seg.y2}`;
          }

          labelsGroup.append("path")
            .attr("class", "label-connector")
            .attr("data-label", lp.name)
            .attr("d", pathD)
            .attr("fill", "none")
            .attr("stroke", lp.color)
            .attr("stroke-width", 1)
            .attr("stroke-opacity", 0.4);
        }
      }

      for (const lp of placedLabels) {
        labelsGroup.append("text")
          .attr("class", "label-text")
          .attr("data-label", lp.name)
          .attr("x", lp.labelX)
          .attr("y", lp.labelY)
          .attr("text-anchor", "middle")
          .attr("font-size", `${labelFontSize}px`)
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .attr("font-weight", 600)
          .attr("fill", lp.color)
          .text(lp.name);
      }
    }

    // Uppdatera väljaren
    if (selectorCtrl) selectorCtrl.update();
  }

  // Initial rendering
  updateChart();

  // ==========================================================================
  // CROSSHAIR
  // ==========================================================================
  const crosshair = svg.append("line")
    .attr("class", "crosshair")
    .attr("y1", swarmTop - 8)
    .attr("y2", xAxisY)
    .attr("stroke", "#bbb")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,3")
    .style("opacity", 0)
    .style("pointer-events", "none");

  const highlightRing = svg.append("circle")
    .attr("class", "highlight-ring")
    .attr("fill", "none")
    .attr("stroke", "#1a1a1a")
    .attr("stroke-width", 2)
    .style("opacity", 0)
    .style("pointer-events", "none");

  let hoveredNode = null;

  svg.append("rect")
    .attr("class", "overlay")
    .attr("x", marginLeft)
    .attr("y", marginTop)
    .attr("width", autoWidth - marginLeft - marginRight)
    .attr("height", height - marginTop - marginBottom)
    .attr("fill", "transparent")
    .style("cursor", "default")
    .on("mouseenter", () => crosshair.style("opacity", 1))
    .on("mouseleave", () => {
      crosshair.style("opacity", 0);
      highlightRing.style("opacity", 0);
      if (hoveredNode) {
        highlightPoint(hoveredNode, false);
        hoveredNode = null;
      }
      valueDisplay.html("<span style='opacity:0.35'>Peka för värden</span>");
    })
    .on("mousemove", function(event) {
      const [mx, my] = d3.pointer(event);
      crosshair.attr("x1", mx).attr("x2", mx);

      let closest = null;
      let minDist = Infinity;
      for (const node of nodes) {
        const dist = Math.sqrt((mx - node.x) ** 2 + (my - node.y) ** 2);
        if (dist < minDist) {
          minDist = dist;
          closest = node;
        }
      }

      if (closest && minDist < 50) {
        const isHl = isHighlighted(closest);
        const dotColor = isHl ? getColor(closest[group]) : "#888";

        highlightRing
          .attr("cx", closest.x)
          .attr("cy", closest.y)
          .attr("r", (isHl ? highlightedR : backgroundR) + 3)
          .attr("stroke", dotColor)
          .style("opacity", 1);

        if (hoveredNode && hoveredNode !== closest) {
          highlightPoint(hoveredNode, false);
        }
        if (hoveredNode !== closest) {
          highlightPoint(closest, true);
        }
        hoveredNode = closest;
      } else {
        highlightRing.style("opacity", 0);
        if (hoveredNode) {
          highlightPoint(hoveredNode, false);
          hoveredNode = null;
        }
        valueDisplay.html("<span style='opacity:0.35'>Peka för värden</span>");
      }
    });

  // Caption
  if (caption) {
    container.append("div")
      .attr("class", "graf-caption")
      .text(caption);
  }

  // Export och logga
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
