// =============================================================================
// FILTER UTILS - Delad utility-modul for filter/highlight/selector-logik
// =============================================================================

/**
 * Bygger filterState med groupMap, filterSet och highlight-hantering.
 *
 * @param {Array} data - Hela datasetet
 * @param {Object} opts
 * @param {string} opts.itemField - Fält för individuella items (t.ex. "kommun", "namn")
 * @param {string|null} opts.groupField - Fält för gruppering (t.ex. "län", "color")
 * @param {Array|null} opts.filter - Begränsa valbara items (gruppnamn eller individuella)
 * @param {Array|null} opts.highlight - Förvalda highlightade items
 * @returns {Object} filterState
 */
export function createFilterState(data, { itemField, groupField = null, filter = null, highlight = null } = {}) {
  // Bygg gruppkarta från HELA datan
  const groupMap = new Map();
  if (groupField) {
    for (const d of data) {
      const groupName = d[groupField];
      const itemName = d[itemField];
      if (!groupMap.has(groupName)) groupMap.set(groupName, []);
      const members = groupMap.get(groupName);
      if (!members.includes(itemName)) members.push(itemName);
    }
  }

  // Resolva filter - bestam vilka items som ar valbara
  let filterSet = null;
  if (filter) {
    const resolved = [];
    for (const f of filter) {
      if (groupMap.has(f)) resolved.push(...groupMap.get(f));
      else resolved.push(f);
    }
    if (resolved.length > 0) {
      filterSet = resolved;
      // Bygg om groupMap for panelen (bara filtrerade items)
      groupMap.clear();
      if (groupField) {
        for (const d of data) {
          if (!filterSet.includes(d[itemField])) continue;
          const groupName = d[groupField];
          const itemName = d[itemField];
          if (!groupMap.has(groupName)) groupMap.set(groupName, []);
          const members = groupMap.get(groupName);
          if (!members.includes(itemName)) members.push(itemName);
        }
      }
    }
  }

  // Resolva highlight: expandera gruppnamn till individuella items
  let currentHighlight = null;
  if (highlight) {
    const resolved = [];
    for (const h of highlight) {
      if (groupMap.has(h)) resolved.push(...groupMap.get(h));
      else resolved.push(h);
    }
    currentHighlight = resolved.length > 0 ? resolved : null;
  } else if (filterSet) {
    // Om filter satt men inte highlight -> alla filtrerade markerade
    currentHighlight = [...filterSet];
  }

  // Dolda items (helt borttagna från grafen)
  const hiddenSet = new Set();

  return {
    groupMap,
    filterSet,

    isHighlighted(item) {
      if (hiddenSet.has(item)) return false;
      if (filterSet && !filterSet.includes(item)) return false;
      if (!currentHighlight || currentHighlight.length === 0) return true;
      return currentHighlight.includes(item);
    },

    isHidden(item) {
      return hiddenSet.has(item);
    },

    hide(item) {
      hiddenSet.add(item);
    },

    unhide(item) {
      hiddenSet.delete(item);
    },

    getHidden() {
      return [...hiddenSet];
    },

    toggle(item) {
      if (!currentHighlight) {
        currentHighlight = [item];
      } else if (currentHighlight.includes(item)) {
        currentHighlight = currentHighlight.filter(i => i !== item);
        if (currentHighlight.length === 0) currentHighlight = null;
      } else {
        currentHighlight = [...currentHighlight, item];
      }
    },

    toggleGroup(groupName) {
      const members = groupMap.get(groupName);
      if (!members) return;
      const allSelected = members.every(m => currentHighlight && currentHighlight.includes(m));
      if (allSelected) {
        currentHighlight = currentHighlight.filter(c => !members.includes(c));
        if (currentHighlight.length === 0) currentHighlight = null;
      } else {
        if (!currentHighlight) {
          currentHighlight = [...members];
        } else {
          const toAdd = members.filter(m => !currentHighlight.includes(m));
          currentHighlight = [...currentHighlight, ...toAdd];
        }
      }
    },

    getHighlight() {
      return currentHighlight;
    }
  };
}

/**
 * Injicerar CSS for selector-paneler (en gang).
 */
