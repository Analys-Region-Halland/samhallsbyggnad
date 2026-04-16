// =============================================================================
// KARTA - Kartkomponent för Sveriges kommuner och län
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import * as topojson from "https://cdn.jsdelivr.net/npm/topojson-client@3/+esm";
import { addExportButton } from "./exportSvg.js";
import { createFilterState, createSelectorPanel } from "./filterUtils.js";

export function karta(geodata, {
  // Datalänkning (optional choropleth)
  data = null,
  id = "KnKod",
  dataId = null,
  value = null,

  // Kartlager
  layer = "kommuner",
  boundaries = "lan",

  // Dimensioner
  width = null,
  height = 700,

  // Text
  title = null,
  subtitle = null,
  caption = null,
  label = "KnNamn",

  // Färger
  colorScheme = "greens",
  colorSteps = 5,
  colors = null,
  missingColor = "#e8e8e8",
  fillColor = "#f8f6f3",

  // Format
  formatValue = d => d.toLocaleString("sv-SE"),
  unit = "",

  // Interaktion
  interactive = false,
  filter = null,
  highlight = null,

  // Zoom
  zoomTo = null,
  zoomPadding = 1.8,

  // Tätorter
  places = null,

  // Infrastrukturlager (TopoJSON-objekt)
  roads = null,
  railways = null,
  urbanAreas = null,
  urbanLabel = "tatort",
  urbanPop = "bef",
  urbanMinPop = 10000,

  // Kategorisk färgning (rutnätskartor)
  colorBy = null,       // Feature-property för kategorisk fyllning

  // Overlay-lager (tända/släcka, t.ex. tätorter)
  overlay = null,           // TopoJSON med overlay-features
  overlayLabel = "name",    // Property för label
  overlayPop = "population",// Property för befolkning
  overlayVisible = false,   // Initialt synligt?

  // Proportionella cirklar (bubblekarta)
  bubbles = null,                     // Feature-property för cirkelstorlek
  bubbleSource = null,                // TopoJSON-objekt för bubbeldata (default: layer)
  bubbleColor = [220, 60, 40],        // RGB-array
  bubbleOpacity = 0.35,               // Opacitet i cirkelns centrum
  bubbleInteractive = false,          // Aktiverar histogram, sliders, aggregation
  bubbleLabels = false,               // Visa etiketter på de största bubblorna
  // Standard
  altText = null,
  info = null,
  logo = null
} = {}) {

  const autoWidth = width || 780;

  // ============================================================================
  // GEODATA - Extrahera features och mesh
  // ============================================================================
  const features = topojson.feature(geodata, geodata.objects[layer]).features;

  // colorBy: kategorisk färgskala + regionmappning
  let colorByScale = null;
  const lnNameMap = new Map();
  const lnCodeMap = new Map();
  if (colorBy) {
    const cats = [...new Set(features.map(f => f.properties[colorBy]))];
    colorByScale = d3.scaleOrdinal().domain(cats).range(colors || ["#1b0a3c","#7b2d8e","#0f7b3f","#8cd211","#ffc107","#e8491a","#f0d9a0"]);
    if (geodata.objects.lan) {
      for (const lf of topojson.feature(geodata, geodata.objects.lan).features) {
        lnNameMap.set(lf.properties.LnKod, lf.properties.LnNamn);
        lnCodeMap.set(lf.properties.LnNamn, lf.properties.LnKod);
      }
    }
  }

  // Mesh-källa: använd kommuner-lager för gränser när colorBy/bubbles är aktivt
  const meshSource = (colorBy || bubbles) && geodata.objects.kommuner ? "kommuner" : layer;

  // Bubble data source: separate layer or main features
  const bubbleFeatures = bubbles && bubbleSource && geodata.objects[bubbleSource]
    ? topojson.feature(geodata, geodata.objects[bubbleSource]).features
    : features;

  // Länsgränser: använd separat lager om det finns, annars derivera från kommuner
  const boundaryMesh = (() => {
    if (boundaries && geodata.objects[boundaries]) {
      return topojson.mesh(geodata, geodata.objects[boundaries], (a, b) => a !== b);
    }
    return topojson.mesh(geodata, geodata.objects[meshSource], (a, b) => {
      return a !== b &&
        a.properties.KnKod && b.properties.KnKod &&
        a.properties.KnKod.slice(0, 2) !== b.properties.KnKod.slice(0, 2);
    });
  })();
  const outerMesh = topojson.mesh(geodata, geodata.objects[meshSource], (a, b) => a === b);

  // Intern mesh (kommun-gränser, tunnare)
  const innerMesh = topojson.mesh(geodata, geodata.objects[meshSource], (a, b) => a !== b);

  // Infrastrukturlager
  const roadFeatures = roads && geodata.objects[roads]
    ? topojson.feature(geodata, geodata.objects[roads]).features : [];
  const railwayFeatures = railways && geodata.objects[railways]
    ? topojson.feature(geodata, geodata.objects[railways]).features : [];
  const urbanFeatures = urbanAreas && geodata.objects[urbanAreas]
    ? topojson.feature(geodata, geodata.objects[urbanAreas]).features : [];

  // Overlay-lager (separat TopoJSON, t.ex. tätorter)
  const overlayFeatures = (() => {
    if (!overlay || !overlay.objects) return [];
    const objName = Object.keys(overlay.objects)[0];
    return topojson.feature(overlay, overlay.objects[objName]).features;
  })();
  let overlayOn = overlayVisible;

  // ============================================================================
  // DATALÄNKNING (choropleth)
  // ============================================================================
  const dataKey = dataId || id;
  let dataMap = new Map();
  if (data && value) {
    for (const d of data) {
      dataMap.set(String(d[dataKey]), d[value]);
    }
  }
  const hasChoropleth = data && value && dataMap.size > 0;

  // Färgskala för choropleth
  let colorScale = null;
  if (hasChoropleth) {
    const values = [...dataMap.values()].filter(v => v != null && !isNaN(v));
    const extent = d3.extent(values);

    const schemeMap = {
      greens: d3.interpolateGreens,
      blues: d3.interpolateBlues,
      oranges: d3.interpolateOranges,
      reds: d3.interpolateReds,
      purples: d3.interpolatePurples,
      diverging: d3.interpolateRdYlGn
    };

    if (colors) {
      colorScale = d3.scaleQuantize().domain(extent).range(colors);
    } else {
      const interpolator = schemeMap[colorScheme] || d3.interpolateGreens;
      const steps = d3.range(colorSteps).map(i => interpolator(0.15 + (i / (colorSteps - 1)) * 0.75));
      colorScale = d3.scaleQuantize().domain(extent).range(steps);
    }
  }

  // ============================================================================
  // HIGHLIGHT-LOGIK
  // ============================================================================
  // Bygg en grupp-mapping: kommun → län via KnKod prefix
  const kommunLänMap = new Map();
  if (!colorBy) {
    if (geodata.objects.lan) {
      const länNames = new Map();
      for (const f of topojson.feature(geodata, geodata.objects.lan).features) {
        länNames.set(f.properties.LnKod, f.properties.LnNamn);
      }
      for (const f of features) {
        const lnKod = f.properties.KnKod ? f.properties.KnKod.slice(0, 2) : null;
        kommunLänMap.set(f.properties[label], lnKod ? (länNames.get(lnKod) || lnKod) : null);
      }
    } else {
      for (const f of features) {
        kommunLänMap.set(f.properties[label], f.properties.LnNamn || null);
      }
    }
  }

  // Bygg data-array för filterState
  const filterData = colorBy
    ? [...new Set(features.map(f => lnNameMap.get(f.properties.ln)))].filter(Boolean).map(name => ({ [label]: name, group: name }))
    : features.map(f => ({
        [label]: f.properties[label],
        group: kommunLänMap.get(f.properties[label]) || "Övrigt"
      }));

  const allItems = features.map(f => f.properties[label]);
  const highlightColors = ["#00664D", "#004990", "#FF7E00", "#433C9D", "#2DB8F6", "#A51300"];

  const filterState = createFilterState(filterData, {
    itemField: label,
    groupField: "group",
    filter,
    highlight
  });

  const isHighlighted = (f) => filterState.isHighlighted(f.properties[label]);

  // Färg för en feature
  const mutedColor = "#e6e1da";
  const highlightColor = fillColor;

  const groupColorScale = d3.scaleOrdinal()
    .domain([...new Set(filterData.map(d => d.group))])
    .range(highlightColors);

  function getFill(f) {
    if (colorBy) {
      return colorByScale(f.properties[colorBy]);
    }
    if (hasChoropleth) {
      const val = dataMap.get(String(f.properties[id]));
      if (val == null || isNaN(val)) return missingColor;
      return colorScale(val);
    }
    // Highlight-läge
    if (highlight) {
      return isHighlighted(f) ? highlightColor : mutedColor;
    }
    return fillColor;
  }

  // Opacity för colorBy: highlighted region = full, övrigt = dimmat
  function getFeatureOpacity(f) {
    if (!colorBy || !highlight) return 1;
    const ln = f.properties.ln;
    if (!ln) return 1;
    const regionName = lnNameMap.get(ln);
    if (regionName && highlight.includes(regionName)) return 1;
    return 0.45;
  }

  // ============================================================================
  // CONTAINER + HEADER
  // ============================================================================
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

  // ============================================================================
  // BUBBLE INTERACTIVE STATE
  // ============================================================================
  let aggLevel = "1km", resolvedLevel = "1km", popThreshold = 0;
  let precomputed = null, bubbleLayer = null, bubbleLegendGroup = null;
  // Proximity hover state
  let hoveredBubble = null, renderedBubbles = null;
  let bubbleOpScale = null, bubbleStrokeW = 0;
  // UI refs (assigned when controls are built)
  let statBarCellsEl = null, statBarPopEl = null;
  let statTextCellsEl = null, statTextPopEl = null, sliderValEl = null;
  let histSvgEl = null, histXScale = null, histBinsData = null;

  // ============================================================================
  // BUBBLE INTERACTIVE CONTROLS
  // ============================================================================
  if (bubbles && bubbleInteractive) {
    // CSS injection (once per page)
    if (!document.getElementById("graf-bubble-controls-css")) {
      const style = document.createElement("style");
      style.id = "graf-bubble-controls-css";
      style.textContent = `
        .graf-bubble-controls {
          display: flex; flex-direction: column; gap: 6px; margin-top: 8px;
          font-family: 'IBM Plex Sans', system-ui, sans-serif; font-size: 12px; color: #555;
        }
        .graf-bubble-top-row {
          display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
        }
        .graf-bubble-agg-group {
          display: flex; align-items: center; gap: 4px; flex-shrink: 0;
        }
        .graf-bubble-agg-btn {
          padding: 3px 10px; border: 1px solid #d0ccc6; border-radius: 4px;
          background: #fff; font-family: inherit; font-size: 11px; color: #666;
          cursor: pointer; transition: all 0.15s; user-select: none; line-height: 1.2;
        }
        .graf-bubble-agg-btn:hover { border-color: #999; color: #333; }
        .graf-bubble-agg-btn.active { background: #2c2826; color: #fff; border-color: #2c2826; }
        .graf-bubble-slider-group {
          display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;
        }
        .graf-bubble-slider-lbl {
          font-size: 10px; color: #999; flex-shrink: 0;
        }
        .graf-bubble-slider {
          width: 100px; max-width: 120px; -webkit-appearance: none; appearance: none;
          height: 4px; border-radius: 2px; background: #e0ddd8; outline: none; cursor: pointer;
        }
        .graf-bubble-slider::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none; width: 14px; height: 14px;
          border-radius: 50%; background: #2c2826; cursor: pointer;
          border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .graf-bubble-slider-val {
          font-size: 11px; color: #555; font-variant-numeric: tabular-nums; min-width: 22px;
        }
        .graf-bubble-stat { display: flex; flex-direction: column; gap: 3px; }
        .graf-bubble-stat-row { display: flex; align-items: center; gap: 6px; }
        .graf-bubble-stat-bar {
          width: 80px; height: 6px; background: #eee; border-radius: 3px;
          overflow: hidden; flex-shrink: 0;
        }
        .graf-bubble-stat-fill {
          height: 100%; border-radius: 3px; transition: width 0.25s ease;
        }
        .graf-bubble-stat-text {
          font-size: 10px; color: #777; font-variant-numeric: tabular-nums; white-space: nowrap;
        }
      `;
      document.head.appendChild(style);
    }

    const bubbleControls = header.append("div")
      .attr("class", "graf-bubble-controls");

    // Top row: agg buttons + slider
    const topRow = bubbleControls.append("div")
      .attr("class", "graf-bubble-top-row");

    // Aggregation level buttons (1 km / 5 km only)
    const aggRow = topRow.append("div")
      .attr("class", "graf-bubble-agg-group");

    const levels = [
      { key: "1km", label: "1 km" },
      { key: "5km", label: "5 km" }
    ];
    for (const lvl of levels) {
      aggRow.append("button")
        .attr("class", `graf-bubble-agg-btn${lvl.key === aggLevel ? " active" : ""}`)
        .attr("data-level", lvl.key)
        .text(lvl.label)
        .on("click", function() {
          aggLevel = lvl.key;
          resolvedLevel = lvl.key;
          aggRow.selectAll(".graf-bubble-agg-btn").classed("active", false);
          d3.select(this).classed("active", true);
          renderBubbles();
          updateBubbleLegend();
        });
    }

    // Threshold slider (compact)
    const sliderGroup = topRow.append("div")
      .attr("class", "graf-bubble-slider-group");
    sliderGroup.append("span").attr("class", "graf-bubble-slider-lbl").text("Min:");

    sliderGroup.append("input")
      .attr("class", "graf-bubble-slider")
      .attr("type", "range").attr("min", 0).attr("max", 1500).attr("value", 0)
      .on("input", function() {
        popThreshold = +this.value;
        sliderValEl.text(popThreshold);
        updateBubbleStat();
        renderBubbles();
      });

    sliderValEl = sliderGroup.append("span")
      .attr("class", "graf-bubble-slider-val").text("0");
    sliderGroup.append("span").attr("class", "graf-bubble-slider-lbl")
      .text("inv/km\u00b2");

    // Stat bars (cells + population, populated after data computation)
    const statBlock = bubbleControls.append("div").attr("class", "graf-bubble-stat");

    const cellRow = statBlock.append("div").attr("class", "graf-bubble-stat-row");
    cellRow.append("div").attr("class", "graf-bubble-stat-bar")
      .append("div").attr("class", "graf-bubble-stat-fill")
      .style("width", "100%").style("background", `rgba(${bubbleColor}, 0.45)`);
    statTextCellsEl = cellRow.append("span").attr("class", "graf-bubble-stat-text");
    statBarCellsEl = cellRow.select(".graf-bubble-stat-fill");

    const popRow = statBlock.append("div").attr("class", "graf-bubble-stat-row");
    popRow.append("div").attr("class", "graf-bubble-stat-bar")
      .append("div").attr("class", "graf-bubble-stat-fill")
      .style("width", "100%").style("background", `rgba(${bubbleColor}, 0.8)`);
    statTextPopEl = popRow.append("span").attr("class", "graf-bubble-stat-text");
    statBarPopEl = popRow.select(".graf-bubble-stat-fill");

    // Mini histogram container (built after data is computed)
    bubbleControls.append("div").attr("class", "graf-bubble-hist");
  }

  // ============================================================================
  // OVERLAY TOGGLE-KNAPP
  // ============================================================================
  let overlayToggle = null;
  if (overlayFeatures.length > 0) {
    overlayToggle = header.append("div")
      .style("display", "flex")
      .style("align-items", "center")
      .style("gap", "8px")
      .style("margin-top", "6px")
      .style("font-family", "'IBM Plex Sans', system-ui, sans-serif")
      .style("font-size", "12px")
      .style("color", "#555")
      .style("cursor", "pointer")
      .style("user-select", "none")
      .on("click", () => {
        overlayOn = !overlayOn;
        overlayToggle.select(".overlay-toggle-dot")
          .style("background", overlayOn ? "#00664D" : "#ccc");
        overlayToggle.select(".overlay-toggle-label")
          .style("color", overlayOn ? "#2c2826" : "#999");
        mapGroup.selectAll(".overlay-path")
          .style("pointer-events", overlayOn ? "all" : "none")
          .transition().duration(300)
          .style("opacity", overlayOn ? 1 : 0);
      });

    overlayToggle.append("span")
      .attr("class", "overlay-toggle-dot")
      .style("width", "10px")
      .style("height", "10px")
      .style("border-radius", "50%")
      .style("background", overlayOn ? "#00664D" : "#ccc")
      .style("flex-shrink", "0")
      .style("transition", "background 0.2s");

    overlayToggle.append("span")
      .attr("class", "overlay-toggle-label")
      .style("color", overlayOn ? "#2c2826" : "#999")
      .style("transition", "color 0.2s")
      .text("Visa tätorter");
  }

  // ============================================================================
  // INTERAKTIV VÄLJARE
  // ============================================================================
  let selectorCtrl = null;

  if (interactive && filterState) {
    selectorCtrl = createSelectorPanel(header, {
      filterState,
      allItems,
      colorScale: groupColorScale,
      triggerText: "Välj kommuner \u203a",
      onUpdate: () => updateChart(),
      onItemHover: (item) => {
        const feat = features.find(f => f.properties[label] === item);
        if (feat) highlightFeature(feat, true);
      },
      onItemLeave: (item) => {
        const feat = features.find(f => f.properties[label] === item);
        if (feat) highlightFeature(feat, false);
      }
    });
  }

  // ============================================================================
  // VÄRDE-DISPLAY
  // ============================================================================
  const valueDisplay = container.append("div")
    .attr("class", "graf-value-display")
    .html("<span style='opacity:0.35'>Peka på kartan</span>");

  // ============================================================================
  // SVG + PROJEKTION
  // ============================================================================
  const svgContainer = container.append("div")
    .attr("class", "graf-svg-container");

  // Beräkna kartans höjd exkl. legend
  const legendHeight = hasChoropleth ? 50 : 0;
  const mapHeight = height - legendHeight;

  const svg = svgContainer.append("svg")
    .attr("viewBox", `0 0 ${autoWidth} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("class", "graf-svg");

  // Projektion: SWEREF99 TM → skärm (reflektera Y, anpassa till storlek)
  const margin = { top: 10, right: 10, bottom: 10 + legendHeight, left: 10 };
  const projection = d3.geoIdentity()
    .reflectY(true)
    .fitSize(
      [autoWidth - margin.left - margin.right, mapHeight - margin.top - margin.bottom],
      topojson.feature(geodata, geodata.objects[layer])
    );

  const path = d3.geoPath(projection);

  // Clip-rect + SVG-filter (unikt ID per instans)
  const instId = Math.random().toString(36).slice(2, 8);
  const clipId = `map-clip-${instId}`;
  const defs = svg.append("defs");

  defs.append("clipPath")
    .attr("id", clipId)
    .append("rect")
    .attr("x", 0).attr("y", 0)
    .attr("width", autoWidth)
    .attr("height", mapHeight);

  // Drop shadow för yttre gräns
  const shadowFilter = defs.append("filter")
    .attr("id", `map-shadow-${instId}`)
    .attr("x", "-5%").attr("y", "-5%")
    .attr("width", "110%").attr("height", "110%");
  shadowFilter.append("feDropShadow")
    .attr("dx", 0).attr("dy", 1).attr("stdDeviation", 2.5)
    .attr("flood-color", "#000").attr("flood-opacity", 0.1);

  // Kartgrupp med clip
  const mapGroup = svg.append("g")
    .attr("clip-path", `url(#${clipId})`)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // ============================================================================
  // TÄTORTER - centroider från riktiga tätortsgeometrier eller punkt-array
  // ============================================================================
  let resolvedPlaces = [];
  if (places) {
    // Bestäm om places är TopoJSON (har .objects) eller enkel array
    let placeList;
    if (places.type === "Topology" && places.objects) {
      const objName = Object.keys(places.objects)[0];
      const placeFeatures = topojson.feature(places, places.objects[objName]).features;
      // Beräkna centroid från varje tätortspolygon via samma projektion
      placeList = placeFeatures.map(f => {
        const [cx, cy] = path.centroid(f);
        return {
          name: f.properties.name,
          population: f.properties.population || 0,
          kommun: f.properties.kommun,
          lan: f.properties.lan,
          _cx: cx, _cy: cy
        };
      }).filter(p => !isNaN(p._cx) && !isNaN(p._cy));
    } else if (Array.isArray(places)) {
      // Gammal format: enkel array med { name, population, kommun? }
      placeList = places.map(p => {
        const kommun = p.kommun || p.name;
        const feature = features.find(f => f.properties[label] === kommun);
        if (!feature) return null;
        const [cx, cy] = path.centroid(feature);
        if (isNaN(cx) || isNaN(cy)) return null;
        return { name: p.name, population: p.population || 0, kommun, _cx: cx, _cy: cy };
      }).filter(Boolean);
    } else {
      placeList = [];
    }

    for (const p of placeList) {
      const tier = p.tier || (
        p.population >= 200000 ? 1 :
        p.population >= 50000 ? 2 :
        p.population >= 15000 ? 3 : 4
      );

      const isHl = highlight
        ? highlight.includes(p.kommun || p.name) || highlight.includes(p.name)
        : false;

      resolvedPlaces.push({
        name: p.name,
        population: p.population,
        cx: p._cx, cy: p._cy, tier,
        isHl
      });
    }

    // Sortera: minst population först (ritas först = under)
    resolvedPlaces.sort((a, b) => a.population - b.population);

    // Proportionell radieskala (area ∝ befolkning), capped vid 250k
    const maxPop = 250000;
    const radiusScale = d3.scaleSqrt()
      .domain([0, maxPop])
      .range([0.8, 22]);

    for (const p of resolvedPlaces) {
      p.radius = radiusScale(Math.min(p.population, maxPop));
    }
  }

  // Auto-generera tätortscirklar från urbanAreas om places ej angivet
  if (resolvedPlaces.length === 0 && urbanFeatures.length > 0) {
    for (const f of urbanFeatures) {
      const pop = f.properties[urbanPop] || 0;
      if (pop < urbanMinPop) continue;
      const [cx, cy] = path.centroid(f);
      if (isNaN(cx) || isNaN(cy)) continue;
      const name = f.properties[urbanLabel] || "";
      const kommun = f.properties.kommunnamn || name;
      const tier = pop >= 200000 ? 1 : pop >= 50000 ? 2 : pop >= 15000 ? 3 : 4;
      const isHl = highlight
        ? highlight.includes(kommun) || highlight.includes(name)
        : false;

      resolvedPlaces.push({ name, population: pop, cx, cy, tier, isHl });
    }
    resolvedPlaces.sort((a, b) => a.population - b.population);
    const maxPop = 250000;
    const radiusScale = d3.scaleSqrt().domain([0, maxPop]).range([0.8, 22]);
    for (const p of resolvedPlaces) {
      p.radius = radiusScale(Math.min(p.population, maxPop));
    }
  }

  let currentK = 1;

  function isPlaceVisible(p, k) {
    if (p.isHl) return true;
    if (p.radius >= 8) return true;
    if (p.radius >= 4) return k >= 1.3;
    if (p.radius >= 2) return k >= 2.5;
    return k >= 4;
  }

  // ============================================================================
  // ZOOM
  // ============================================================================
  // Resolva vilka features att zooma till
  const resolvedZoomTo = zoomTo === true ? highlight : zoomTo;
  const zoomFeatures = resolvedZoomTo
    ? (colorBy
        ? features.filter(f => {
            const regionName = lnNameMap.get(f.properties.ln);
            return regionName && resolvedZoomTo.includes(regionName);
          })
        : features.filter(f => resolvedZoomTo.includes(f.properties[label])))
    : null;

  // Beräkna zoom-transform för en uppsättning features
  function computeZoomTransform(targetFeatures, padding) {
    const collection = { type: "FeatureCollection", features: targetFeatures };
    const [[x0, y0], [x1, y1]] = path.bounds(collection);
    const bw = x1 - x0;
    const bh = y1 - y0;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;

    const scale = Math.min(
      (autoWidth) / (bw * padding),
      (mapHeight) / (bh * padding)
    );

    const tx = autoWidth / 2 - cx * scale;
    const ty = mapHeight / 2 - cy * scale;

    return d3.zoomIdentity.translate(tx, ty).scale(scale);
  }

  const identityTransform = d3.zoomIdentity;
  const zoomedTransform = zoomFeatures && zoomFeatures.length > 0
    ? computeZoomTransform(zoomFeatures, zoomPadding)
    : null;

  let isZoomedIn = !!zoomedTransform;
  let onZoomUpdate = null;

  // D3 zoom behavior
  const zoom = d3.zoom()
    .scaleExtent([1, zoomedTransform ? zoomedTransform.k * 1.5 : 12])
    .on("zoom", (event) => {
      mapGroup.attr("transform", event.transform);
      currentK = event.transform.k;

      // Counter-scale tätorter + styra synlighet
      mapGroup.selectAll(".place-group")
        .attr("transform", d => `translate(${d.cx},${d.cy}) scale(${1/currentK})`)
        .style("opacity", d => isPlaceVisible(d, currentK) ? 1 : 0);

      if (onZoomUpdate) onZoomUpdate(event.transform);
    });

  svg.call(zoom);

  // Sätt initial zoom
  if (zoomedTransform) {
    svg.call(zoom.transform, zoomedTransform);
    currentK = zoomedTransform.k;
  }

  // ============================================================================
  // CONNECTOR-LABELS — vänsterplacering för stora kustnära highlighted orter
  // ============================================================================
  if (zoomedTransform && resolvedPlaces.some(p => p.isHl)) {
    const k0 = zoomedTransform.k;
    const ty0 = zoomedTransform.y;

    // Namngivna kusttätorter får vänster-connector
    const connectorNames = ["Halmstad", "Varberg", "Kungsbacka", "Kungsbacka (GBG)", "Falkenberg"];
    const coastalBig = resolvedPlaces
      .filter(p => connectorNames.includes(p.name))
      .map(p => ({ ...p, _sy: p.cy * k0 + ty0, _ref: p }))
      .sort((a, b) => a._sy - b._sy);

    const minGap = 24;
    let prevY = -Infinity;
    for (const item of coastalBig) {
      let y = item._sy;
      if (y - prevY < minGap) y = prevY + minGap;
      item._ref._labelDir = -1;
      item._ref._labelDy = y - item._sy;
      prevY = y;
    }
  }

  // ============================================================================
  // MINIKARTA (locator inset) - uppe till höger
  // ============================================================================
  if (zoomedTransform) {
    const miniW = 44;
    const miniSource = colorBy && geodata.objects.kommuner ? "kommuner" : layer;
    const fullCollection = topojson.feature(geodata, geodata.objects[miniSource]);
    const [[bx0, by0], [bx1, by1]] = path.bounds(fullCollection);
    const aspect = (by1 - by0) / (bx1 - bx0);
    const miniH = Math.round(miniW * aspect);

    const miniX = autoWidth - miniW - 14;
    const miniY = 10;

    const miniGroup = svg.append("g")
      .attr("class", "minimap")
      .attr("transform", `translate(${miniX},${miniY})`)
      .style("cursor", "pointer")
      .style("opacity", 1);

    // Bakgrund med ram
    miniGroup.append("rect")
      .attr("x", -3).attr("y", -3)
      .attr("width", miniW + 6)
      .attr("height", miniH + 6)
      .attr("fill", "#fff")
      .attr("stroke", "#ccc")
      .attr("stroke-width", 1);

    // Mini-projektion
    const miniProjection = d3.geoIdentity()
      .reflectY(true)
      .fitSize([miniW, miniH], fullCollection);
    const miniPath = d3.geoPath(miniProjection);

    // Rita alla kommuner (ljus fyllning)
    const miniFeatures = fullCollection.features;
    miniGroup.selectAll(".mini-feature")
      .data(miniFeatures)
      .join("path")
      .attr("d", miniPath)
      .attr("fill", d => {
        if (colorBy) {
          const lnKod = d.properties.KnKod ? d.properties.KnKod.slice(0, 2) : null;
          const regionName = lnKod ? lnNameMap.get(lnKod) : null;
          return regionName && highlight && highlight.includes(regionName) ? highlightColor : "#e8e8e8";
        }
        if (zoomFeatures && zoomFeatures.includes(d)) return highlightColor;
        return "#e8e8e8";
      })
      .attr("stroke", "none");

    // Kontur
    miniGroup.append("path")
      .datum(outerMesh)
      .attr("d", miniPath)
      .attr("fill", "none")
      .attr("stroke", "#999")
      .attr("stroke-width", 0.5);

    // Viewport-rektangel
    const miniViewport = miniGroup.append("rect")
      .attr("class", "mini-viewport")
      .attr("fill", "rgba(230, 57, 70, 0.08)")
      .attr("stroke", "#E63946")
      .attr("stroke-width", 1.5)
      .attr("rx", 1);

    function updateMiniViewport(transform) {
      const { k, x: tx, y: ty } = transform;

      // Synlig region i main projected coords
      const visX0 = -tx / k;
      const visY0 = -ty / k;
      const visW = autoWidth / k;
      const visH = mapHeight / k;

      // Mappa till minikartan
      const scaleX = miniW / (bx1 - bx0);
      const scaleY = miniH / (by1 - by0);

      let rx = (visX0 - bx0) * scaleX;
      let ry = (visY0 - by0) * scaleY;
      let rw = visW * scaleX;
      let rh = visH * scaleY;

      // Clampa till minikartan
      if (rx < 0) { rw += rx; rx = 0; }
      if (ry < 0) { rh += ry; ry = 0; }
      rw = Math.min(rw, miniW - rx);
      rh = Math.min(rh, miniH - ry);

      miniViewport
        .attr("x", rx).attr("y", ry)
        .attr("width", Math.max(0, rw))
        .attr("height", Math.max(0, rh));

      // Fade ut minikartan vid full vy
      const isFullView = k <= 1.05;
      miniGroup.transition().duration(200)
        .style("opacity", isFullView ? 0 : 1)
        .style("pointer-events", isFullView ? "none" : "auto");
    }

    // Klick på minikartan togglar zoom
    miniGroup.on("click", function(event) {
      event.stopPropagation();
      if (isZoomedIn) {
        svg.transition().duration(750).call(zoom.transform, identityTransform);
        isZoomedIn = false;
      } else {
        svg.transition().duration(750).call(zoom.transform, zoomedTransform);
        isZoomedIn = true;
      }
    });

    // Koppla till zoom-eventet
    onZoomUpdate = updateMiniViewport;
    updateMiniViewport(zoomedTransform);
  }

  // ============================================================================
  // VÄGSTYLING (casing-teknik, differentierad per vägklass)
  // ============================================================================
  function getRoadStyle(d) {
    const klass = d.properties?.Fpv_klass || "";
    if (klass.includes("Nationella"))
      return { width: 1.8, color: "#c2560a", opacity: 0.55, label: "Nationella vägar" };
    if (klass.includes("Regionalt viktiga"))
      return { width: 1.1, color: "#c2560a", opacity: 0.35, label: "Regionala vägar" };
    return { width: 0.7, color: "#c2560a", opacity: 0.2, label: "Kompletterande vägar" };
  }

  // ============================================================================
  // FROZEN STATE — klick-highlight för tätorter
  // ============================================================================
  let frozenPlace = null;

  function applyPlaceStyle(el, p, active, cfg) {
    const baseSize = cfg.size + (p._labelDir === -1 ? 1 : 0);
    const hoverSize = baseSize + 2.5;
    el.select("circle")
      .attr("fill", active
        ? (p.isHl ? "rgba(0, 80, 60, 0.7)" : "rgba(26, 26, 26, 0.55)")
        : (p.isHl ? "rgba(0, 80, 60, 0.45)" : "rgba(26, 26, 26, 0.3)"))
      .attr("stroke", active ? "#1a1a1a" : "#fff")
      .attr("stroke-width", active ? 1.5 : (p.radius >= 6 ? 1.2 : 0.8));
    el.selectAll("text")
      .attr("font-size", `${active ? hoverSize : baseSize}px`)
      .attr("font-weight", active ? 700 : cfg.weight);
    el.select(".place-connector")
      .attr("stroke", active ? "#00664D" : "#9a958e")
      .attr("stroke-opacity", active ? 0.7 : 0.5);
  }

  function clearFrozen() {
    if (!frozenPlace) return;
    const prev = frozenPlace;
    frozenPlace = null;
    mapGroup.selectAll(".place-group")
      .filter(d => d === prev)
      .each(function(d) {
        const labelCfg = { 1: { size: 13, weight: 700 }, 2: { size: 11, weight: 600 }, 3: { size: 9, weight: 500 }, 4: { size: 7.5, weight: 400 } };
        applyPlaceStyle(d3.select(this), d, false, labelCfg[d.tier] || labelCfg[4]);
      });
    valueDisplay.html("<span style='opacity:0.35'>Peka p\u00e5 kartan</span>");
  }

  // ============================================================================
  // BUBBLE INTERACTIVE — helpers (hoisted, gated on precomputed)
  // ============================================================================
  function computeAllBubbleData() {
    const sampleBounds = path.bounds(features[0]);
    const cellSize = Math.max(
      sampleBounds[1][0] - sampleBounds[0][0],
      sampleBounds[1][1] - sampleBounds[0][1]
    );

    // 1 km level: individual cells with pop > 0
    const cells = features
      .filter(f => (f.properties[bubbles] || 0) > 0)
      .map(f => {
        const c = path.centroid(f);
        return { cx: c[0], cy: c[1], value: f.properties[bubbles], kn: f.properties.kn };
      })
      .filter(d => !isNaN(d.cx))
      .sort((a, b) => a.value - b.value);

    // 5 km level: group cells into 5×5 blocks via projected coords
    const blockSize = cellSize * 5;
    const blockMap = new Map();
    for (const cell of cells) {
      const bx = Math.floor(cell.cx / blockSize);
      const by = Math.floor(cell.cy / blockSize);
      const key = `${bx},${by}`;
      if (!blockMap.has(key)) blockMap.set(key, []);
      blockMap.get(key).push(cell);
    }
    const blocks = [...blockMap.values()].map(group => {
      const totalPop = d3.sum(group, d => d.value);
      const cx = d3.sum(group, d => d.cx * d.value) / totalPop;
      const cy = d3.sum(group, d => d.cy * d.value) / totalPop;
      return { cx, cy, value: totalPop, count: group.length };
    }).sort((a, b) => a.value - b.value);

    // Kommun level: group by kn, centroid from kommun polygons
    const kommunMap = new Map();
    for (const cell of cells) {
      if (!cell.kn) continue;
      if (!kommunMap.has(cell.kn)) kommunMap.set(cell.kn, []);
      kommunMap.get(cell.kn).push(cell);
    }
    const kommunerFeatures = geodata.objects.kommuner
      ? topojson.feature(geodata, geodata.objects.kommuner).features : [];
    const kommunCentroids = new Map();
    for (const f of kommunerFeatures) {
      const c = path.centroid(f);
      kommunCentroids.set(f.properties.KnKod, { cx: c[0], cy: c[1], name: f.properties.KnNamn });
    }
    const kommuns = [...kommunMap.entries()].map(([kn, group]) => {
      const totalPop = d3.sum(group, d => d.value);
      const centroid = kommunCentroids.get(kn);
      const cx = centroid ? centroid.cx : d3.sum(group, d => d.cx * d.value) / totalPop;
      const cy = centroid ? centroid.cy : d3.sum(group, d => d.cy * d.value) / totalPop;
      return { cx, cy, value: totalPop, count: group.length, name: centroid ? centroid.name : kn };
    }).sort((a, b) => a.value - b.value);

    const totalPop = d3.sum(cells, d => d.value);
    return { "1km": cells, "5km": blocks, "kommun": kommuns, cellSize, blockSize, allCells: cells, totalPop };
  }

  function buildBubbleStat() {
    if (!precomputed) return;

    // Build mini histogram
    const histContainer = d3.select(container.node()).select(".graf-bubble-hist");
    if (!histContainer.empty()) {
      histContainer.selectAll("*").remove();
      const cells = precomputed.allCells;
      const maxPop = d3.max(cells, d => d.value) || 1;
      const histW = 240, histH = 36;

      // Log-spaced bin edges
      const numBins = 24;
      const logMax = Math.log10(maxPop);
      const edges = d3.range(numBins + 1).map(i =>
        i === 0 ? 0.5 : Math.pow(10, (i / numBins) * logMax)
      );
      histBinsData = d3.bin()
        .value(d => d.value)
        .domain([0.5, maxPop])
        .thresholds(edges.slice(1, -1))(cells);

      histXScale = d3.scaleLog().domain([0.5, maxPop]).range([0, histW]).clamp(true);
      const yMax = d3.max(histBinsData, b => b.length) || 1;
      const yScale = d3.scaleLinear().domain([0, yMax]).range([histH, 0]);

      const bc = `${bubbleColor}`;
      histSvgEl = histContainer.append("svg")
        .attr("width", histW).attr("height", histH)
        .style("display", "block");

      histSvgEl.selectAll(".hist-bar")
        .data(histBinsData)
        .join("rect")
        .attr("class", "hist-bar")
        .attr("x", d => histXScale(d.x0))
        .attr("width", d => Math.max(1, histXScale(d.x1) - histXScale(d.x0) - 0.5))
        .attr("y", d => yScale(d.length))
        .attr("height", d => histH - yScale(d.length))
        .attr("fill", `rgba(${bc}, 0.6)`)
        .attr("rx", 0.5);

      // Threshold line
      histSvgEl.append("line").attr("class", "hist-thresh")
        .attr("y1", 0).attr("y2", histH)
        .attr("stroke", "#2c2826").attr("stroke-width", 1.5)
        .attr("stroke-dasharray", "3,2").style("opacity", 0);

      // Axis label
      histSvgEl.append("text")
        .attr("x", histW).attr("y", histH - 1)
        .attr("text-anchor", "end")
        .attr("font-family", "'IBM Plex Sans', sans-serif")
        .attr("font-size", "8px").attr("fill", "#bbb")
        .text("inv/km\u00b2 \u2192");
    }

    updateBubbleStat();
  }

  function updateBubbleStat() {
    if (!precomputed) return;
    const cells = precomputed.allCells;
    const total = cells.length;
    const totalPop = precomputed.totalPop;
    const visible = cells.filter(d => d.value >= popThreshold);
    const visCount = visible.length;
    const visPop = d3.sum(visible, d => d.value);
    const cellPct = total > 0 ? Math.round(visCount / total * 100) : 0;
    const popPct = totalPop > 0 ? Math.round(visPop / totalPop * 100) : 0;

    if (statBarCellsEl) {
      statBarCellsEl.style("width", `${cellPct}%`);
      statTextCellsEl.text(
        `${visCount.toLocaleString("sv-SE")} av ${total.toLocaleString("sv-SE")} rutor (${cellPct}%)`
      );
      statBarPopEl.style("width", `${popPct}%`);
      statTextPopEl.text(
        `${popPct}% av befolkningen (${visPop.toLocaleString("sv-SE")} inv.)`
      );
    }

    // Update histogram colors + threshold line
    if (histSvgEl && histBinsData) {
      const bc = `${bubbleColor}`;
      histSvgEl.selectAll(".hist-bar")
        .attr("fill", d => d.x0 >= popThreshold ? `rgba(${bc}, 0.6)` : "#e0ddd8");
      const lineX = popThreshold > 0 ? histXScale(Math.max(1, popThreshold)) : 0;
      histSvgEl.select(".hist-thresh")
        .attr("x1", lineX).attr("x2", lineX)
        .style("opacity", popThreshold > 0 ? 1 : 0);
    }
  }

  function renderBubbles() {
    if (!bubbleLayer || !precomputed) return;

    const levelData = precomputed[resolvedLevel];
    const { cellSize, blockSize } = precomputed;
    const bc = `${bubbleColor}`;

    // Filter by threshold (never filter kommun level)
    const filtered = resolvedLevel === "kommun"
      ? levelData
      : levelData.filter(d => d.value >= popThreshold);

    // Generous radius range — overlap is fine, proximity hover handles it
    let maxR, minR;
    if (resolvedLevel === "1km") {
      maxR = cellSize * 1.4;
      minR = cellSize * 0.04;
    } else if (resolvedLevel === "5km") {
      maxR = blockSize * 0.7;
      minR = cellSize * 0.2;
    } else {
      maxR = cellSize * 6;
      minR = cellSize * 1.5;
    }

    const maxVal = d3.max(levelData, d => d.value) || 1;
    const radiusScale = d3.scaleSqrt().domain([0, maxVal]).range([0, maxR]);
    const opacityScale = d3.scaleLinear().domain([0, maxVal]).range([0.30, 0.85]);

    const strokeW = resolvedLevel === "5km" ? cellSize * 0.03 : cellSize * 0.015;

    // Store computed radius on each datum for proximity hover
    for (const d of filtered) {
      d._r = Math.max(minR, radiusScale(d.value));
    }
    // Expose to hover system
    renderedBubbles = filtered;
    bubbleOpScale = opacityScale;
    bubbleStrokeW = strokeW;

    // Join circles — pointer-events disabled, hover handled by proximity system
    bubbleLayer.selectAll(".bubble")
      .data(filtered, d => `${resolvedLevel}-${d.cx.toFixed(0)},${d.cy.toFixed(0)}`)
      .join(
        enter => enter.append("circle")
          .attr("class", "bubble")
          .attr("cx", d => d.cx).attr("cy", d => d.cy)
          .attr("r", 0)
          .attr("fill", `rgb(${bc})`).attr("stroke", `rgb(${bc})`)
          .attr("fill-opacity", 0).attr("stroke-opacity", 0)
          .style("pointer-events", "none")
          .call(e => e.transition().duration(300)
            .attr("r", d => d._r)
            .attr("fill-opacity", d => opacityScale(d.value))
            .attr("stroke-width", strokeW)
            .attr("stroke-opacity", d => opacityScale(d.value) * 0.4)),
        update => update
          .style("pointer-events", "none")
          .call(u => u.transition().duration(300)
            .attr("cx", d => d.cx).attr("cy", d => d.cy)
            .attr("r", d => d._r)
            .attr("fill-opacity", d => opacityScale(d.value))
            .attr("stroke-width", strokeW)
            .attr("stroke-opacity", d => opacityScale(d.value) * 0.4)),
        exit => exit.transition().duration(300)
          .attr("r", 0).attr("fill-opacity", 0).remove()
      );

    // Kommun labels (only at kommun level)
    bubbleLayer.selectAll(".bubble-label").remove();
    if (resolvedLevel === "kommun") {
      for (const d of filtered) {
        if (!d.name) continue;
        bubbleLayer.append("text")
          .attr("class", "bubble-label")
          .attr("x", d.cx).attr("y", d.cy)
          .attr("dy", "0.35em").attr("text-anchor", "middle")
          .attr("font-family", "'IBM Plex Sans', system-ui, sans-serif")
          .attr("font-size", `${Math.min(d._r * 0.35, 14)}px`)
          .attr("font-weight", 600).attr("fill", "#fff")
          .attr("stroke", `rgb(${bc})`).attr("stroke-width", 2.5)
          .attr("paint-order", "stroke").style("pointer-events", "none")
          .text(d.name);
      }
    }
  }

  function updateBubbleLegend() {
    if (!bubbleLegendGroup || !precomputed) return;
    bubbleLegendGroup.selectAll("*").remove();

    const { cellSize, blockSize } = precomputed;
    const levelData = precomputed[resolvedLevel];
    const bc = `${bubbleColor}`;

    let maxR, unitLabel, refs;
    if (resolvedLevel === "1km") {
      maxR = cellSize * 1.4;
      unitLabel = "INV/KM\u00b2";
      refs = [10, 100, 1000].filter(v => v <= d3.max(levelData, d => d.value));
    } else if (resolvedLevel === "5km") {
      maxR = blockSize * 0.7;
      unitLabel = "INV/25 KM\u00b2";
      refs = [100, 1000, 5000].filter(v => v <= d3.max(levelData, d => d.value));
    } else {
      maxR = cellSize * 6;
      unitLabel = "INV\u00c5NARE";
      refs = [10000, 50000, 100000].filter(v => v <= d3.max(levelData, d => d.value));
    }
    if (refs.length === 0) refs = [d3.max(levelData, d => d.value)];

    const maxVal = d3.max(levelData, d => d.value) || 1;
    const rScale = d3.scaleSqrt().domain([0, maxVal]).range([0, maxR]);
    const maxRefR = rScale(refs[refs.length - 1]);
    const lgW = maxRefR * 2 + 80;
    const lgH = maxRefR * 2 + 36;
    const lgX = 14;
    const lgY = mapHeight - lgH - 10;

    bubbleLegendGroup.attr("transform", `translate(${lgX},${lgY})`);

    bubbleLegendGroup.append("rect")
      .attr("x", -8).attr("y", -8)
      .attr("width", lgW + 16).attr("height", lgH + 16)
      .attr("rx", 4)
      .attr("fill", "rgba(255,255,255,0.92)")
      .attr("stroke", "#e0ddd8")
      .attr("stroke-width", 0.5);

    bubbleLegendGroup.append("text")
      .attr("x", 0).attr("y", 6)
      .attr("font-family", "'IBM Plex Sans', sans-serif")
      .attr("font-size", "8.5px").attr("font-weight", 600)
      .attr("fill", "#999").attr("letter-spacing", "0.08em")
      .text(unitLabel);

    const circleX = maxRefR + 2;
    const circleBaseY = lgH - 4;
    for (const val of refs) {
      const r = rScale(val);
      bubbleLegendGroup.append("circle")
        .attr("cx", circleX).attr("cy", circleBaseY - r).attr("r", r)
        .attr("fill", "none")
        .attr("stroke", `rgb(${bc})`)
        .attr("stroke-width", 0.8).attr("stroke-opacity", 0.6);
      bubbleLegendGroup.append("line")
        .attr("x1", circleX + r + 2).attr("y1", circleBaseY - r * 2)
        .attr("x2", circleX + maxRefR + 8).attr("y2", circleBaseY - r * 2)
        .attr("stroke", "#bbb").attr("stroke-width", 0.5).attr("stroke-dasharray", "2,2");
      bubbleLegendGroup.append("text")
        .attr("x", circleX + maxRefR + 12).attr("y", circleBaseY - r * 2)
        .attr("dy", "0.35em")
        .attr("font-family", "'IBM Plex Sans', sans-serif")
        .attr("font-size", "9px").attr("fill", "#666")
        .text(val.toLocaleString("sv-SE"));
    }
  }

  // ============================================================================
  // RITA KARTAN
  // ============================================================================
  function updateChart() {
    mapGroup.selectAll("*").remove();

    // 1. Bakgrund (vatten / omgivning) — klick rensar frozen
    mapGroup.append("rect")
      .attr("class", "map-background")
      .attr("x", -margin.left).attr("y", -margin.top)
      .attr("width", autoWidth).attr("height", mapHeight)
      .attr("fill", "#eef1f6")
      .style("cursor", "default")
      .on("click", () => clearFrozen());

    // 2. Feature-polygoner ELLER bubblor
    if (bubbles) {
      // --- BUBBLE MODE ---
      // 2a. Rita kommun-polygoner som bas (ljus fyllning, landmassa)
      if (geodata.objects.kommuner) {
        const kommunFeatures = topojson.feature(geodata, geodata.objects.kommuner).features;
        mapGroup.selectAll(".base-kommun")
          .data(kommunFeatures)
          .join("path")
          .attr("class", "base-kommun")
          .attr("d", path)
          .attr("fill", "#f8f6f3")
          .attr("stroke", "none");
      }

      if (bubbleInteractive) {
        // Interactive mode: create bubble layer, delegate to renderBubbles
        bubbleLayer = mapGroup.append("g").attr("class", "bubble-layer");
        renderBubbles();
      } else {
        // Static mode: inline rendering
        const bFeats = bubbleFeatures;
        let maxR, strokeW;

        if (bubbleSource) {
          // Non-grid features: size relative to map extent
          const allBounds = path.bounds({type: "FeatureCollection", features: bFeats});
          const mapSpan = Math.min(
            allBounds[1][0] - allBounds[0][0],
            allBounds[1][1] - allBounds[0][1]
          );
          maxR = mapSpan * 0.055;
          strokeW = 1;
        } else {
          // Grid features: size relative to cell size
          const sampleBounds = path.bounds(bFeats[0]);
          const cellSize = Math.max(
            sampleBounds[1][0] - sampleBounds[0][0],
            sampleBounds[1][1] - sampleBounds[0][1]
          );
          maxR = cellSize * 0.45;
          strokeW = cellSize * 0.015;
        }

        const maxVal = d3.max(bFeats, f => f.properties[bubbles] || 0);
        const radiusScale = d3.scaleSqrt().domain([0, maxVal]).range([0, maxR]);
        const opacityScale = d3.scaleLinear().domain([0, maxVal]).range([0.25, 0.85]);
        const minR = bubbleSource ? 2 : maxR * 0.09;

        const bubbleData = bFeats
          .filter(f => (f.properties[bubbles] || 0) > 0)
          .map(f => {
            const c = path.centroid(f);
            return { cx: c[0], cy: c[1], value: f.properties[bubbles], feature: f };
          })
          .filter(d => !isNaN(d.cx))
          .sort((a, b) => a.value - b.value);

        const bc = `${bubbleColor}`;
        mapGroup.selectAll(".bubble")
          .data(bubbleData)
          .join("circle")
          .attr("class", "bubble")
          .attr("cx", d => d.cx).attr("cy", d => d.cy)
          .attr("r", d => Math.max(minR, radiusScale(d.value)))
          .attr("fill", `rgb(${bc})`)
          .attr("fill-opacity", d => opacityScale(d.value))
          .attr("stroke", `rgb(${bc})`)
          .attr("stroke-width", strokeW)
          .attr("stroke-opacity", d => opacityScale(d.value) * 0.4)
          .style("cursor", "pointer")
          .on("mouseenter", function(event, d) {
            d3.select(this)
              .attr("fill-opacity", Math.min(opacityScale(d.value) + 0.25, 1))
              .attr("stroke-opacity", 0.9)
              .attr("stroke-width", strokeW * 2.5);
            const name = d.feature ? (d.feature.properties[label] || "") : "";
            const formatted = formatValue(d.value, d.feature);
            valueDisplay.html(
              name
                ? `<b>${name}</b> <span style="opacity:0.35;margin:0 4px">\u2502</span> ${formatted}`
                : `<b>${formatted}</b>`
            );
          })
          .on("mouseleave", function(event, d) {
            d3.select(this)
              .attr("fill-opacity", opacityScale(d.value))
              .attr("stroke-opacity", opacityScale(d.value) * 0.4)
              .attr("stroke-width", strokeW);
            valueDisplay.html("<span style='opacity:0.35'>Peka p\u00e5 kartan</span>");
          });

        // Labels for largest bubbles
        if (bubbleLabels) {
          const sortedDesc = [...bubbleData].sort((a, b) => b.value - a.value);
          const labelData = sortedDesc.slice(0, Math.min(8, Math.ceil(bubbleData.length * 0.1)));
          mapGroup.selectAll(".bubble-label")
            .data(labelData)
            .join("text")
            .attr("class", "bubble-label")
            .attr("x", d => d.cx)
            .attr("y", d => d.cy - Math.max(minR, radiusScale(d.value)) - 3)
            .attr("text-anchor", "middle")
            .attr("font-family", "'IBM Plex Sans', system-ui, sans-serif")
            .attr("font-size", "9px")
            .attr("font-weight", 600)
            .attr("fill", "#2c2826")
            .attr("stroke", "rgba(255,255,255,0.88)")
            .attr("stroke-width", 3)
            .attr("stroke-linejoin", "round")
            .attr("paint-order", "stroke")
            .style("pointer-events", "none")
            .text(d => d.feature.properties[label] || "");
        }
      }

    } else {
      // --- NORMAL MODE ---
      mapGroup.selectAll(".kommun-path")
        .data(features)
        .join("path")
        .attr("class", "kommun-path")
        .attr("d", path)
        .attr("fill", d => getFill(d))
        .attr("opacity", d => getFeatureOpacity(d))
        .attr("stroke", colorBy ? "none" : "none")
        .style("cursor", colorBy ? "default" : "pointer")
        .on("mouseenter", function(event, d) {
          if (colorBy) {
            const regionName = lnNameMap.get(d.properties.ln) || d.properties.ln || "";
            const typ = d.properties[colorBy] || "";
            const color = colorByScale(typ);
            valueDisplay.html(
              `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0"></span><b>${regionName}</b><span style="opacity:0.35">│</span>${typ}</span>`
            );
            d3.select(this).attr("opacity", Math.min(getFeatureOpacity(d) + 0.15, 1));
          } else {
            highlightFeature(d, true);
          }
        })
        .on("mouseleave", function(event, d) {
          if (colorBy) {
            d3.select(this).attr("opacity", getFeatureOpacity(d));
            valueDisplay.html("<span style='opacity:0.35'>Peka på kartan</span>");
          } else {
            highlightFeature(d, false);
          }
        })
        .on("click", () => clearFrozen());
    }

    // 3. Tätortspolygoner (hoverable — namn, befolkning, kommun)
    if (urbanFeatures.length > 0) {
      mapGroup.selectAll(".urban-path")
        .data(urbanFeatures)
        .join("path")
        .attr("class", "urban-path")
        .attr("d", path)
        .attr("fill", "rgba(140, 120, 90, 0.18)")
        .attr("stroke", "none")
        .style("cursor", "pointer")
        .on("mouseenter", function(event, d) {
          d3.select(this).attr("fill", "rgba(140, 120, 90, 0.35)");
          const name = d.properties[urbanLabel] || "";
          const pop = d.properties[urbanPop] || 0;
          const kommun = d.properties.kommunnamn || "";
          const popStr = pop.toLocaleString("sv-SE");
          valueDisplay.html(
            `<b>${name}</b> <span style="opacity:0.35;margin:0 4px">│</span> ${popStr} inv.` +
            (kommun ? ` <span style="opacity:0.35;margin:0 4px">│</span> <span style="opacity:0.5">${kommun}</span>` : "")
          );
        })
        .on("mouseleave", function() {
          d3.select(this).attr("fill", "rgba(140, 120, 90, 0.18)");
          valueDisplay.html("<span style='opacity:0.35'>Peka på kartan</span>");
        });
    }

    // 3b. Overlay-lager (tätorter, togglebar)
    if (overlayFeatures.length > 0) {
      // Använd samma projektion som huvudkartan (samma CRS)
      const overlayPath = path;

      mapGroup.selectAll(".overlay-path")
        .data(overlayFeatures)
        .join("path")
        .attr("class", "overlay-path")
        .attr("d", overlayPath)
        .attr("fill", "rgba(255, 255, 255, 0.35)")
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.2)
        .attr("vector-effect", "non-scaling-stroke")
        .style("opacity", overlayOn ? 1 : 0)
        .attr("pointer-events", overlayOn ? "all" : "none")
        .style("cursor", "pointer")
        .on("mouseenter", function(event, d) {
          if (!overlayOn) return;
          d3.select(this)
            .attr("fill", "rgba(255, 255, 255, 0.55)")
            .attr("stroke", "#2c2826")
            .attr("stroke-width", 2);
          const name = d.properties[overlayLabel] || "";
          const pop = d.properties[overlayPop] || 0;
          const popStr = pop.toLocaleString("sv-SE");
          const kommun = d.properties.kommun || "";
          valueDisplay.html(
            `<b>${name}</b> <span style="opacity:0.35;margin:0 4px">│</span> ${popStr} inv.` +
            (kommun ? ` <span style="opacity:0.35;margin:0 4px">│</span> <span style="opacity:0.5">${kommun}</span>` : "")
          );
        })
        .on("mouseleave", function() {
          if (!overlayOn) return;
          d3.select(this)
            .attr("fill", "rgba(255, 255, 255, 0.35)")
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.2);
          valueDisplay.html("<span style='opacity:0.35'>Peka på kartan</span>");
        });
    }

    // 4. Kommun-gränser (tunnast, subtil)
    mapGroup.append("path")
      .datum(innerMesh)
      .attr("class", "kommun-boundary")
      .attr("d", path)
      .attr("fill", "none")
      .attr("stroke", "#c8c4be")
      .attr("stroke-width", 0.3)
      .attr("stroke-opacity", 0.5)
      .attr("vector-effect", "non-scaling-stroke")
      .style("pointer-events", "none");

    // 5. Vägnät — synliga linjer + breda osynliga hit-areas
    if (roadFeatures.length > 0) {
      // Synliga vägar (ingen pointer-events)
      mapGroup.selectAll(".road-path")
        .data(roadFeatures)
        .join("path")
        .attr("class", "road-path")
        .attr("d", path)
        .attr("fill", "none")
        .attr("stroke", d => getRoadStyle(d).color)
        .attr("stroke-width", d => getRoadStyle(d).width)
        .attr("stroke-opacity", d => getRoadStyle(d).opacity)
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("vector-effect", "non-scaling-stroke")
        .style("pointer-events", "none");

      // Osynliga hit-areas (breda, fångar muspekaren)
      mapGroup.selectAll(".road-hit")
        .data(roadFeatures)
        .join("path")
        .attr("class", "road-hit")
        .attr("d", path)
        .attr("fill", "none")
        .attr("stroke", "transparent")
        .attr("stroke-width", 14)
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("vector-effect", "non-scaling-stroke")
        .style("cursor", "pointer")
        .on("mouseenter", function(event, d) {
          mapGroup.selectAll(".road-path")
            .filter(r => r === d)
            .attr("stroke-opacity", 0.85)
            .attr("stroke-width", d => getRoadStyle(d).width + 2);
          const name = d.properties?.Vagnamn;
          const klassLabel = getRoadStyle(d).label;
          if (name) {
            valueDisplay.html(
              `<b>${name}</b> <span style="opacity:0.35;margin:0 4px">\u2502</span> <span style="opacity:0.5">${klassLabel}</span>`
            );
          } else {
            valueDisplay.html(`<b>${klassLabel}</b>`);
          }
        })
        .on("mouseleave", function(event, d) {
          mapGroup.selectAll(".road-path")
            .filter(r => r === d)
            .attr("stroke-opacity", d => getRoadStyle(d).opacity)
            .attr("stroke-width", d => getRoadStyle(d).width);
          valueDisplay.html("<span style='opacity:0.35'>Peka p\u00e5 kartan</span>");
        });
    }

    // 6. Järnväg — korssyll-teknik (räls + syllmarkeringar) + hit-areas
    if (railwayFeatures.length > 0) {
      // Lager 1: räls (tunn solid linje)
      mapGroup.selectAll(".railway-rail")
        .data(railwayFeatures)
        .join("path")
        .attr("class", "railway-rail")
        .attr("d", path)
        .attr("fill", "none")
        .attr("stroke", "#2c2826")
        .attr("stroke-width", 1.0)
        .attr("stroke-opacity", 0.4)
        .attr("vector-effect", "non-scaling-stroke")
        .style("pointer-events", "none");

      // Lager 2: syllmarkeringar (korta breda streck med mellanrum)
      mapGroup.selectAll(".railway-ties")
        .data(railwayFeatures)
        .join("path")
        .attr("class", "railway-ties")
        .attr("d", path)
        .attr("fill", "none")
        .attr("stroke", "#2c2826")
        .attr("stroke-width", 3.5)
        .attr("stroke-opacity", 0.25)
        .attr("stroke-dasharray", "1.5,7")
        .attr("vector-effect", "non-scaling-stroke")
        .style("pointer-events", "none");

      // Osynliga hit-areas
      mapGroup.selectAll(".railway-hit")
        .data(railwayFeatures)
        .join("path")
        .attr("class", "railway-hit")
        .attr("d", path)
        .attr("fill", "none")
        .attr("stroke", "transparent")
        .attr("stroke-width", 14)
        .attr("stroke-linecap", "round")
        .attr("vector-effect", "non-scaling-stroke")
        .style("cursor", "pointer")
        .on("mouseenter", function(event, d) {
          mapGroup.selectAll(".railway-rail")
            .filter(r => r === d)
            .attr("stroke-opacity", 0.7)
            .attr("stroke-width", 1.4);
          mapGroup.selectAll(".railway-ties")
            .filter(r => r === d)
            .attr("stroke-opacity", 0.5)
            .attr("stroke-width", 5);
          const name = d.properties?.Straknamn || "J\u00e4rnv\u00e4g";
          valueDisplay.html(
            `<b>${name}</b> <span style="opacity:0.35;margin:0 4px">\u2502</span> J\u00e4rnv\u00e4g`
          );
        })
        .on("mouseleave", function(event, d) {
          mapGroup.selectAll(".railway-rail")
            .filter(r => r === d)
            .attr("stroke-opacity", 0.4)
            .attr("stroke-width", 1.0);
          mapGroup.selectAll(".railway-ties")
            .filter(r => r === d)
            .attr("stroke-opacity", 0.25)
            .attr("stroke-width", 3.5);
          valueDisplay.html("<span style='opacity:0.35'>Peka p\u00e5 kartan</span>");
        });
    }

    // 7. Län-gränser (medium)
    if (boundaryMesh) {
      mapGroup.append("path")
        .datum(boundaryMesh)
        .attr("class", "lan-boundary")
        .attr("d", path)
        .attr("fill", "none")
        .attr("stroke", "#6b6560")
        .attr("stroke-width", 1.0)
        .attr("stroke-opacity", 0.6)
        .attr("stroke-linejoin", "round")
        .attr("vector-effect", "non-scaling-stroke")
        .style("pointer-events", "none");
    }

    // 8. Yttre gräns (stark, med skugga)
    mapGroup.append("path")
      .datum(outerMesh)
      .attr("class", "outer-boundary")
      .attr("d", path)
      .attr("fill", "none")
      .attr("stroke", "#2c2826")
      .attr("stroke-width", 1.8)
      .attr("stroke-opacity", 0.8)
      .attr("stroke-linejoin", "round")
      .attr("vector-effect", "non-scaling-stroke")
      .style("pointer-events", "none")
      .style("filter", `url(#map-shadow-${instId})`);

    // 9. Hover-overlay
    mapGroup.append("path")
      .attr("class", "hover-overlay")
      .attr("fill", "rgba(0, 0, 0, 0.04)")
      .attr("stroke", "#1a1a1a")
      .attr("stroke-width", 2.5)
      .attr("vector-effect", "non-scaling-stroke")
      .style("pointer-events", "none")
      .style("opacity", 0);

    // 10. Tätorter — cirklar + etiketter (connector-labels för highlighted)
    if (resolvedPlaces.length > 0) {
      const k = currentK;
      const placesLayer = mapGroup.append("g").attr("class", "places-layer");

      const labelCfg = {
        1: { size: 13, weight: 700, halo: 4 },
        2: { size: 11, weight: 600, halo: 3.5 },
        3: { size: 9,  weight: 500, halo: 3 },
        4: { size: 7.5, weight: 400, halo: 2.5 }
      };

      for (const p of resolvedPlaces) {
        const g = placesLayer.append("g")
          .attr("class", "place-group")
          .datum(p)
          .attr("transform", `translate(${p.cx},${p.cy}) scale(${1/k})`)
          .style("opacity", isPlaceVisible(p, k) ? 1 : 0);

        g.append("circle")
          .attr("r", p.radius)
          .attr("fill", p.isHl ? "rgba(0, 80, 60, 0.45)" : "rgba(26, 26, 26, 0.3)")
          .attr("stroke", "#fff")
          .attr("stroke-width", p.radius >= 6 ? 1.2 : 0.8)
          .style("cursor", "pointer");

        const cfg = labelCfg[p.tier] || labelCfg[4];

        // Connector-label för stora kusttätorter (vänsterplacerade)
        if (p._labelDir === -1) {
          const dy = p._labelDy || 0;
          const connLen = 35 + p.radius;
          const labelX = -connLen;

          // Connector-linje (tunn, subtil)
          g.append("line")
            .attr("class", "place-connector")
            .attr("x1", -(p.radius + 2))
            .attr("y1", 0)
            .attr("x2", labelX)
            .attr("y2", dy)
            .attr("stroke", "#9a958e")
            .attr("stroke-width", 0.8)
            .attr("stroke-opacity", 0.5);

          // Etikett vid connector-ände
          g.append("text")
            .attr("class", "place-connector-label")
            .attr("x", labelX - 4)
            .attr("y", dy)
            .attr("dy", "0.35em")
            .attr("text-anchor", "end")
            .attr("font-family", "'IBM Plex Sans', system-ui, sans-serif")
            .attr("font-size", `${cfg.size + 1}px`)
            .attr("font-weight", cfg.weight)
            .attr("fill", "#2c2826")
            .attr("stroke", "rgba(255,255,255,0.88)")
            .attr("stroke-width", cfg.halo + 0.5)
            .attr("stroke-linejoin", "round")
            .attr("paint-order", "stroke")
            .style("cursor", "pointer")
            .text(p.name);

        } else {
          // Enkel högerställd etikett (icke-highlighted)
          g.append("text")
            .attr("x", p.radius + 3)
            .attr("dy", "0.35em")
            .attr("font-family", "'IBM Plex Sans', system-ui, sans-serif")
            .attr("font-size", `${cfg.size}px`)
            .attr("font-weight", cfg.weight)
            .attr("fill", "#2c2826")
            .attr("stroke", "rgba(255,255,255,0.85)")
            .attr("stroke-width", cfg.halo)
            .attr("stroke-linejoin", "round")
            .attr("paint-order", "stroke")
            .style("pointer-events", "none")
            .text(p.name);
        }

        // Hover + klick-freeze
        function showPlaceInfo() {
          const pop = p.population.toLocaleString("sv-SE");
          valueDisplay.html(
            `<b>${p.name}</b> <span style="opacity:0.35;margin:0 4px">\u2502</span> ${pop} inv.`
          );
        }

        g.on("mouseenter", function() {
            applyPlaceStyle(d3.select(this), p, true, cfg);
            showPlaceInfo();
          })
          .on("mouseleave", function() {
            if (frozenPlace === p) return;
            applyPlaceStyle(d3.select(this), p, false, cfg);
            if (!frozenPlace) {
              valueDisplay.html("<span style='opacity:0.35'>Peka p\u00e5 kartan</span>");
            }
          })
          .on("click", function(event) {
            event.stopPropagation();
            if (frozenPlace === p) {
              clearFrozen();
            } else {
              clearFrozen();
              frozenPlace = p;
              applyPlaceStyle(d3.select(this), p, true, cfg);
              showPlaceInfo();
            }
          });
      }
    }

    // Uppdatera väljaren
    if (selectorCtrl) selectorCtrl.update();
  }

  // ============================================================================
  // HOVER-EFFEKT
  // ============================================================================
  function highlightFeature(f, show) {
    const name = f.properties[label];
    const län = kommunLänMap.get(name);
    const overlay = mapGroup.select(".hover-overlay");

    if (show) {
      overlay
        .datum(f)
        .attr("d", path)
        .style("opacity", 1);

      if (hasChoropleth) {
        const val = dataMap.get(String(f.properties[id]));
        const valText = val != null ? `<b>${formatValue(val)}</b>${unit ? " " + unit : ""}` : "<span style='opacity:0.5'>Uppgift saknas</span>";
        valueDisplay.html(`<span style="display:inline-flex;align-items:center;justify-content:center;width:100%"><b style="margin-right:6px">${name}</b><span style="opacity:0.2;margin-right:6px">│</span>${valText}</span>`);
      } else {
        const länText = län ? ` <span style="opacity:0.4;margin:0 4px">│</span> <span style="opacity:0.5">${län}</span>` : "";
        valueDisplay.html(`<b>${name}</b>${länText}`);
      }
    } else {
      overlay.style("opacity", 0);
      valueDisplay.html("<span style='opacity:0.35'>Peka på kartan</span>");
    }
  }

  // Initial rendering
  updateChart();

  // Initialize bubble interactive state after first render
  if (bubbles && bubbleInteractive) {
    precomputed = computeAllBubbleData();
    resolvedLevel = aggLevel;

    // Set slider max from actual data
    const dataMax = d3.max(precomputed.allCells, d => d.value) || 1500;
    const sliderInput = d3.select(container.node()).select(".graf-bubble-slider");
    if (!sliderInput.empty()) sliderInput.attr("max", dataMax);

    buildBubbleStat();
    updateBubbleStat();
    renderBubbles();

    // Proximity hover: find smallest bubble under cursor
    svg.on("mousemove.bubble", function(event) {
      if (!renderedBubbles || !bubbleLayer) return;
      const [mx, my] = d3.pointer(event, mapGroup.node());

      // Find all bubbles containing the point; prefer the smallest
      let best = null;
      for (const d of renderedBubbles) {
        const dx = mx - d.cx, dy = my - d.cy;
        const dist2 = dx * dx + dy * dy;
        const r = d._r;
        if (dist2 <= r * r) {
          if (!best || d._r < best._r) best = d;
        }
      }

      if (best === hoveredBubble) return;

      // Unhighlight previous
      if (hoveredBubble) {
        const prev = hoveredBubble;
        bubbleLayer.selectAll(".bubble")
          .filter(d => d === prev)
          .attr("fill-opacity", bubbleOpScale(prev.value))
          .attr("stroke-opacity", bubbleOpScale(prev.value) * 0.4)
          .attr("stroke-width", bubbleStrokeW);
      }

      hoveredBubble = best;

      if (best) {
        bubbleLayer.selectAll(".bubble")
          .filter(d => d === best)
          .attr("fill-opacity", Math.min(bubbleOpScale(best.value) + 0.25, 1))
          .attr("stroke-opacity", 0.9)
          .attr("stroke-width", bubbleStrokeW * 2.5);
        const pop = best.value.toLocaleString("sv-SE");
        const lbl = resolvedLevel === "5km"
          ? `<b>${pop}</b> inv/25 km\u00b2 <span style="opacity:0.35;margin:0 4px">\u2502</span> ${best.count} rutor`
          : `<b>${pop}</b> inv/km\u00b2`;
        valueDisplay.html(lbl);
      } else {
        valueDisplay.html("<span style='opacity:0.35'>Peka p\u00e5 kartan</span>");
      }
    });

    svg.on("mouseleave.bubble", function() {
      if (hoveredBubble) {
        const prev = hoveredBubble;
        hoveredBubble = null;
        bubbleLayer.selectAll(".bubble")
          .filter(d => d === prev)
          .attr("fill-opacity", bubbleOpScale(prev.value))
          .attr("stroke-opacity", bubbleOpScale(prev.value) * 0.4)
          .attr("stroke-width", bubbleStrokeW);
        valueDisplay.html("<span style='opacity:0.35'>Peka p\u00e5 kartan</span>");
      }
    });
  }

  // ============================================================================
  // KARTLEGEND (infrastruktur + tätorter)
  // ============================================================================
  if (roadFeatures.length > 0 || railwayFeatures.length > 0 || resolvedPlaces.length > 0) {
    const items = [];

    if (highlight) {
      items.push({ type: "swatch", label: "Halland", fill: fillColor });
      items.push({ type: "swatch", label: "Övriga kommuner", fill: mutedColor });
    }

    if (roadFeatures.length > 0) {
      items.push({ type: "heading", label: "Vägar" });
      items.push({ type: "road", label: "Nationella", klass: "Nationella" });
      items.push({ type: "road", label: "Regionala", klass: "Regionalt viktiga" });
      items.push({ type: "road", label: "Kompletterande", klass: "Kompletterande" });
    }

    if (railwayFeatures.length > 0) {
      items.push({ type: "railway", label: "Järnväg" });
    }

    if (resolvedPlaces.length > 0) {
      items.push({ type: "heading", label: "Tätorter" });
      items.push({ type: "circle", label: "> 50 000 inv.", r: 8 });
      items.push({ type: "circle", label: "10 000\u201350 000", r: 5 });
      items.push({ type: "circle", label: "2 000\u201310 000", r: 3 });
    }

    const lineH = 18;
    const totalH = items.length * lineH + 12;
    const lgX = 14;
    const lgY = mapHeight - totalH - 10;

    const lgGroup = svg.append("g")
      .attr("class", "map-legend")
      .attr("transform", `translate(${lgX},${lgY})`);

    lgGroup.append("rect")
      .attr("x", -8).attr("y", -8)
      .attr("width", 155).attr("height", totalH + 8)
      .attr("rx", 4)
      .attr("fill", "rgba(255,255,255,0.88)")
      .attr("stroke", "#e0ddd8")
      .attr("stroke-width", 0.5);

    items.forEach((item, i) => {
      const row = lgGroup.append("g")
        .attr("transform", `translate(0,${i * lineH})`);

      if (item.type === "boundary") {
        row.append("rect")
          .attr("x", 2).attr("y", 2)
          .attr("width", 22).attr("height", 12).attr("rx", 1)
          .attr("fill", fillColor)
          .attr("stroke", "#1a1a1a").attr("stroke-width", 2.5);
        row.append("text")
          .attr("x", 32).attr("dy", "0.9em")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .attr("font-size", "10px").attr("font-weight", 600).attr("fill", "#333")
          .text(item.label);
      } else if (item.type === "heading") {
        row.append("text")
          .attr("x", 0).attr("dy", "0.9em")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .attr("font-size", "8.5px")
          .attr("font-weight", 600)
          .attr("fill", "#999")
          .attr("letter-spacing", "0.08em")
          .text(item.label.toUpperCase());
      } else if (item.type === "road") {
        const s = getRoadStyle({ properties: { Fpv_klass: item.klass } });
        row.append("line")
          .attr("x1", 2).attr("x2", 24).attr("y1", 8).attr("y2", 8)
          .attr("stroke", s.color).attr("stroke-width", s.width)
          .attr("stroke-opacity", s.opacity).attr("stroke-linecap", "round");
        row.append("text")
          .attr("x", 32).attr("dy", "0.9em")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .attr("font-size", "10px").attr("fill", "#555")
          .text(item.label);
      } else if (item.type === "railway") {
        row.append("line")
          .attr("x1", 2).attr("x2", 24).attr("y1", 8).attr("y2", 8)
          .attr("stroke", "#2c2826").attr("stroke-width", 1.0)
          .attr("stroke-opacity", 0.4);
        row.append("line")
          .attr("x1", 2).attr("x2", 24).attr("y1", 8).attr("y2", 8)
          .attr("stroke", "#2c2826").attr("stroke-width", 3.5)
          .attr("stroke-opacity", 0.25).attr("stroke-dasharray", "1.5,7");
        row.append("text")
          .attr("x", 32).attr("dy", "0.9em")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .attr("font-size", "10px").attr("fill", "#555")
          .text(item.label);
      } else if (item.type === "circle") {
        row.append("circle")
          .attr("cx", 13).attr("cy", 8).attr("r", item.r)
          .attr("fill", "rgba(26,26,26,0.3)")
          .attr("stroke", "#fff").attr("stroke-width", 0.8);
        row.append("text")
          .attr("x", 32).attr("dy", "0.9em")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .attr("font-size", "10px").attr("fill", "#555")
          .text(item.label);
      } else if (item.type === "swatch") {
        row.append("rect")
          .attr("x", 2).attr("y", 2)
          .attr("width", 22).attr("height", 12).attr("rx", 2)
          .attr("fill", item.fill)
          .attr("stroke", "#c8c4be").attr("stroke-width", 0.5);
        row.append("text")
          .attr("x", 32).attr("dy", "0.9em")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .attr("font-size", "10px").attr("fill", "#555")
          .text(item.label);
      }
    });
  }

  // ============================================================================
  // FÄRGLEGEND (kategorisk / colorBy)
  // ============================================================================
  if (colorBy && colorByScale) {
    const cats = colorByScale.domain();
    const lineH = 18;
    const totalH = cats.length * lineH + 12;
    const lgX = 14;
    const lgY = mapHeight - totalH - 10;

    const lgGroup = svg.append("g")
      .attr("class", "map-legend colorby-legend")
      .attr("transform", `translate(${lgX},${lgY})`);

    lgGroup.append("rect")
      .attr("x", -8).attr("y", -8)
      .attr("width", 200).attr("height", totalH + 8)
      .attr("rx", 4)
      .attr("fill", "rgba(255,255,255,0.92)")
      .attr("stroke", "#e0ddd8")
      .attr("stroke-width", 0.5);

    cats.forEach((cat, i) => {
      const row = lgGroup.append("g")
        .attr("transform", `translate(0,${i * lineH})`);
      row.append("rect")
        .attr("x", 2).attr("y", 2)
        .attr("width", 16).attr("height", 12).attr("rx", 2)
        .attr("fill", colorByScale(cat));
      row.append("text")
        .attr("x", 24).attr("dy", "0.9em")
        .attr("font-family", "'IBM Plex Sans', sans-serif")
        .attr("font-size", "10px").attr("fill", "#444")
        .text(cat);
    });
  }

  // ============================================================================
  // STORLEKSLEGEND (bubblor)
  // ============================================================================
  if (bubbles) {
    if (bubbleInteractive) {
      // Dynamic legend — updated by updateBubbleLegend()
      bubbleLegendGroup = svg.append("g").attr("class", "bubble-legend");
      updateBubbleLegend();
    } else {
      // Static legend
      const bFeats = bubbleFeatures;
      let maxRLg;
      if (bubbleSource) {
        const allBounds = path.bounds({type: "FeatureCollection", features: bFeats});
        const mapSpan = Math.min(
          allBounds[1][0] - allBounds[0][0],
          allBounds[1][1] - allBounds[0][1]
        );
        maxRLg = mapSpan * 0.055;
      } else {
        const sampleBounds = path.bounds(bFeats[0]);
        const cellSizeLg = Math.max(
          sampleBounds[1][0] - sampleBounds[0][0],
          sampleBounds[1][1] - sampleBounds[0][1]
        );
        maxRLg = cellSizeLg * 0.45;
      }
      const maxValLg = d3.max(bFeats, f => f.properties[bubbles] || 0);
      const rScaleLg = d3.scaleSqrt().domain([0, maxValLg]).range([0, maxRLg]);

      // Pick reference values from data range
      const magnitude = Math.pow(10, Math.floor(Math.log10(maxValLg)));
      const defaultRefs = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
        .map(v => v * (magnitude >= 1000 ? 1 : 1))
        .filter(v => v > 0 && v <= maxValLg);
      const refs = defaultRefs.length > 3
        ? [defaultRefs[0], defaultRefs[Math.floor(defaultRefs.length / 2)], defaultRefs[defaultRefs.length - 1]]
        : defaultRefs.length > 0 ? defaultRefs : [Math.round(maxValLg)];

      const maxRefR = rScaleLg(refs[refs.length - 1]);
      const lgW = maxRefR * 2 + 70;
      const lgH = maxRefR * 2 + 36;
      const lgX = 14;
      const lgY = mapHeight - lgH - 10;

      const lgGroup = svg.append("g")
        .attr("class", "bubble-legend")
        .attr("transform", `translate(${lgX},${lgY})`);

      lgGroup.append("rect")
        .attr("x", -8).attr("y", -8)
        .attr("width", lgW + 16).attr("height", lgH + 16)
        .attr("rx", 4)
        .attr("fill", "rgba(255,255,255,0.92)")
        .attr("stroke", "#e0ddd8")
        .attr("stroke-width", 0.5);

      const legendTitle = unit ? unit.toUpperCase() : "ANTAL";
      lgGroup.append("text")
        .attr("x", 0).attr("y", 6)
        .attr("font-family", "'IBM Plex Sans', sans-serif")
        .attr("font-size", "8.5px").attr("font-weight", 600)
        .attr("fill", "#999").attr("letter-spacing", "0.08em")
        .text(legendTitle);

      const circleX = maxRefR + 2;
      const circleBaseY = lgH - 4;
      for (const val of refs) {
        const r = rScaleLg(val);
        lgGroup.append("circle")
          .attr("cx", circleX).attr("cy", circleBaseY - r).attr("r", r)
          .attr("fill", "none")
          .attr("stroke", `rgb(${bubbleColor})`)
          .attr("stroke-width", 0.8).attr("stroke-opacity", 0.6);
        lgGroup.append("line")
          .attr("x1", circleX + r + 2).attr("y1", circleBaseY - r * 2)
          .attr("x2", circleX + maxRefR + 8).attr("y2", circleBaseY - r * 2)
          .attr("stroke", "#bbb").attr("stroke-width", 0.5).attr("stroke-dasharray", "2,2");
        lgGroup.append("text")
          .attr("x", circleX + maxRefR + 12).attr("y", circleBaseY - r * 2)
          .attr("dy", "0.35em")
          .attr("font-family", "'IBM Plex Sans', sans-serif")
          .attr("font-size", "9px").attr("fill", "#666")
          .text(val.toLocaleString("sv-SE"));
      }
    }
  }

  // ============================================================================
  // FÄRGLEGEND (choropleth)
  // ============================================================================
  if (hasChoropleth && colorScale) {
    const legendWidth = Math.min(300, autoWidth * 0.4);
    const legendX = (autoWidth - legendWidth) / 2;
    const legendY = mapHeight + 10;
    const stepWidth = legendWidth / colorScale.range().length;

    const legendGroup = svg.append("g")
      .attr("class", "legend")
      .attr("transform", `translate(${legendX},${legendY})`);

    // Färgrutor
    colorScale.range().forEach((color, i) => {
      legendGroup.append("rect")
        .attr("x", i * stepWidth)
        .attr("y", 0)
        .attr("width", stepWidth)
        .attr("height", 12)
        .attr("fill", color);
    });

    // Tick-värden
    const domain = colorScale.domain();
    const ticks = [domain[0], ...colorScale.thresholds(), domain[1]];
    const tickScale = d3.scaleLinear()
      .domain([domain[0], domain[1]])
      .range([0, legendWidth]);

    legendGroup.selectAll(".legend-tick")
      .data(ticks)
      .join("text")
      .attr("class", "legend-tick")
      .attr("x", d => tickScale(d))
      .attr("y", 26)
      .attr("text-anchor", "middle")
      .attr("font-family", "'IBM Plex Sans', sans-serif")
      .attr("font-size", "10px")
      .attr("fill", "#666")
      .text(d => formatValue(d) + (unit ? " " + unit : ""));
  }

  // ============================================================================
  // CAPTION + EXPORT
  // ============================================================================
  if (caption) {
    container.append("div")
      .attr("class", "graf-caption")
      .text(caption);
  }

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
