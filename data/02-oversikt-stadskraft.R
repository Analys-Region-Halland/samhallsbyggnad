# =============================================================================
# 02-OVERSIKT-STADSKRAFT.R
# Exporterar alla tätorter >= 3 000 inv med namn och län
# Output: data/processed/02-tatorter-beeswarm.json
# =============================================================================

library(readxl)
library(dplyr)
library(jsonlite)

proj_dir <- getwd()
out_dir <- file.path(proj_dir, "data", "processed")

# Län-lookup
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
# TÄTORTSNAMN (extraherade från gpkg via Python → JSON)
# =============================================================================
message("Läser tätortsnamn...")
namn_list <- fromJSON(file.path(out_dir, "tatort_namn.json"))
namn_map <- data.frame(
  tatortskod = names(namn_list),
  tatort = unlist(namn_list),
  stringsAsFactors = FALSE
)

# =============================================================================
# TÄTORTSDATA
# =============================================================================
message("Läser tätortsdata...")
tatort_raw <- read_excel(file.path(proj_dir, "data", "tatorter2024.xlsx"))

tatort_agg <- tatort_raw %>%
  filter(Tatort_2023 != "0000T0000") %>%
  group_by(Lan, Tatort_2023) %>%
  summarise(befolkning = sum(Antal, na.rm = TRUE), .groups = "drop") %>%
  left_join(lan_lookup, by = c("Lan" = "lnkod")) %>%
  left_join(namn_map, by = c("Tatort_2023" = "tatortskod")) %>%
  filter(!is.na(region), befolkning >= 3000)

# Specialfall: Göteborgs tätort i Halland
tatort_agg <- tatort_agg %>%
  mutate(tatort = case_when(
    Tatort_2023 == "1480TC108" & Lan == "13" ~ "Kungsbacka (GBG)",
    is.na(tatort) ~ Tatort_2023,
    TRUE ~ tatort
  ))

message("   Tätorter >= 3 000 inv: ", nrow(tatort_agg))

# =============================================================================
# EXPORTERA FÖR BEESWARM FACET
# =============================================================================
beeswarm_out <- tatort_agg %>%
  select(tatort, region, befolkning) %>%
  arrange(region, desc(befolkning))

write_json(beeswarm_out, file.path(out_dir, "02-tatorter-beeswarm.json"), pretty = TRUE)
message("Skrev ", file.path(out_dir, "02-tatorter-beeswarm.json"))

# Sammanfattning per region
message("\n=== Tätorter per region ===")
region_summary <- tatort_agg %>%
  group_by(region) %>%
  summarise(n = n(), storst = max(befolkning), .groups = "drop") %>%
  arrange(desc(storst))
for (i in seq_len(nrow(region_summary))) {
  r <- region_summary[i, ]
  message(sprintf("   %-20s %3d tätorter  störst: %6d", r$region, r$n, r$storst))
}

message("Klart!")