export function injectSelectorCSS() {
  if (document.getElementById("graf-selector-styles")) return;
  const styles = document.createElement("style");
  styles.id = "graf-selector-styles";
  styles.textContent = `
    .graf-selector {
      margin-top: 2px;
      font-family: 'IBM Plex Sans', sans-serif;
      user-select: none;
    }
    .graf-selector-trigger {
      font-size: 10px;
      color: #888;
      cursor: pointer;
      transition: color 0.15s;
      letter-spacing: 0.02em;
    }
    .graf-selector-trigger:hover {
      color: #333;
    }
    .graf-selector-panel {
      display: none;
      margin-top: 4px;
      padding: 5px 10px 5px 8px;
      background: #fff;
      border: 1px solid #1a1a1a;
      width: fit-content;
      max-width: 600px;
    }
    .graf-selector.expanded .graf-selector-panel {
      display: block;
    }
    .graf-selector-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(90px, auto));
      column-gap: 12px;
      row-gap: 1px;
    }
    .graf-selector-group-header {
      grid-column: 1 / -1;
      font-size: 9px;
      font-weight: 600;
      margin-top: 4px;
      margin-bottom: 2px;
      padding-bottom: 2px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: opacity 0.1s;
    }
    .graf-selector-group-header:first-child {
      margin-top: 0;
    }
    .graf-selector-group-header:hover {
      opacity: 0.6;
    }
    .graf-selector-group-header .group-indicator {
      font-size: 8px;
    }
    .graf-selector-option {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 1px 0;
      font-size: 10px;
      cursor: pointer;
      transition: opacity 0.1s;
    }
    .graf-selector-option:hover {
      opacity: 0.6;
    }
    .graf-selector-option .opt-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      border: 1px solid currentColor;
      background: transparent;
      box-sizing: border-box;
      flex-shrink: 0;
    }
    .graf-selector-option.selected .opt-dot {
      background: currentColor;
    }
    .graf-selector-option .opt-name {
      color: #666;
      white-space: nowrap;
    }
    .graf-selector-option.selected .opt-name {
      font-weight: 600;
      color: #1a1a1a;
    }
    .graf-selector-option.hidden .opt-dot {
      background: transparent !important;
      border-color: #ccc !important;
      border-style: dashed;
    }
    .graf-selector-option.hidden .opt-name {
      text-decoration: line-through;
      color: #aaa !important;
      font-weight: 400 !important;
    }
    .graf-selector-option.hidden .opt-restore {
      font-size: 9px;
      color: #aaa;
      margin-left: 2px;
    }
    .graf-selector-option .opt-remove {
      margin-left: 2px;
      font-size: 10px;
      color: #bbb;
      cursor: pointer;
      flex-shrink: 0;
      line-height: 1;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .graf-selector-option:hover .opt-remove {
      opacity: 1;
    }
    .graf-selector-option .opt-remove:hover {
      color: #666;
    }
    .graf-selector-columns {
      column-gap: 20px;
    }
    .graf-selector-columns .graf-selector-option {
      break-inside: avoid;
    }
    .graf-selector-hidden-row {
      margin-top: 3px;
      font-family: 'IBM Plex Sans', sans-serif;
      font-size: 10px;
      color: #999;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 2px 8px;
    }
    .graf-selector-hidden-row .hidden-label {
      color: #bbb;
      font-size: 9px;
      letter-spacing: 0.02em;
    }
    .graf-selector-hidden-row .hidden-item {
      cursor: pointer;
      color: #999;
      text-decoration: line-through;
      transition: color 0.1s;
    }
    .graf-selector-hidden-row .hidden-item:hover {
      color: #333;
      text-decoration: none;
    }
  `;
  document.head.appendChild(styles);
}

/**
 * Skapar en selector-panel (trigger + expand-panel med grid).
 *
 * @param {d3.Selection} header - D3-selection att appenda selektorn till
 * @param {Object} opts
 * @param {Object} opts.filterState - returnvarde fran createFilterState
 * @param {Array} opts.allItems - Alla valbara items (for flat lista)
 * @param {Function} opts.colorScale - Fargfunktion (item eller grupp -> farg)
 * @param {string} opts.triggerText - Text pa trigger-knappen
 * @param {Function} opts.onUpdate - Callback nar highlight andras
 * @param {Function} [opts.onItemHover] - Callback vid hover pa item (item, event)
 * @param {Function} [opts.onItemLeave] - Callback vid leave fran item
 * @param {number|null} [opts.columns] - Antal kolumner for flat lista (top-to-bottom flow)
 * @returns {Object} { update(), element }
 */
