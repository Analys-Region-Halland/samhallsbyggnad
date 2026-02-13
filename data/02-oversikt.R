# =============================================================================
# 02-OVERSIKT.R
# Bygger geodata för Översikt-kapitlets karta: Sydsverige
# Kommuner (med län-attribut), tätorter, vägnät, järnväg
# Län-gränser deriveras i JS från kommun-lagret (perfekt alignment)
# =============================================================================

library(sf)
library(rmapshaper)
library(jsonlite)

# Sökvägar
shape_dir <- here::here("shape")
out_dir   <- here::here("data", "processed")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)

# Län som ingår i Sydsverige-kartan
sydsverige_lnkod <- c("13", "14", "12", "10", "07", "06", "08")
sydsverige_lan   <- c("Halland", "Västra Götaland", "Skåne",
                       "Blekinge", "Kronoberg", "Jönköping", "Kalmar")

# Län-namn lookup
lan_lookup <- c(
  "06" = "Jönköping", "07" = "Kronoberg", "08" = "Kalmar",
  "10" = "Blekinge", "12" = "Skåne", "13" = "Halland", "14" = "Västra Götaland"
)

# =============================================================================
# 1. KOMMUNER (ingen ms_simplify — shapefilen är redan generaliserad)
# =============================================================================
message("1. Kommuner...")
kommuner <- st_read(file.path(shape_dir, "Kommun_Sweref99TM.shp"), quiet = TRUE)
kommuner <- kommuner[substr(kommuner$KnKod, 1, 2) %in% sydsverige_lnkod, ]
# Lägg till län-attribut (används för gränsderivering i JS)
kommuner$LnKod  <- substr(kommuner$KnKod, 1, 2)
kommuner$LnNamn <- lan_lookup[kommuner$LnKod]
message("   ", nrow(kommuner), " kommuner")

# =============================================================================
# 2. TÄTORTER - Göteborg-split + befolkningsdata 2024
# =============================================================================
message("2. Tätorter...")
tatorter <- st_read(file.path(shape_dir, "Tatorter_2023.gpkg"), quiet = TRUE)
tatorter <- tatorter[tatorter$lannamn %in% sydsverige_lan, ]
tatorter <- tatorter[, c("tatortskod", "tatort", "kommunnamn", "lan", "lannamn", "bef")]

# --- Göteborg-split: Hallands-delen → "Kungsbacka (GBG)" ---
gbg_idx <- which(tatorter$tatortskod == "1480TC108")
if (length(gbg_idx) > 0) {
  message("   Splittrar Göteborg...")
  gbg_feat <- tatorter[gbg_idx, ]

  # Hallands gräns (dissolve av hallandskommuner, matchad CRS)
  halland_komm <- st_transform(kommuner[kommuner$LnKod == "13", ], st_crs(tatorter))
  halland_union <- st_union(halland_komm)

  # Klipp ut Hallands-delen
  kungsbacka_part <- st_intersection(gbg_feat, halland_union)
  kungsbacka_part <- kungsbacka_part[!st_is_empty(kungsbacka_part), ]
  if (nrow(kungsbacka_part) > 0) {
    kungsbacka_part$tatort     <- "Kungsbacka (GBG)"
    kungsbacka_part$kommunnamn <- "Kungsbacka"
    kungsbacka_part$lan        <- "13"
    kungsbacka_part$lannamn    <- "Halland"
    message("   Kungsbacka (GBG): ", nrow(kungsbacka_part), " geometri(er)")

    # Resten av Göteborg (utanför Halland)
    gbg_rest <- st_difference(gbg_feat, halland_union)
    gbg_rest <- gbg_rest[!st_is_empty(gbg_rest), ]

    # Ersätt original-Göteborg med de två delarna
    tatorter <- tatorter[-gbg_idx, ]
    tatorter <- rbind(tatorter, gbg_rest, kungsbacka_part)
  }
}

# --- Joina befolkningsdata från tatorter2024.xlsx ---
library(readxl)
bef_xlsx <- read_excel(file.path(here::here(), "data", "tatorter2024.xlsx"))

