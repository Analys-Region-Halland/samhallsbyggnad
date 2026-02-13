# =============================================================================
# 02-OVERSIKT-STADLAND.R
# Tätortsgrad per region: andel av befolkningen som bor i tätort
# Källa: SCB tätorter 2023, befolkning 2024
# Output: data/processed/02-tatortsgrad.json
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
# TÄTORTSDATA
# =============================================================================
message("Läser tätortsdata...")
tatort_raw <- read_excel(file.path(proj_dir, "data", "tatorter2024.xlsx"))

# Total befolkning per län (alla rader inkl. ej tätort)
total_per_lan <- tatort_raw %>%
  group_by(Lan) %>%
  summarise(total_bef = sum(Antal, na.rm = TRUE), .groups = "drop")

# Tätortsbefolkning per län (exklusive "ej tätort")
tat_per_lan <- tatort_raw %>%
  filter(Tatort_2023 != "0000T0000") %>%
  group_by(Lan) %>%
  summarise(tat_bef = sum(Antal, na.rm = TRUE), .groups = "drop")

# Joina och beräkna tätortsgrad
result <- total_per_lan %>%
  left_join(tat_per_lan, by = "Lan") %>%
  left_join(lan_lookup, by = c("Lan" = "lnkod")) %>%
  filter(!is.na(region)) %>%
  mutate(tatortsgrad = round(tat_bef / total_bef * 100, 1)) %>%
  select(region, tatortsgrad) %>%
  arrange(desc(tatortsgrad))

# Rikssnitt
riks_total <- sum(total_per_lan$total_bef[total_per_lan$Lan %in% lan_lookup$lnkod])
riks_tat <- sum(tat_per_lan$tat_bef[tat_per_lan$Lan %in% lan_lookup$lnkod])
riks_grad <- round(riks_tat / riks_total * 100, 1)

message(sprintf("Riksgenomsnitt tätortsgrad: %.1f%%", riks_grad))

# =============================================================================
# EXPORTERA
# =============================================================================
write_json(result, file.path(out_dir, "02-tatortsgrad.json"), pretty = TRUE)
message("Skrev ", file.path(out_dir, "02-tatortsgrad.json"))

message("\n=== Tätortsgrad per region ===")
for (i in seq_len(nrow(result))) {
  r <- result[i, ]
  message(sprintf("   %2d. %-20s %.1f%%", i, r$region, r$tatortsgrad))
}

message("Klart!")
