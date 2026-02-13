// =============================================================================
// GRAFSTEPPER - Stepper-komponent för att bläddra mellan grafer
// =============================================================================

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

function injectStepperCSS() {
  if (document.getElementById("graf-stepper-styles")) return;
  const styles = document.createElement("style");
  styles.id = "graf-stepper-styles";
  styles.textContent = `
    .graf-stepper {
      font-family: 'IBM Plex Sans', sans-serif;
      position: relative;
    }

    .graf-stepper-slide {
      display: none;
    }
    .graf-stepper-slide.active {
      display: block;
    }

    /* Nav sitter inne i graf-header, bottom-right i nivå med subtitle */
    .graf-stepper-nav {
      position: absolute;
      right: 1.25rem;
      bottom: 0.55rem;
      display: flex;
      align-items: center;
      gap: 0;
      user-select: none;
    }

    .graf-stepper-arrow,
    .graf-stepper-arrow.btn,
    .graf-stepper-arrow.btn-quarto {
      background: none !important;
      border: none !important;
      outline: none !important;
      box-shadow: none !important;
      border-radius: 0 !important;
      color: #1a1a1a;
      font-size: 18px;
      font-weight: 300;
      line-height: 1;
      cursor: pointer;
      padding: 0 5px;
      opacity: 0.5;
      transition: opacity 0.15s;
    }
    .graf-stepper-arrow:hover,
    .graf-stepper-arrow.btn:hover {
      opacity: 1;
      background: none !important;
    }
    .graf-stepper-arrow:focus,
    .graf-stepper-arrow.btn:focus,
    .graf-stepper-arrow:focus-visible {
      box-shadow: none !important;
      outline: none !important;
    }
    .graf-stepper-arrow:disabled,
    .graf-stepper-arrow.btn:disabled {
      opacity: 0.15;
      cursor: default;
      pointer-events: none;
      background: none !important;
    }

    .graf-stepper-track {
      display: flex;
      align-items: center;
      position: relative;
      gap: 8px;
      padding: 0 2px;
    }
    .graf-stepper-track::before {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      height: 1.5px;
      background: #1a1a1a;
      opacity: 0.3;
      transform: translateY(-50%);
      pointer-events: none;
    }

    .graf-stepper-marker,
    .graf-stepper-marker.btn,
    .graf-stepper-marker.btn-quarto {
      background: none !important;
      border: none !important;
      outline: none !important;
      box-shadow: none !important;
      border-radius: 0 !important;
      padding: 5px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      z-index: 1;
    }
    .graf-stepper-marker:focus,
    .graf-stepper-marker.btn:focus,
    .graf-stepper-marker:focus-visible {
      box-shadow: none !important;
      outline: none !important;
    }

    .graf-stepper-marker-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #1a1a1a;
      opacity: 0.22;
      transition: transform 0.15s ease, opacity 0.15s ease;
      pointer-events: none;
    }
    .graf-stepper-marker.active .graf-stepper-marker-dot {
      opacity: 1;
      transform: scale(1.45);
    }

    .graf-stepper-counter {
      font-size: 10.5px;
      color: #1a1a1a;
      opacity: 0.4;
      margin-left: 6px;
      white-space: nowrap;
    }

    @media print {
      .graf-stepper-nav {
        display: none !important;
      }
      .graf-stepper-slide {
        display: block !important;
        break-inside: avoid;
      }
    }
  `;
  document.head.appendChild(styles);
}

/**
 * grafStepper — visar en graf åt gången med navigation i graf-headern.
 *
 * Nav:en placeras bottom-right i varje slides .graf-header,
 * i nivå med undertiteln, bredvid loggan.
 *
 * @param {HTMLElement[]} elements - Array av DOM-noder (returnerade av graf-komponenterna)
 * @param {Object} [options]
 * @returns {HTMLElement} wrapper DOM-nod
 */
export function grafStepper(elements, options = {}) {
  injectStepperCSS();

  let current = 0;
  const count = elements.length;

  // Container
  const container = d3.create("div")
    .attr("class", "graf-stepper")
    .attr("tabindex", "0");

  // --- Slides ---
  const slides = [];
  for (let i = 0; i < count; i++) {
    const slide = container.append("div")
      .attr("class", "graf-stepper-slide");
    slide.node().appendChild(elements[i]);
    slides.push(slide);
  }

  // --- Navigation (skapas fristående, flyttas in i aktiv header) ---
  const nav = d3.create("div")
    .attr("class", "graf-stepper-nav");

  const prevBtn = nav.append("button")
    .attr("class", "graf-stepper-arrow")
    .attr("aria-label", "Föregående")
    .html("&#x2039;");

  const track = nav.append("div")
    .attr("class", "graf-stepper-track");

  const markers = [];
  for (let i = 0; i < count; i++) {
    const marker = track.append("button")
      .attr("class", "graf-stepper-marker")
      .attr("aria-label", `Visa vy ${i + 1}`);
    marker.append("span")
      .attr("class", "graf-stepper-marker-dot");
    markers.push(marker);
  }

  const nextBtn = nav.append("button")
    .attr("class", "graf-stepper-arrow")
    .attr("aria-label", "Nästa")
    .html("&#x203A;");

  const counter = nav.append("span")
    .attr("class", "graf-stepper-counter");

  // --- Update logic ---
  function goTo(index) {
    current = Math.max(0, Math.min(count - 1, index));
    slides.forEach((s, i) => s.classed("active", i === current));
    markers.forEach((m, i) => m.classed("active", i === current));
    prevBtn.attr("disabled", current === 0 ? true : null);
    nextBtn.attr("disabled", current === count - 1 ? true : null);
    counter.text(`${current + 1} / ${count}`);

    // Flytta nav in i den aktiva slidens graf-header
    const header = slides[current].select(".graf-header");
    if (!header.empty()) {
      header.node().appendChild(nav.node());
    }
  }

  // --- Event handlers ---
  prevBtn.on("click", () => goTo(current - 1));
  nextBtn.on("click", () => goTo(current + 1));
  markers.forEach((m, i) => m.on("click", () => goTo(i)));

  container.on("keydown", (event) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); goTo(current - 1); }
    if (event.key === "ArrowRight") { event.preventDefault(); goTo(current + 1); }
  });

  // Initialize
  goTo(0);

  return container.node();
}
