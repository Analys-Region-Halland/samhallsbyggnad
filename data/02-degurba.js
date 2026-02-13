#!/usr/bin/env node
// =============================================================================
// 02-DEGURBA.JS
// Creates:
//   1. 02-tathet-halland.topojson  - Individual 1km cells in Halland (density + DEGURBA)
//   2. 02-degurba-karta.topojson   - DEGURBA dissolved for all Sweden
//   3. 02-degurba.json             - Aggregated DEGURBA stats per region
// =============================================================================

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const projDir = path.resolve(__dirname, "..");
const csvPath = path.join(projDir, "data", "processed", "nordregio_sverige.csv");
const sverigeTopoPath = path.join(projDir, "data", "processed", "sverige.topojson");
const processedDir = path.join(projDir, "data", "processed");

const lanNames = {
  "01": "Stockholm", "03": "Uppsala", "04": "Södermanland", "05": "Östergötland",
  "06": "Jönköping", "07": "Kronoberg", "08": "Kalmar", "09": "Gotland",
  "10": "Blekinge", "12": "Skåne", "13": "Halland", "14": "Västra Götaland",
  "17": "Värmland", "18": "Örebro", "19": "Västmanland", "20": "Dalarna",
  "21": "Gävleborg", "22": "Västernorrland", "23": "Jämtland", "24": "Västerbotten",
  "25": "Norrbotten"
};

