# =============================================================================
# 02-OVERSIKT-KONCENTRATION.R
# Koncentrationsindex (0–100) per region
# på tre geografiska nivåer: kommun, tätort, 1km-ruta
# Output: data/processed/02-koncentration.json
# =============================================================================

library(readxl)
library(sf)
library(dplyr)
library(jsonlite)

out_dir <- here::here("data", "processed")

# =============================================================================
# HJÄLPFUNKTION
# Normaliserad summa av absoluta avvikelser från perfekt jämn fördelning.
# 0 = perfekt jämnt, 100 = all befolkning i en enda enhet.
# =============================================================================
calc_concentration <- function(pop_vector) {
  pop <- pop_vector[!is.na(pop_vector)]
  if (length(pop) <= 1 || sum(pop) == 0) return(NA_real_)

  n <- length(pop)
  shares <- pop / sum(pop)
  perfect <- 1 / n

  # Summa av absoluta avvikelser från perfekt fördelning
  deviation <- sum(abs(shares - perfect))

  # Maximalt möjlig avvikelse (all befolkning i en enda enhet)
  max_deviation <- 2 * (1 - 1 / n)

  # Koncentrationsindex 0-100
  K <- (deviation / max_deviation) * 100

  return(K)
}

# Län-lookup (utan " län"-suffix, matchar rapportens stil)
lan_lookup <- data.frame(
  lnkod = c("01","03","04","05","06","07","08","09","10","12",
             "13","14","17","18","19","20","21","22","23","24","25"),
  region = c("Stockholm","Uppsala","Södermanland","Östergötland",
             "Jönköping","Kronoberg","Kalmar","Gotland","Blekinge","Skåne",
             "Halland","Västra Götaland","Värmland","Örebro","Västmanland",
             "Dalarna","Gävleborg","Västernorrland","Jämtland",
             "Västerbotten","Norrbotten"),
  stringsAsFactors = FALSE
)

# =============================================================================
# 1. KOMMUNNIVÅ — befolkning per kommun, grupperat per län
# =============================================================================
message("1. Kommunnivå...")
bef_kommun <- read_excel(here::here("data", "data_oversikt_kap1.xlsx"),
                         sheet = "beftathet_kommun")
bef_kommun <- bef_kommun[bef_kommun$Variabel == "Folkmängd", ]
bef_kommun$kommun_kod <- trimws(substr(bef_kommun$Region, 1, 4))
bef_kommun$lnkod <- substr(bef_kommun$kommun_kod, 1, 2)
bef_kommun$pop <- as.numeric(bef_kommun[["2024.0"]])

# Filtrera bort eventuella NA/0-kommuner
bef_kommun <- bef_kommun[!is.na(bef_kommun$pop) & bef_kommun$pop > 0, ]
message("   ", nrow(bef_kommun), " kommuner med befolkning")

kommun_result <- bef_kommun %>%
  group_by(lnkod) %>%
  summarise(
    n = n(),
    koncentration = calc_concentration(pop),
    .groups = "drop"
  ) %>%
  mutate(niva = "kommun")

message("   Halland kommun K: ",
        round(kommun_result$koncentration[kommun_result$lnkod == "13"], 1))

# =============================================================================
# 2. TÄTORTSNIVÅ — befolkning per tätort + rest, grupperat per län
# =============================================================================
message("2. Tätortsnivå...")
tatort <- read_excel(here::here("data", "tatorter2024.xlsx"))

# Aggregera per län + tätort (hanterar multi-kommun-tätorter)
tatort_agg <- tatort %>%
  group_by(Lan, Tatort_2023) %>%
  summarise(pop = sum(Antal, na.rm = TRUE), .groups = "drop")

# Separera tätorter från "utanför tätort"
is_outside <- tatort_agg$Tatort_2023 == "0000T0000"
tatort_in <- tatort_agg[!is_outside, ]
tatort_out <- tatort_agg[is_outside, ]

# Per region: vektor av tätortspopulationer + en "rest"-post
tatort_by_lan <- tatort_in %>%
  group_by(Lan) %>%
  summarise(
    tatort_pops = list(pop),
    n_tatorter = n(),
    .groups = "drop"
  )

rest_by_lan <- tatort_out %>%
  group_by(Lan) %>%
  summarise(rest = sum(pop), .groups = "drop")

tatort_combined <- tatort_by_lan %>%
  left_join(rest_by_lan, by = "Lan") %>%
  mutate(rest = ifelse(is.na(rest), 0, rest))