export function createSelectorPanel(header, {
  filterState,
  allItems,
  colorScale,
  triggerText = "Markera \u203a",
  onUpdate,
  onItemHover = null,
  onItemLeave = null,
  columns = null
} = {}) {
  injectSelectorCSS();

  const selector = header.append("div")
    .attr("class", "graf-selector");

  const selectorTrigger = selector.append("span")
    .attr("class", "graf-selector-trigger")
    .text(triggerText);

  const selectorPanel = selector.append("div")
    .attr("class", "graf-selector-panel");

  const grid = selectorPanel.append("div")
    .attr("class", "graf-selector-grid");

  // Separat rad för dolda items (utanför panelen, alltid synlig)
  const hiddenRow = selector.append("div")
    .attr("class", "graf-selector-hidden-row")
    .style("display", "none");

  // Hover for expand/collapse
  let hoverTimeout = null;
  selectorTrigger.on("mouseenter", () => {
    clearTimeout(hoverTimeout);
    selector.classed("expanded", true);
  });
  selector.on("mouseleave", () => {
    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => {
      selector.classed("expanded", false);
    }, 150);
  });

  function update() {
    grid.selectAll("*").remove();
    const { groupMap } = filterState;

    if (groupMap && groupMap.size > 0) {
      for (const [groupName, members] of groupMap) {
        const groupMembers = members.filter(m => allItems.includes(m));
        if (groupMembers.length === 0) continue;

        const allInGroup = groupMembers.every(m => filterState.isHighlighted(m));
        const noneInGroup = groupMembers.every(m => !filterState.isHighlighted(m));
        const hl = filterState.getHighlight();
        const indicator = (!hl) ? "\u25CF" : allInGroup ? "\u25CF" : noneInGroup ? "\u25CB" : "\u25D0";

        const headerDiv = grid.append("div")
          .attr("class", "graf-selector-group-header")
          .style("color", colorScale(groupName))
          .style("border-bottom", `1px solid ${colorScale(groupName)}`)
          .on("click", (event) => {
            event.stopPropagation();
            filterState.toggleGroup(groupName);
            onUpdate();
          });

        headerDiv.append("span")
          .attr("class", "group-indicator")
          .text(indicator);

        headerDiv.append("span")
          .text(groupName);

        const subGrid = grid.append("div")
          .style("grid-column", "1 / -1")
          .style("display", "grid")
          .style("grid-template-columns", "repeat(auto-fill, minmax(90px, 1fr))")
          .style("column-gap", "12px")
          .style("row-gap", "1px");

        groupMembers.forEach(item => {
          const hidden = filterState.isHidden(item);
          const selected = !hidden && filterState.isHighlighted(item);
          const catColor = colorScale(groupName);

          const opt = subGrid.append("span")
            .attr("class", `graf-selector-option ${selected ? "selected" : ""} ${hidden ? "hidden" : ""}`)
            .style("color", catColor)
            .on("click", (event) => {
              event.stopPropagation();
              if (hidden) {
                filterState.unhide(item);
              } else {
                const hl = filterState.getHighlight();
                const selectable = filterState.filterSet || allItems;
                const allOn = !hl || selectable.every(i => hl.includes(i));
                if (allOn) {
                  if (hl) hl.forEach(c => { if (c !== item) filterState.toggle(c); });
                  if (!filterState.isHighlighted(item) || !filterState.getHighlight()) filterState.toggle(item);
                } else {
                  filterState.toggle(item);
                }
              }
              onUpdate();
            });

          if (onItemHover && !hidden) {
            opt.on("mouseenter", (event) => onItemHover(item, event));
          }
          if (onItemLeave && !hidden) {
            opt.on("mouseleave", (event) => onItemLeave(item, event));
          }

          opt.append("span")
            .attr("class", "opt-dot")
            .style("border-color", catColor);

          opt.append("span")
            .attr("class", "opt-name")
            .text(item);

          if (hidden) {
            opt.append("span")
              .attr("class", "opt-restore")
              .text("↩");
          } else {
            opt.append("span")
              .attr("class", "opt-remove")
              .text("×")
              .on("click", (event) => {
                event.stopPropagation();
                filterState.hide(item);
                onUpdate();
              });
          }
        });
      }
    } else {
      // Flat lista (inga grupper)
      // Använd kolumnlayout om columns är satt
      const target = columns
        ? grid.append("div")
            .attr("class", "graf-selector-columns")
            .style("column-count", columns)
        : grid;

      allItems.forEach(item => {
        const hidden = filterState.isHidden(item);
        const selected = !hidden && filterState.isHighlighted(item);
        const catColor = colorScale(item);

        const opt = target.append("span")
          .attr("class", `graf-selector-option ${selected ? "selected" : ""} ${hidden ? "hidden" : ""}`)
          .style("color", catColor)
          .on("click", (event) => {
            event.stopPropagation();
            if (hidden) {
              // Klick på dold → visa igen
              filterState.unhide(item);
            } else {
              filterState.toggle(item);
            }
            onUpdate();
          });

        if (onItemHover && !hidden) {
          opt.on("mouseenter", (event) => onItemHover(item, event));
        }
        if (onItemLeave && !hidden) {
          opt.on("mouseleave", (event) => onItemLeave(item, event));
        }

        opt.append("span")
          .attr("class", "opt-dot")
          .style("border-color", catColor);

        opt.append("span")
          .attr("class", "opt-name")
          .text(item);

        if (hidden) {
          // Restore-indikator för dolda items
          opt.append("span")
            .attr("class", "opt-restore")
            .text("↩");
        } else {
          // X-knapp för att dölja (synlig vid hover)
          opt.append("span")
            .attr("class", "opt-remove")
            .text("×")
            .on("click", (event) => {
              event.stopPropagation();
              filterState.hide(item);
              onUpdate();
            });
        }
      });
    }

    // Bygg dolda-rad (utanför panelen, alltid synlig)
    hiddenRow.selectAll("*").remove();
    const allHidden = filterState.getHidden();
    if (allHidden.length > 0) {
      hiddenRow.style("display", null);
      hiddenRow.append("span")
        .attr("class", "hidden-label")
        .text("Dolda:");
      for (const item of allHidden) {
        hiddenRow.append("span")
          .attr("class", "hidden-item")
          .text(item + " ↩")
          .on("click", (event) => {
            event.stopPropagation();
            filterState.unhide(item);
            onUpdate();
          });
      }
    } else {
      hiddenRow.style("display", "none");
    }
  }

  return { update, element: selector };
}
