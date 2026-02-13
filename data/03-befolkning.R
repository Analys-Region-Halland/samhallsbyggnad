# =============================================================================
# DATABEARBETNING - Kapitel 3: Befolkning
# =============================================================================
# Kör detta skript för att generera JSON-data till visualiseringarna
#
# Input:
#   data/befkommun6824.xlsx       — SCB folkmängd per kommun 1968–2024
#   data/NUTS_kommuner_Sverige.xlsx — NUTS-klassificering kommun → län
#
# Output:
#   data/processed/befolkning.json           — tidsserie (behålls oförändrad)
#   data/processed/kommuner.json             — 6 Hallandskommuner (behålls)
#   data/processed/03-beeswarm-kommuner.json — alla 290 kommuner + Sverige-snitt

library(readxl)
library(jsonlite)
library(dplyr)
library(stringr)
library(tidyr)

output_dir <- here::here("data", "processed")

# =============================================================================
# 1. Läs NUTS-mappning: kommun → län
# =============================================================================
nuts <- read_excel(
  here::here("data", "NUTS_kommuner_Sverige.xlsx")
) |>
  select(
    kommunkod = Kommunkod,
    kommun_namn = Kommunnamn,
    län_raw = `NUTS3-namn (län)`
  ) |>
  mutate(
    kommunkod = str_trim(kommunkod),
    län = län_raw |>
      str_remove("s län$") |>
      str_remove(" län$")
  )

# =============================================================================
# 2. Läs befolkningsdata
# =============================================================================
bef_raw <- read_excel(
  here::here("data", "befkommun6824.xlsx"),
  skip = 1  # Hoppa över titelraden
)

# Kolumn 1 = "region" (t.ex. "0114 Upplands Väsby"), resten = årskolumner
names(bef_raw)[1] <- "region"

# Plocka ut kommunkod och kommunnamn
bef <- bef_raw |>
  mutate(
    kommunkod = str_extract(region, "^\\d{4}"),
    kommun = str_remove(region, "^\\d{4}\\s+")
  ) |>
  filter(!is.na(kommunkod))

# =============================================================================
# 3. Beeswarm-data: 290 kommuner + Sverige-snitt
# =============================================================================
beeswarm <- bef |>
  select(kommunkod, kommun, befolkning = `2024`) |>
  mutate(befolkning = as.integer(befolkning)) |>
  left_join(nuts |> select(kommunkod, län), by = "kommunkod") |>
  select(kommun, län, befolkning) |>
  filter(!is.na(befolkning))

# Sverige (snitt): 14 syntetiska punkter vid jämna kvantiler
all_pop <- sort(beeswarm$befolkning)
n_snitt <- 14
snitt <- tibble(
  kommun = paste0("Snitt K", seq_len(n_snitt)),
  län = "Sverige (snitt)",
  befolkning = all_pop[pmin(
    as.integer((seq(0.5, n_snitt - 0.5) / n_snitt) * length(all_pop)) + 1L,
    length(all_pop)
  )]
)

beeswarm_out <- bind_rows(beeswarm, snitt)

write_json(beeswarm_out, file.path(output_dir, "03-beeswarm-kommuner.json"), pretty = TRUE)
message("Beeswarm: ", nrow(beeswarm_out), " rader (", nrow(beeswarm), " kommuner + ", n_snitt, " snitt)")

# =============================================================================
# 4. Hallandskommuner (stapeldiagram)
# =============================================================================
halland <- bef |>
  left_join(nuts |> select(kommunkod, län), by = "kommunkod") |>
  filter(län == "Halland") |>
  select(kommun, befolkning = `2024`) |>
  mutate(befolkning = as.integer(befolkning))

write_json(halland, file.path(output_dir, "kommuner.json"), pretty = TRUE)
message("Kommuner (Halland): ", nrow(halland), " rader")

# =============================================================================
# 5. Befolkningsutveckling (behåll befintlig tidsserie tills vidare)
# =============================================================================
# Befintlig befolkning.json används av linjediagrammet.
# TODO: ersätt med riktig tidsserie från befkommun6824.xlsx

message("Data exporterad till: ", output_dir)