// ============================================================================
// 1/6  PARSE CSV
// ============================================================================
console.log("1/6  Läser CSV...");
const csv = fs.readFileSync(csvPath, "utf8");
const lines = csv.split("\n");
const cells = [];
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const cols = line.split(",").map(s => s.replace(/"/g, ""));
  if (cols.length < 7) continue;

  const rutId = cols[0];
  const kn = cols[1];
  const ln = cols[2];
  const pop = parseInt(cols[6]) || 0;

  if (!lanNames[ln]) continue; // skip invalid län codes

  const e = parseInt(rutId.substring(0, 6));
  const n = parseInt(rutId.substring(6, 13));
  if (isNaN(e) || isNaN(n)) continue;

  cells.push({ e, n, kn, ln, pop, rutId });
}
console.log(`     ${cells.length} celler`);

// ============================================================================
// 2/6  DEGURBA CLASSIFICATION (connected components via BFS)
// ============================================================================
console.log("2/6  DEGURBA-klassificering...");

const gridIndex = new Map();
for (const c of cells) {
  gridIndex.set(`${c.e},${c.n}`, c);
}

// 8-connectivity neighbors (Queen contiguity)
const NEIGHBORS = [
  [-1000, 0], [1000, 0], [0, -1000], [0, 1000],
  [-1000, -1000], [-1000, 1000], [1000, -1000], [1000, 1000]
];

function findClusters(eligible) {
  const eligSet = new Set(eligible.map(c => `${c.e},${c.n}`));
  const visited = new Set();
  const clusters = [];

  for (const c of eligible) {
    const key = `${c.e},${c.n}`;
    if (visited.has(key)) continue;

    const cluster = [];
    const queue = [c];
    visited.add(key);

    while (queue.length > 0) {
      const curr = queue.shift();
      cluster.push(curr);

      for (const [de, dn] of NEIGHBORS) {
        const nkey = `${curr.e + de},${curr.n + dn}`;
        if (eligSet.has(nkey) && !visited.has(nkey)) {
          visited.add(nkey);
          queue.push(gridIndex.get(nkey));
        }
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

// Initialize all as rural
const degurbaMap = new Map();
for (const c of cells) {
  degurbaMap.set(c.rutId, "Glesbefolkade områden");
}

// Step 1: Cities — contiguous cells ≥1500 inv/km², cluster total ≥50 000
const highDensity = cells.filter(c => c.pop >= 1500);
console.log(`     Celler med ≥1 500 inv: ${highDensity.length}`);
const highClusters = findClusters(highDensity);
let cityCount = 0;
for (const cluster of highClusters) {
  const totalPop = cluster.reduce((s, c) => s + c.pop, 0);
  if (totalPop >= 50000) {
    for (const c of cluster) {
      degurbaMap.set(c.rutId, "Tätbefolkade områden");
      cityCount++;
    }
  }
}
console.log(`     Tätbefolkade (cities): ${cityCount} celler`);

// Step 2: Towns & suburbs — remaining cells ≥300 inv/km², cluster total ≥5 000
const medDensity = cells.filter(c =>
  c.pop >= 300 && degurbaMap.get(c.rutId) !== "Tätbefolkade områden"
);
console.log(`     Celler med ≥300 inv (ej city): ${medDensity.length}`);
const medClusters = findClusters(medDensity);
let townCount = 0;
for (const cluster of medClusters) {
  const totalPop = cluster.reduce((s, c) => s + c.pop, 0);
  if (totalPop >= 5000) {
    for (const c of cluster) {
      degurbaMap.set(c.rutId, "Medelbefolkade områden");
      townCount++;
    }
  }
}
console.log(`     Medelbefolkade (towns): ${townCount} celler`);
console.log(`     Glesbefolkade (rural): ${cells.length - cityCount - townCount} celler`);

// Print Halland-specific stats
const hallandAll = cells.filter(c => c.ln === "13");
const hallandPop = hallandAll.reduce((s, c) => s + c.pop, 0);
const hallandDeg = { "Tätbefolkade områden": 0, "Medelbefolkade områden": 0, "Glesbefolkade områden": 0 };
for (const c of hallandAll) {
  hallandDeg[degurbaMap.get(c.rutId)] += c.pop;
}
console.log("\n     === HALLAND DEGURBA ===");
for (const [cls, pop] of Object.entries(hallandDeg)) {
  console.log(`     ${cls}: ${pop.toLocaleString("sv-SE")} inv (${(pop / hallandPop * 100).toFixed(1)}%)`);
}

// Density bracket stats
const brackets = { "Obebodd": 0, "1–24": 0, "25–99": 0, "100–299": 0, "300–1 499": 0, "≥1 500": 0 };
for (const c of hallandAll) {
  const cls = c.pop === 0 ? "Obebodd" : c.pop < 25 ? "1–24" : c.pop < 100 ? "25–99"
    : c.pop < 300 ? "100–299" : c.pop < 1500 ? "300–1 499" : "≥1 500";
  brackets[cls]++;
}
console.log("\n     === HALLAND TÄTHET (antal rutor) ===");
for (const [cls, count] of Object.entries(brackets)) {
  console.log(`     ${cls}: ${count} rutor`);
}
console.log("");

// ============================================================================
// 3/6  HALLAND DENSITY CELLS → TOPOJSON
// ============================================================================
console.log("3/6  Skapar Halland täthetsceller...");

function getDensityClass(pop) {
  if (pop === 0) return "Obebodd";
  if (pop < 25) return "1–24";
  if (pop < 100) return "25–99";
  if (pop < 300) return "100–299";
  if (pop < 1500) return "300–1 499";
  return "≥1 500";
}

// Sort by density class order for consistent colorBy legend
const densityOrder = ["Obebodd", "1–24", "25–99", "100–299", "300–1 499", "≥1 500"];
const hallandSorted = [...hallandAll].sort((a, b) => {
  return densityOrder.indexOf(getDensityClass(a.pop)) - densityOrder.indexOf(getDensityClass(b.pop));
});

const hallandFeatures = hallandSorted.map(c => ({
  type: "Feature",
  properties: {
    pop: c.pop,
    tathet: getDensityClass(c.pop),
    degurba: degurbaMap.get(c.rutId),
    kn: c.kn
  },
  geometry: {
    type: "Polygon",
    coordinates: [[[c.e, c.n], [c.e + 1000, c.n], [c.e + 1000, c.n + 1000], [c.e, c.n + 1000], [c.e, c.n]]]
  }
}));

const tmpHalland = path.join(processedDir, "_tmp_halland_cells.geojson");
fs.writeFileSync(tmpHalland, JSON.stringify({ type: "FeatureCollection", features: hallandFeatures }));
console.log(`     ${hallandFeatures.length} celler, ${(fs.statSync(tmpHalland).size / 1024 / 1024).toFixed(1)} MB`);

const tathetOutput = path.join(processedDir, "02-tathet-halland.topojson");
try {
  const cmd1 = [
    `npx mapshaper "${tmpHalland}"`,
    `-rename-layers rutor`,
    `-i "${sverigeTopoPath}" combine-files`,
    `-o "${tathetOutput}" format=topojson target=*`
  ].join(" ");
  console.log("     Mapshaper: cells + kommuner → topojson...");
  execSync(cmd1, { stdio: "inherit", maxBuffer: 200 * 1024 * 1024, timeout: 120000 });
  fs.unlinkSync(tmpHalland);
  console.log(`     → ${(fs.statSync(tathetOutput).size / 1024 / 1024).toFixed(1)} MB`);
} catch (err) {
  console.error("Mapshaper-fel (halland):", err.message);
  process.exit(1);
}

// ============================================================================
// 4/6  ALL-SWEDEN DEGURBA → DISSOLVE → TOPOJSON
// ============================================================================
console.log("4/6  Skapar DEGURBA-karta (hela Sverige)...");

const tmpDegurba = path.join(processedDir, "_tmp_degurba_cells.geojson");
const ws = fs.createWriteStream(tmpDegurba);
ws.write('{"type":"FeatureCollection","features":[\n');

let first = true;
let writeCount = 0;
for (const c of cells) {
  const feature = {
    type: "Feature",
    properties: {
      degurba: degurbaMap.get(c.rutId),
      kn: c.kn,
      ln: c.ln,
      pop: c.pop
    },
    geometry: {
      type: "Polygon",
      coordinates: [[[c.e, c.n], [c.e + 1000, c.n], [c.e + 1000, c.n + 1000], [c.e, c.n + 1000], [c.e, c.n]]]
    }
  };

  if (!first) ws.write(",\n");
  ws.write(JSON.stringify(feature));
  first = false;
  writeCount++;

  if (writeCount % 100000 === 0) console.log(`     ${writeCount} features...`);
}
ws.write("\n]}");
ws.end();

ws.on("finish", () => {
  console.log(`     ${writeCount} features, ${(fs.statSync(tmpDegurba).size / 1024 / 1024).toFixed(1)} MB`);

  const degurbaKartaOutput = path.join(processedDir, "02-degurba-karta.topojson");
  const cmd2 = [
    `npx mapshaper "${tmpDegurba}"`,
    `-dissolve degurba,kn,ln`,
    `-simplify dp 15% keep-shapes`,
    `-rename-layers rutor`,
    `-i "${sverigeTopoPath}" combine-files`,
    `-o "${degurbaKartaOutput}" format=topojson target=*`
  ].join(" ");

  console.log("     Mapshaper: dissolve + simplify...");
  try {
    execSync(cmd2, { stdio: "inherit", maxBuffer: 200 * 1024 * 1024, timeout: 300000 });
    fs.unlinkSync(tmpDegurba);
    console.log(`     → ${(fs.statSync(degurbaKartaOutput).size / 1024 / 1024).toFixed(1)} MB`);

    // Sort geometries for consistent color order
    const topo = JSON.parse(fs.readFileSync(degurbaKartaOutput, "utf8"));
    if (topo.objects.rutor) {
      const order = ["Tätbefolkade områden", "Medelbefolkade områden", "Glesbefolkade områden"];
      topo.objects.rutor.geometries.sort((a, b) =>
        order.indexOf(a.properties.degurba) - order.indexOf(b.properties.degurba)
      );
      fs.writeFileSync(degurbaKartaOutput, JSON.stringify(topo));
      console.log("     Sorterade geometrier");
    }

    createStats();
  } catch (err) {
    console.error("Mapshaper-fel (degurba):", err.message);
    process.exit(1);
  }
});

// ============================================================================
// 5/6 + 6/6  AGGREGATED STATS → JSON
// ============================================================================
function createStats() {
  console.log("5/6  Aggregerar DEGURBA-statistik...");

  const stats = {};
  const regionTotals = {};

  for (const c of cells) {
    const region = lanNames[c.ln];
    if (!region) continue;
    const deg = degurbaMap.get(c.rutId);
    const key = `${region}|${deg}`;
    if (!stats[key]) stats[key] = { region, typologi: deg, pop: 0 };
    stats[key].pop += c.pop;
    regionTotals[region] = (regionTotals[region] || 0) + c.pop;
  }

  // Add Riket
  const riketStats = {};
  for (const s of Object.values(stats)) {
    if (!riketStats[s.typologi]) riketStats[s.typologi] = { region: "Riket", typologi: s.typologi, pop: 0 };
    riketStats[s.typologi].pop += s.pop;
  }
  const riketTotal = Object.values(riketStats).reduce((s, r) => s + r.pop, 0);
  regionTotals["Riket"] = riketTotal;

  const allStats = [
    ...Object.values(stats),
    ...Object.values(riketStats)
  ];

  const degurbaOrder = ["Tätbefolkade områden", "Medelbefolkade områden", "Glesbefolkade områden"];
  const result = allStats.map(s => ({
    region: s.region,
    typologi: s.typologi,
    andel: Math.round(s.pop / regionTotals[s.region] * 1000) / 10
  }));

  result.sort((a, b) => {
    if (a.region !== b.region) return a.region.localeCompare(b.region, "sv");
    return degurbaOrder.indexOf(a.typologi) - degurbaOrder.indexOf(b.typologi);
  });

  const degurbaJsonPath = path.join(processedDir, "02-degurba.json");
  fs.writeFileSync(degurbaJsonPath, JSON.stringify(result, null, 2));
  console.log(`     → ${result.length} rader`);
  console.log("6/6  Klar!");
}