# Aggregera per tätort + län (xlsx har per-kommun-uppdelning)
bef_agg <- bef_xlsx |>
  dplyr::group_by(Tatort_2023, Lan) |>
  dplyr::summarise(bef_2024 = sum(Antal, na.rm = TRUE), .groups = "drop")

# Joina på tatortskod + län (fångar Kungsbacka GBG via kod+13)
tatorter <- dplyr::left_join(
  tatorter, bef_agg,
  by = c("tatortskod" = "Tatort_2023", "lan" = "Lan")
)
message("   Befolkning 2024 joinad: ", sum(!is.na(tatorter$bef_2024)),
        " av ", nrow(tatorter), " tätorter")

# Använd 2024-data om tillgänglig, annars behåll 2023
tatorter$bef <- ifelse(!is.na(tatorter$bef_2024), tatorter$bef_2024, tatorter$bef)
tatorter$bef_2024 <- NULL
tatorter$tatortskod <- NULL
tatorter$lan <- NULL

# Filtrera och förenkla
tatorter <- tatorter[, c("tatort", "kommunnamn", "lannamn", "bef")]
tatorter <- tatorter[tatorter$bef >= 2000, ]
tatorter <- ms_simplify(tatorter, keep = 0.12, keep_shapes = TRUE)
message("   ", nrow(tatorter), " tätorter (bef >= 2000)")

# =============================================================================
# 3. VÄGNÄT - berika med NVDB-vägnamn för Hallands stora vägar
# =============================================================================
message("3. Vägnät...")
vagnat <- st_read(file.path(shape_dir, "funktionellt_vagnat2026_2071.gpkg"), quiet = TRUE)
vagnat <- vagnat[, c("ELEMENT_ID", "Fpv_klass")]
message("   Vägklasser: ", paste(sort(unique(vagnat$Fpv_klass)), collapse = ", "))
message("   FPV-segment: ", nrow(vagnat))

# Läs NVDB Vagnummer (Halland), filtrera till alla numrerade vägar i FPV
nvdb_vag <- st_read(file.path(shape_dir, "Hallands_NVDB.gpkg"),
                    layer = "NVDB_DK_O_111_Vagnummer", quiet = TRUE)
major <- nvdb_vag[nvdb_vag$Europavag == "Ja" | !is.na(nvdb_vag$Huvudnummer), ]
message("   NVDB numrerade vägar: ", nrow(major), " segment")

# Skapa vägnamn per ELEMENT_ID (E-vägar först, sedan numeriskt)
namn_df <- major |>
  sf::st_drop_geometry() |>
  dplyr::mutate(
    Vagnamn = ifelse(Europavag == "Ja",
                     paste0("E", Huvudnummer),
                     paste0("V\u00e4g ", Huvudnummer)),
    sort_key = ifelse(Europavag == "Ja", Huvudnummer, 1000 + Huvudnummer)
  ) |>
  dplyr::distinct(ELEMENT_ID, Vagnamn, sort_key) |>
  dplyr::arrange(ELEMENT_ID, sort_key) |>
  dplyr::group_by(ELEMENT_ID) |>
  dplyr::summarise(Vagnamn = paste(Vagnamn, collapse = "/"), .groups = "drop") |>
  dplyr::select(ELEMENT_ID, Vagnamn)

message("   Unika ELEMENT_ID med namn: ", nrow(namn_df))
message("   Vägnamn: ", paste(sort(unique(namn_df$Vagnamn)), collapse = ", "))

# Joina vägnamn till FPV
vagnat <- dplyr::left_join(vagnat, namn_df, by = "ELEMENT_ID")
message("   FPV med namn: ", sum(!is.na(vagnat$Vagnamn)), " av ", nrow(vagnat))

# Dissolve: namngivna vägar per Vagnamn, onamngivna per Fpv_klass
# För namngivna vägar: välj högsta FPV-klass (Nationella > Regionalt > Kompletterande)
klass_prio <- c("Nationella v\u00e4gar" = 1,
                "Regionalt viktiga v\u00e4gar" = 2,
                "Kompletterande regionalt viktiga v\u00e4gar" = 3)
