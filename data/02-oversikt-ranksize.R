# =============================================================================
# 02-OVERSIKT-RANKSIZE.R
# Rank-size: kumulativ andel av länsbefolkning, topp 10 tätorter per region
# Output: data/processed/02-ranksize.json
# =============================================================================

library(readxl)
library(sf)
library(dplyr)
library(jsonlite)

out_dir <- here::here("data", "processed")

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
# TOTAL BEFOLKNING PER REGION
# =============================================================================
message("Hämtar totalbefolkning per region...")
bef_reg <- read_excel(here::here("data", "data_oversikt_kap1.xlsx"),
                      sheet = "befthathet_region")
bef_reg <- bef_reg[bef_reg$Variabel == "Folkmängd", ]
bef_reg$lnkod <- trimws(substr(bef_reg$Region, 1, 2))
bef_reg$totpop <- as.numeric(bef_reg[["2024.0"]])
totpop <- bef_reg[bef_reg$lnkod != "00", c("lnkod", "totpop")]

# =============================================================================
# TÄTORTSNAMN från shapefil
# =============================================================================
message("Läser tätortsnamn från shapefil...")
shape <- st_read(here::here("shape", "Tatorter_2023.gpkg"), quiet = TRUE)
namn_map <- shape %>%
  st_drop_geometry() %>%
  distinct(tatortskod, .keep_all = TRUE) %>%
  select(tatortskod, tatort)

# =============================================================================
# TÄTORTSDATA
# =============================================================================
message("Läser tätortsdata...")
tatort_raw <- read_excel(here::here("data", "tatorter2024.xlsx"))

tatort_agg <- tatort_raw %>%
  filter(Tatort_2023 != "0000T0000") %>%
  group_by(Lan, Tatort_2023) %>%
  summarise(befolkning = sum(Antal, na.rm = TRUE), .groups = "drop") %>%
  left_join(lan_lookup, by = c("Lan" = "lnkod")) %>%
  left_join(namn_map, by = c("Tatort_2023" = "tatortskod")) %>%
  left_join(totpop, by = c("Lan" = "lnkod")) %>%
  filter(!is.na(region))

# Specialfall: Göteborgs tätort i Halland
tatort_agg <- tatort_agg %>%
  mutate(tatort = case_when(
    Tatort_2023 == "1480TC108" & Lan == "13" ~ "Kungsbacka (GBG)",
    is.na(tatort) ~ Tatort_2023,
    TRUE ~ tatort
  ))

# =============================================================================
# RANK + KUMULATIV ANDEL
# =============================================================================
message("Beräknar kumulativ andel...")
ranked <- tatort_agg %>%
  group_by(region) %>%
  arrange(desc(befolkning), .by_group = TRUE) %>%
  mutate(
    rank = row_number(),
    kum_andel = cumsum(befolkning) / totpop * 100
  ) %>%
  ungroup()

# =============================================================================
# EXPORTERA TOPP 10
# =============================================================================
message("Exporterar topp 10 per region...")
ranksize_out <- ranked %>%
  filter(rank <= 10) %>%
  select(region, rank, tatort, befolkning, kum_andel) %>%
  mutate(kum_andel = round(kum_andel, 1)) %>%
  arrange(region, rank)

write_json(ranksize_out, file.path(out_dir, "02-ranksize.json"))
message("   Skrev ", file.path(out_dir, "02-ranksize.json"))

# Visa Halland
message("\n=== Halland topp 10 ===")
hal <- ranksize_out[ranksize_out$region == "Halland", ]
for (i in seq_len(nrow(hal))) {
  message(sprintf("   %2d. %-25s %6d  kum: %.1f%%",
                  hal$rank[i], hal$tatort[i], hal$befolkning[i], hal$kum_andel[i]))
}

# Visa några jämförelseregioner
for (reg in c("Örebro", "Västmanland", "Västra Götaland")) {
  message(sprintf("\n=== %s topp 5 ===", reg))
  r <- ranked[ranked$region == reg & ranked$rank <= 5, ]
  for (i in seq_len(nrow(r))) {
    message(sprintf("   %2d. %-25s %6d  kum: %.1f%%",
                    r$rank[i], r$tatort[i], r$befolkning[i], r$kum_andel[i]))
  }
}

message("\nKlart!")
