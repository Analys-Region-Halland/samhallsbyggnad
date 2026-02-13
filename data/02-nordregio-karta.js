#!/usr/bin/env node
// =============================================================================
// 02-NORDREGIO-KARTA.JS
// Skapar TopoJSON med Nordregio-rutnät + kommun/länsgränser
// Pipeline: CSV → GeoJSON (445k rutor) → dissolve → simplify → TopoJSON
// =============================================================================

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const projDir = path.resolve(__dirname, "..");
const csvPath = path.join(projDir, "data", "processed", "nordregio_sverige.csv");
const sverigeTopoPath = path.join(projDir, "data", "processed", "sverige.topojson");
const tmpGrid = path.join(projDir, "data", "processed", "_tmp_grid.geojson");
const outputPath = path.join(projDir, "data", "processed", "02-nordregio-karta.topojson");

console.log("1/4  Läser CSV...");
const csv = fs.readFileSync(csvPath, "utf8");
const lines = csv.split("\n");
// Header: Rut_id, kommunkod, lanskod, UrbRurTyp, jan08, jan17, jan22

console.log(`     ${lines.length - 1} rader`);

console.log("2/4  Skapar GeoJSON (1 km-rutor)...");
let featureCount = 0;

// Stream-write GeoJSON för att spara minne
const ws = fs.createWriteStream(tmpGrid);
ws.write('{"type":"FeatureCollection","features":[\n');

let first = true;
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;

  // Parse CSV (alla fält är citerade)
  const cols = line.split(",").map(s => s.replace(/"/g, ""));
  if (cols.length < 7) continue;

  const rutId = cols[0];
  const kommunkod = cols[1];
  const lanskod = cols[2];
  const typ = cols[3];
  const pop = parseInt(cols[6]) || 0;

  // Rut_id = EEEEEE + NNNNNNN (6+7 siffror, SWEREF 99 TM meter)
  const e = parseInt(rutId.substring(0, 6));
  const n = parseInt(rutId.substring(6, 13));

  if (isNaN(e) || isNaN(n)) continue;

  // 1 km ruta: [SW, SE, NE, NW, SW]
  const coords = [[
    [e, n], [e + 1000, n], [e + 1000, n + 1000], [e, n + 1000], [e, n]
  ]];

  const feature = {
    type: "Feature",
    properties: { typ, kn: kommunkod, ln: lanskod, pop },
    geometry: { type: "Polygon", coordinates: coords }
  };

  if (!first) ws.write(",\n");
  ws.write(JSON.stringify(feature));
  first = false;
  featureCount++;

  if (featureCount % 100000 === 0) {
    console.log(`     ${featureCount} features...`);
  }
}

ws.write("\n]}");
ws.end();

// Vänta tills filen är skriven
ws.on("finish", () => {
  console.log(`     ${featureCount} features skrivna`);
  const sizeMB = (fs.statSync(tmpGrid).size / 1024 / 1024).toFixed(1);
  console.log(`     GeoJSON: ${sizeMB} MB`);

  console.log("3/4  Mapshaper: dissolve + simplify...");
  // Dissolve per kommun × typologi, behåll lanskod
  // Simplify med Douglas-Peucker, behåll alla former
  // Kombinera med sverige.topojson (kommuner + län)
  const cmd = [
    `npx mapshaper "${tmpGrid}"`,
    `-dissolve typ,kn,ln`,
    `-simplify dp 15% keep-shapes`,
    `-i "${sverigeTopoPath}" combine-files`,
    `-o "${outputPath}" format=topojson target=*`,
  ].join(" ");

  try {
    console.log("     Kör:", cmd.substring(0, 120) + "...");
    execSync(cmd, {
      stdio: "inherit",
      maxBuffer: 1024 * 1024 * 200,
      timeout: 300000
    });

    // Rensa temp
    fs.unlinkSync(tmpGrid);

    const outSize = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);
    console.log(`4/4  Klar! Output: ${outSize} MB`);
    console.log(`     ${outputPath}`);
  } catch (err) {
    console.error("Mapshaper-fel:", err.message);
    process.exit(1);
  }
});