vagnat$klass_rank <- klass_prio[vagnat$Fpv_klass]
vagnat$dissolve_key <- ifelse(!is.na(vagnat$Vagnamn), vagnat$Vagnamn, vagnat$Fpv_klass)
vagnat <- vagnat |>
  dplyr::group_by(dissolve_key) |>
  dplyr::arrange(klass_rank, .by_group = TRUE) |>
  dplyr::summarise(
    Fpv_klass = dplyr::first(Fpv_klass),
    Vagnamn   = dplyr::first(Vagnamn),
    do_union  = TRUE,
    .groups   = "drop"
  )
vagnat$dissolve_key <- NULL

vagnat <- ms_simplify(vagnat, keep = 0.05, keep_shapes = TRUE)
message("   ", nrow(vagnat), " vägfeatures (namngivna + klassgrupperade)")

# =============================================================================
# 4. JÄRNVÄG - öppna i södra Sverige, dissolve per sträcka
# =============================================================================
message("4. Järnväg...")
jarnvag_lan <- paste0(sydsverige_lan, "s län")
jarnvag_lan[sydsverige_lan == "Skåne"]   <- "Skåne län"
jarnvag_lan[sydsverige_lan == "Blekinge"] <- "Blekinge län"
jarnvag_lan[sydsverige_lan == "Halland"]  <- "Hallands län"
jarnvag_lan[sydsverige_lan == "Kalmar"]   <- "Kalmar län"

jarnvag <- st_read(
  file.path(shape_dir, "Järnvägsnät_grundegenskaper3_0_GeoPackage.gpkg"),
  quiet = TRUE
)
jarnvag <- jarnvag[!is.na(jarnvag$Status) & jarnvag$Status == "Öppen", ]
jarnvag <- jarnvag[jarnvag$Lan %in% jarnvag_lan, ]
jarnvag <- jarnvag[, "Straknamn"]
jarnvag <- jarnvag |>
  dplyr::group_by(Straknamn) |>
  dplyr::summarise(do_union = TRUE, .groups = "drop")
jarnvag <- ms_simplify(jarnvag, keep = 0.05, keep_shapes = TRUE)
message("   ", nrow(jarnvag), " järnvägssträckor")

# =============================================================================
# 5. KOMBINERA till TopoJSON (4 lager, inget separat län-lager)
# =============================================================================
message("5. Skriver TopoJSON...")

# Strippa CRS (förhindrar WGS84-konvertering)
st_crs(kommuner) <- NA
st_crs(tatorter) <- NA
st_crs(vagnat)   <- NA
st_crs(jarnvag)  <- NA

tmp <- tempdir()
st_write(kommuner, file.path(tmp, "kommuner.geojson"), delete_dsn = TRUE, quiet = TRUE)
st_write(tatorter, file.path(tmp, "tatorter.geojson"), delete_dsn = TRUE, quiet = TRUE)
st_write(vagnat,   file.path(tmp, "vagnat.geojson"),   delete_dsn = TRUE, quiet = TRUE)
st_write(jarnvag,  file.path(tmp, "jarnvag.geojson"),  delete_dsn = TRUE, quiet = TRUE)

tmp_files <- c("kommuner", "tatorter", "vagnat", "jarnvag")
for (nm in tmp_files) {
  src <- file.path(tmp, paste0(nm, ".geojson"))
  dst <- file.path(out_dir, paste0("_tmp_", nm, ".geojson"))
  file.copy(src, dst, overwrite = TRUE)
}

message("   GeoJSON-filer klara.")
message("   Kör sedan i terminalen:")
message("   cd \"", here::here(), "\" && npx mapshaper \\")
message("     -i combine-files \\")
message("       data/processed/_tmp_kommuner.geojson \\")
message("       data/processed/_tmp_tatorter.geojson \\")
message("       data/processed/_tmp_vagnat.geojson \\")
message("       data/processed/_tmp_jarnvag.geojson \\")
message("     -rename-layers kommuner,tatorter,vagnat,jarnvag \\")
message("     -o data/processed/02-sydsverige.topojson format=topojson quantization=1e6")
