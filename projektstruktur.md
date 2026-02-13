# Projektstruktur - Samhällsbyggnad

## Koncept

En lång scrollbar HTML-rapport med D3-visualiseringar. Modulär struktur där databearbetning och visualisering är separerade.

## Filstruktur

```
samhallsbyggnad/
├── rapport.qmd               # Master-fil (importer + includes)
├── render.R                  # Kör detta → startar preview
├── style.scss                # Styling
│
├── sektioner/                # Innehåll (bara text + visualiseringsanrop)
│   ├── 01-bakgrund.qmd
│   ├── 02-metod.qmd
│   ├── 03-befolkning.qmd     # Använder: linjediagram(), stapeldiagram()
│   ├── 04-bostader.qmd       # Använder: linjediagram(), stapeldiagram()
│   └── ...
│
├── js/                       # D3-komponenter
│   ├── linjediagram.js       # Importerar D3 från CDN
│   └── stapeldiagram.js      # Importerar D3 från CDN
│
└── data/
    ├── 03-befolkning.R       # R-skript: bearbetar → exporterar JSON
    ├── 04-bostader.R
    ├── bearbeta_all_data.R   # Kör alla databearbetningsskript
    └── processed/            # JSON-filer som läses av rapporten
        ├── befolkning.json
        ├── kommuner.json
        ├── byggande.json
        └── bestand.json
```

---

## Dataflöde

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Källdata       │     │  R-skript       │     │  JSON           │
│  (SCB, Excel,   │ ──► │  data/03-*.R    │ ──► │  data/processed │
│   API, etc.)    │     │  Beräkningar    │     │  /*.json        │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Browser        │ ◄── │  rapport.html   │ ◄── │  rapport.qmd    │
│  Visar grafer   │     │  (output)       │     │  Läser JSON     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Steg för steg:

1. **Källdata** → Hämta från SCB, Excel, API, etc.
2. **R-skript** (`data/03-befolkning.R`) → Bearbeta, filtrera, beräkna
3. **JSON** (`data/processed/befolkning.json`) → Exportera med `jsonlite::write_json()`
4. **rapport.qmd** → Läser JSON via `FileAttachment()`
5. **D3-komponent** → Renderar grafen i browsern

---

## Hur D3 laddas i rapporten

Allt sker i **rapport.qmd** i ett OJS-block högst upp:

```
---
title: "Samhällsbyggnad i Halland"
...
---

` ` `{ojs}
// 1. Importera D3-komponenter (dessa importerar D3 från CDN internt)
import { linjediagram } from "./js/linjediagram.js"
import { stapeldiagram } from "./js/stapeldiagram.js"

// 2. Ladda all data från JSON-filer
befolkning = FileAttachment("data/processed/befolkning.json").json()
kommuner = FileAttachment("data/processed/kommuner.json").json()
byggande = FileAttachment("data/processed/byggande.json").json()
bestand_raw = FileAttachment("data/processed/bestand.json").json()

// 3. Ev. transformera data
bestand = bestand_raw.flatMap(d => [
  { kommun: d.kommun, typ: "Hyresrätt", antal: d.hyresrätt },
  { kommun: d.kommun, typ: "Bostadsrätt", antal: d.bostadsrätt },
  { kommun: d.kommun, typ: "Äganderätt", antal: d.äganderätt }
])
` ` `

{{< include sektioner/01-bakgrund.qmd >}}
...
```

**Viktigt:**
- Alla importer och data laddas i rapport.qmd (master-filen)
- Sektionsfilerna har tillgång till dessa variabler automatiskt
- D3 importeras internt i JS-filerna från CDN

---

## Hur visualiseringar används i sektioner

I sektionsfilerna (t.ex. `sektioner/03-befolkning.qmd`) är det rent:

```markdown
# Befolkning

Text här...

` ` `{ojs}
linjediagram(befolkning, {
  x: "år",
  y: "befolkning",
  color: "region",
  title: "Befolkningsutveckling 2015–2024",
  yLabel: "Antal invånare"
})
` ` `

Mer text...
```

**Notera:** Ingen import, ingen datainläsning – bara ett funktionsanrop.

---

## JS-komponenternas struktur

Varje JS-fil (`js/linjediagram.js`) har denna struktur:

```javascript
// Importera D3 från CDN
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// Exportera funktion med options
export function linjediagram(data, {
  x = "år",
  y = "värde",
  color = null,
  title = null,
  ...
} = {}) {

  // Skapa SVG med D3
  const svg = d3.create("svg")...

  // Rita grafen
  ...

  // Returnera DOM-noden
  return svg.node();
}
```

---

## D3-komponenter: API

### linjediagram(data, options)

| Option | Default | Beskrivning |
|--------|---------|-------------|
| x | "år" | Kolumn för x-axel (numerisk) |
| y | "värde" | Kolumn för y-axel |
| color | null | Kolumn för gruppering (flera linjer) |
| title | null | Diagramtitel |
| xLabel | null | X-axel-etikett |
| yLabel | null | Y-axel-etikett |
| width | 700 | Bredd i px |
| height | 400 | Höjd i px |
| colors | [...] | Färgpalett (array) |

### stapeldiagram(data, options)

| Option | Default | Beskrivning |
|--------|---------|-------------|
| x | "kategori" | Kolumn för kategorier |
| y | "värde" | Kolumn för värden |
| color | null | Kolumn för gruppering |
| grouped | false | true = grupperade staplar, false = staplade |
| title | null | Diagramtitel |
| xLabel | null | X-axel-etikett |
| yLabel | null | Y-axel-etikett |

---

## Arbetsflöde

### Dagligt arbete
```r
source("render.R")   # Startar preview med live-reload
```
Redigera filer → sparar → browser uppdateras automatiskt.

### När data ändras
```r
source("data/bearbeta_all_data.R")   # Kör alla R-skript
source("render.R")                    # Starta om preview
```

### Lägga till ny data + graf

1. **Skapa R-skript** `data/05-infrastruktur.R`:
   ```r
   library(jsonlite)

   # Bearbeta data
   vagnat <- data.frame(...)

   # Exportera
   write_json(vagnat, "data/processed/vagnat.json")
   ```

2. **Kör skriptet**:
   ```r
   source("data/05-infrastruktur.R")
   ```

3. **Lägg till i rapport.qmd** (i OJS-blocket):
   ```javascript
   vagnat = FileAttachment("data/processed/vagnat.json").json()
   ```

4. **Använd i sektionen** `sektioner/05-infrastruktur.qmd`:
   ```
   ` ` `{ojs}
   linjediagram(vagnat, { x: "år", y: "km", title: "Vägnät" })
   ` ` `
   ```

---

## Status

- [x] Master-fil med include-struktur
- [x] 10 kapitel (lorem ipsum)
- [x] D3-komponenter (linjediagram, stapeldiagram)
- [x] Databearbetningsstruktur
- [x] Testgrafer i kapitel 3 och 4
- [ ] Riktigt innehåll
- [ ] Fler D3-komponenter vid behov