tatort_result <- tatort_combined %>%
  rowwise() %>%
  mutate(
    all_pops = list(c(unlist(tatort_pops), rest)),
    n = n_tatorter + 1L,
    koncentration = calc_concentration(c(unlist(tatort_pops), rest))
  ) %>%
  ungroup() %>%
  mutate(
    niva = "tatort",
    lnkod = Lan
  ) %>%
  select(lnkod, n, koncentration, niva)

message("   Halland tätort K: ",
        round(tatort_result$koncentration[tatort_result$lnkod == "13"], 1))

# =============================================================================
# 3. 1KM-RUTNIVÅ — spatial join mot länspolygoner
# =============================================================================
message("3. 1km-rutor (läser gpkg, kan ta en stund)...")
grid <- st_read(here::here("shape", "befolkning_1km_2024.gpkg"), quiet = TRUE)
lan_poly <- st_read(here::here("shape", "Lan_Sweref99TM_region.shp"), quiet = TRUE)
# Synka CRS (båda SWEREF99 TM men med olika metadata)
lan_poly <- st_transform(lan_poly, st_crs(grid))
message("   ", nrow(grid), " rutor laddade")

# Centroid-join (snabbare än polygon-polygon)
message("   Spatial join via centroider...")
grid_pts <- st_centroid(grid[, c("rutid_scb", "beftotalt")])
grid_joined <- st_join(grid_pts, lan_poly[, c("LnKod")], join = st_intersects)

# Hantera rutor utanför alla län (hav, gräns)
n_na <- sum(is.na(grid_joined$LnKod))
if (n_na > 0) message("   ", n_na, " rutor utanför länspolygoner (exkluderas)")
grid_joined <- grid_joined[!is.na(grid_joined$LnKod), ]

# Hämta landareal per region (för att uppskatta totalt antal celler)
lan_area_df <- read_excel(here::here("data", "data_oversikt_kap1.xlsx"),
                          sheet = "befthathet_region")
lan_area_df <- lan_area_df[lan_area_df$Variabel == "Landareal i kvadratkilometer", ]
lan_area_df$lnkod <- trimws(substr(lan_area_df$Region, 1, 2))
lan_area_df$total_cells <- round(as.numeric(lan_area_df[["2024.0"]]))
lan_area_df <- lan_area_df[lan_area_df$lnkod != "00", c("lnkod", "total_cells")]

# Gruppera per län
grid_data <- grid_joined %>%
  st_drop_geometry() %>%
  group_by(LnKod) %>%
  summarise(
    beb_pops = list(beftotalt),
    n_beb = n(),
    .groups = "drop"
  ) %>%
  left_join(lan_area_df, by = c("LnKod" = "lnkod"))

message("   Beräknar koncentration (två varianter)...")

# Beräkna båda varianter
ruta_results <- grid_data %>%
  rowwise() %>%
  mutate(
    # Variant A: alla celler (inkl tomma, n = landareal i km²)
    n_all = total_cells,
    konc_all = calc_concentration(c(unlist(beb_pops), rep(0L, max(0L, total_cells - n_beb)))),
    # Variant B: enbart bebodda celler
    konc_beb = calc_concentration(unlist(beb_pops))
  ) %>%
  ungroup()

# Platta ut till två rader per län
ruta_all <- ruta_results %>%
  transmute(
    lnkod = LnKod,
    n = n_all,
    koncentration = konc_all,
    niva = "ruta_1km"
  )

ruta_beb <- ruta_results %>%
  transmute(
    lnkod = LnKod,
    n = n_beb,
    koncentration = konc_beb,
    niva = "ruta_1km_beb"
  )

message("   Halland ruta_1km K: ",
        round(ruta_all$koncentration[ruta_all$lnkod == "13"], 1))
message("   Halland ruta_1km_beb K: ",
        round(ruta_beb$koncentration[ruta_beb$lnkod == "13"], 1))

# =============================================================================
# 4. KOMBINERA OCH EXPORTERA
# =============================================================================
message("4. Kombinerar och exporterar...")
result <- bind_rows(kommun_result, tatort_result, ruta_all, ruta_beb) %>%
  left_join(lan_lookup, by = "lnkod") %>%
  mutate(koncentration = round(koncentration, 1)) %>%
  select(lnkod, region, niva, n, koncentration) %>%
  arrange(lnkod, niva)

write_json(result, file.path(out_dir, "02-koncentration.json"), pretty = TRUE)
message("   Skrev ", file.path(out_dir, "02-koncentration.json"))

# Skriv ut Halland-rader
message("\n=== Halland ===")
hal <- result[result$lnkod == "13", ]
for (i in seq_len(nrow(hal))) {
  message(sprintf("   %-15s n=%5d  K=%.1f",
                  hal$niva[i], hal$n[i], hal$koncentration[i]))
}

message("\nKlart!")
