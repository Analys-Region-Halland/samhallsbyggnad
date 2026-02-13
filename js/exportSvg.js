// =============================================================================
// EXPORT SVG - Spara graf som SVG-fil med alla stilar inbakade
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";


/**
 * Skapar en exporterbar SVG med titel, undertitel och graf
 */
export function createExportSvg(chartSvg, {
  title = null,
  subtitle = null,
  caption = null,
  width = 620,
  height = 375
}) {
  // Beräkna extra höjd för titel/undertitel/caption
  const titleHeight = title ? 28 : 0;
  const subtitleHeight = subtitle ? 20 : 0;
  const captionHeight = caption ? 24 : 0;
  const headerHeight = titleHeight + subtitleHeight + (title || subtitle ? 8 : 0);
  const totalHeight = headerHeight + height + captionHeight;

  const svgNS = "http://www.w3.org/2000/svg";
  const exportSvg = document.createElementNS(svgNS, "svg");
  exportSvg.setAttribute("xmlns", svgNS);
  exportSvg.setAttribute("viewBox", `0 0 ${width} ${totalHeight}`);
  exportSvg.setAttribute("width", width);
  exportSvg.setAttribute("height", totalHeight);

  // Vit bakgrund
  const bg = document.createElementNS(svgNS, "rect");
  bg.setAttribute("width", width);
  bg.setAttribute("height", totalHeight);
  bg.setAttribute("fill", "#ffffff");
  exportSvg.appendChild(bg);

  // Titel
  let yOffset = 0;
  if (title) {
    const titleEl = document.createElementNS(svgNS, "text");
    titleEl.setAttribute("x", "14");
    titleEl.setAttribute("y", "22");
    titleEl.setAttribute("font-size", "16px");
    titleEl.setAttribute("font-weight", "600");
    titleEl.setAttribute("font-family", "'IBM Plex Sans', -apple-system, sans-serif");
    titleEl.setAttribute("fill", "#1a1a1a");
    titleEl.textContent = title;
    exportSvg.appendChild(titleEl);
    yOffset += titleHeight;
  }

  // Undertitel
  if (subtitle) {
    const subtitleEl = document.createElementNS(svgNS, "text");
    subtitleEl.setAttribute("x", "14");
    subtitleEl.setAttribute("y", String(yOffset + 16));
    subtitleEl.setAttribute("font-size", "12px");
    subtitleEl.setAttribute("font-weight", "400");
    subtitleEl.setAttribute("font-family", "'IBM Plex Sans', -apple-system, sans-serif");
    subtitleEl.setAttribute("fill", "#666666");
    subtitleEl.textContent = subtitle;
    exportSvg.appendChild(subtitleEl);
    yOffset += subtitleHeight;
  }

  if (title || subtitle) {
    yOffset += 8;
  }

  // Skapa en grupp för chart-innehållet
  const chartGroup = document.createElementNS(svgNS, "g");
  chartGroup.setAttribute("transform", `translate(0, ${yOffset})`);
  exportSvg.appendChild(chartGroup);

  // Klona och processa alla barn från original-SVG:n
  const children = chartSvg.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];

    if (child.nodeType === Node.ELEMENT_NODE) {
      const className = child.getAttribute("class") || "";
      const tagName = child.tagName.toLowerCase();

      // Skippa interaktiva overlay-element
      if (className.includes("overlay") ||
          className.includes("crosshair") ||
          className.includes("highlight")) {
        continue;
      }

      // Skippa rect som är overlay (transparent fill)
      if (tagName === "rect" && child.getAttribute("fill") === "transparent") {
        continue;
      }

      // Klona elementet djupt
      const clone = child.cloneNode(true);

      // Baka in computed styles
      inlineStylesFromOriginal(child, clone);

      chartGroup.appendChild(clone);
    }
  }

  // Caption
  if (caption) {
    const captionEl = document.createElementNS(svgNS, "text");
    captionEl.setAttribute("x", "14");
    captionEl.setAttribute("y", String(totalHeight - 8));
    captionEl.setAttribute("font-size", "10px");
    captionEl.setAttribute("font-weight", "400");
    captionEl.setAttribute("font-family", "'IBM Plex Sans', -apple-system, sans-serif");
    captionEl.setAttribute("fill", "#888888");
    captionEl.textContent = caption;
    exportSvg.appendChild(captionEl);
  }

  // Serialisera till string
  const serializer = new XMLSerializer();
  let svgString = serializer.serializeToString(exportSvg);

  // Rensa problematiska entities
  svgString = svgString.replace(/&nbsp;/g, " ");
  svgString = svgString.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");

  // Lägg till XML-deklaration
  svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + svgString;

  return svgString;
}

/**
 * Kopierar computed styles från original till klon rekursivt
 */
function inlineStylesFromOriginal(original, clone) {
  if (original.nodeType !== Node.ELEMENT_NODE) return;

  const svgStyles = [
    'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
    'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
    'font-family', 'font-size', 'font-weight', 'font-style',
    'text-anchor', 'dominant-baseline', 'opacity', 'visibility'
  ];

  try {
    const computed = window.getComputedStyle(original);

    svgStyles.forEach(style => {
      const value = computed.getPropertyValue(style);
      // Sätt värdet om det finns och inte redan är satt som attribut
      if (value && value !== 'none' && value !== '') {
        const currentAttr = clone.getAttribute(style);
        // Bara sätt om attributet inte redan finns
        if (!currentAttr) {
          clone.setAttribute(style, value);
        }
      }
    });
  } catch (e) {
    // Ignorera fel för element som inte kan ha computed styles
  }

  // Rekursivt för alla barn
  const originalChildren = original.children;
  const cloneChildren = clone.children;

  for (let i = 0; i < originalChildren.length && i < cloneChildren.length; i++) {
    inlineStylesFromOriginal(originalChildren[i], cloneChildren[i]);
  }
}

/**
 * Laddar ner SVG som fil
 */
export function downloadSvg(svgString, filename = "graf") {
  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.svg`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/**
 * Lägger till export-knapp och info-knapp i en graf-container
 */
export function addExportButton(container, chartSvg, options) {
  const { title = "graf", altText = null, info = null, logo = null } = options;

  // Skapa filename från titel
  const filename = (title || "graf")
    .toLowerCase()
    .replace(/[åä]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  // Lägg till knappar i header
  let header = container.select(".graf-header");
  if (header.empty()) {
    header = container.insert("div", ":first-child")
      .attr("class", "graf-header");
  }

  // Gör header relativt positionerad för knapparna
  header.style("position", "relative");

  // Om altText finns, sätt som aria-describedby på SVG:en
  if (altText) {
    const svgEl = container.select(".graf-svg");
    if (!svgEl.empty()) {
      svgEl.attr("aria-label", altText);
      svgEl.attr("role", "img");
    }
  }

  // Container för logga + knappar (höger sida av header, i nivå med titel)
  const rightContainer = header.append("div")
    .style("position", "absolute")
    .style("right", "1.25rem")
    .style("top", "0.9rem")
    .style("display", "flex")
    .style("gap", "10px")
    .style("align-items", "center");

  // Logga (om den finns)
  if (logo) {
    rightContainer.append("img")
      .attr("src", logo)
      .attr("alt", "")
      .attr("class", "graf-logo")
      .style("height", "26px")
      .style("width", "auto");
  }

  // Knapp-container
  const btnContainer = rightContainer.append("div")
    .style("display", "flex")
    .style("gap", "4px")
    .style("align-items", "center");

  // Gemensam knappstil
  const buttonStyle = (btn) => {
    btn
      .style("width", "26px")
      .style("height", "26px")
      .style("background", "#fff")
      .style("border", "2px solid #1a1a1a")
      .style("border-radius", "0")
      .style("cursor", "pointer")
      .style("padding", "0")
      .style("display", "flex")
      .style("align-items", "center")
      .style("justify-content", "center")
      .style("transition", "background 0.15s, transform 0.1s")
      .on("mouseenter", function() {
        d3.select(this).style("background", "#f0f0f0");
      })
      .on("mouseleave", function() {
        d3.select(this).style("background", "#fff");
      })
      .on("mousedown", function() {
        d3.select(this).style("transform", "scale(0.95)");
      })
      .on("mouseup", function() {
        d3.select(this).style("transform", "scale(1)");
      });
  };

  // Info-knapp - endast om info finns
  if (info) {
    const infoBtn = btnContainer.append("button")
      .attr("class", "graf-info-btn")
      .attr("aria-label", "Visa information om grafen")
      .style("font-family", "'IBM Plex Sans', sans-serif")
      .style("font-size", "14px")
      .style("font-weight", "600")
      .style("color", "#1a1a1a")
      .text("i");

    buttonStyle(infoBtn);

    // Custom tooltip
    const tooltip = btnContainer.append("div")
      .attr("class", "graf-btn-tooltip")
      .style("position", "absolute")
      .style("top", "calc(100% + 8px)")
      .style("right", "0")
      .style("background", "#1a1a1a")
      .style("color", "#fff")
      .style("padding", "6px 10px")
      .style("font-family", "'IBM Plex Sans', sans-serif")
      .style("font-size", "11px")
      .style("font-weight", "500")
      .style("white-space", "nowrap")
      .style("opacity", "0")
      .style("pointer-events", "none")
      .style("transition", "opacity 0.15s")
      .style("z-index", "200")
      .text("Om denna graf");

    infoBtn
      .on("mouseenter.tooltip", function() {
        tooltip.style("opacity", "1");
        d3.select(this).style("background", "#f0f0f0");
      })
      .on("mouseleave.tooltip", function() {
        tooltip.style("opacity", "0");
        d3.select(this).style("background", "#fff");
      });

    // Skapa info-panel (ljust tema, scrollbar vid lång text)
    const infoPanel = container.append("div")
      .attr("class", "graf-info-panel")
      .style("position", "absolute")
      .style("top", "0")
      .style("left", "0")
      .style("right", "0")
      .style("max-height", "60%")
      .style("overflow-y", "auto")
      .style("background", "rgba(255, 255, 255, 0.97)")
      .style("color", "#2c2826")
      .style("padding", "1.1rem 1.4rem")
      .style("padding-right", "2.8rem")
      .style("font-family", "'IBM Plex Sans', sans-serif")
      .style("font-size", "12.5px")
      .style("line-height", "1.65")
      .style("z-index", "100")
      .style("display", "none")
      .style("border-bottom", "3px solid #00664D")
      .style("box-shadow", "0 4px 16px rgba(0,0,0,0.10)");

    // Inre wrapper för att tvinga rätt textfärg på alla barn
    infoPanel.append("div")
      .style("color", "#2c2826")
      .html(info);

    // Inject scoped styles för p/strong/em inuti panelen
    infoPanel.insert("style", ":first-child")
      .text(`.graf-info-panel p { margin: 0 0 0.5em 0; color: #2c2826; }
.graf-info-panel strong { color: #00664D; font-weight: 600; }
.graf-info-panel em { font-style: italic; color: #555; }`);

    // Stäng-knapp
    infoPanel.append("button")
      .style("position", "absolute")
      .style("top", "10px")
      .style("right", "12px")
      .style("width", "22px")
      .style("height", "22px")
      .style("background", "transparent")
      .style("border", "1px solid #ccc")
      .style("border-radius", "3px")
      .style("color", "#666")
      .style("cursor", "pointer")
      .style("font-size", "14px")
      .style("line-height", "1")
      .style("display", "flex")
      .style("align-items", "center")
      .style("justify-content", "center")
      .html("\u00d7")
      .on("mouseenter", function() { d3.select(this).style("border-color", "#00664D").style("color", "#00664D"); })
      .on("mouseleave", function() { d3.select(this).style("border-color", "#ccc").style("color", "#666"); })
      .on("click", function(event) {
        event.stopPropagation();
        infoPanel.style("display", "none");
      });

    // Toggle info-panel vid klick
    infoBtn.on("click", function(event) {
      event.preventDefault();
      event.stopPropagation();
      const isVisible = infoPanel.style("display") === "block";
      infoPanel.style("display", isVisible ? "none" : "block");
    });
  }

  // Export-knapp med nedladdningsikon
  const exportBtn = btnContainer.append("button")
    .attr("class", "graf-export-btn")
    .attr("aria-label", "Spara graf som SVG")
    .html(`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" stroke-width="2.5" stroke-linecap="square" stroke-linejoin="miter">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>`);

  buttonStyle(exportBtn);

  // Custom tooltip för export
  const exportTooltip = btnContainer.append("div")
    .attr("class", "graf-btn-tooltip")
    .style("position", "absolute")
    .style("top", "calc(100% + 8px)")
    .style("right", "0")
    .style("background", "#1a1a1a")
    .style("color", "#fff")
    .style("padding", "6px 10px")
    .style("font-family", "'IBM Plex Sans', sans-serif")
    .style("font-size", "11px")
    .style("font-weight", "500")
    .style("white-space", "nowrap")
    .style("opacity", "0")
    .style("pointer-events", "none")
    .style("transition", "opacity 0.15s")
    .style("z-index", "200")
    .text("Ladda ner SVG");

  exportBtn
    .on("mouseenter.tooltip", function() {
      exportTooltip.style("opacity", "1");
      d3.select(this).style("background", "#f0f0f0");
    })
    .on("mouseleave.tooltip", function() {
      exportTooltip.style("opacity", "0");
      d3.select(this).style("background", "#fff");
    });

  exportBtn.on("click", function(event) {
    event.preventDefault();
    event.stopPropagation();

    try {
      const svgString = createExportSvg(chartSvg, options);
      downloadSvg(svgString, filename);
    } catch (err) {
      console.error("Export error:", err);
      alert("Kunde inte exportera grafen. Se konsolen för detaljer.");
    }
  });
}
