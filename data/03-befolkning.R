# =============================================================================
# DATABEARBETNING - Kapitel 3: Befolkning
# =============================================================================
# Kör detta skript för att generera JSON-data till visualiseringarna
#
# Input:
#   data/befkommun6824.xlsx        — SCB folkmängd per kommun 1968–2024
#   data/data_befutv.xlsx          — SCB befolkningsutveckling 1969–2024
#   data/radata-bef2025.rds        — SCB folkmängd 2025 (hämtad via hamta-bef2025.R)
#   data/NUTS_kommuner_Sverige.xlsx — NUTS-klassificering kommun → län
#
# Output:
#   data/processed/kommuner.json              — 6 Hallandskommuner (stapeldiagram)
#   data/processed/03-beeswarm-kommuner.json  — alla 290 kommuner + Sverige-snitt
#   data/processed/03-befutv-regioner.json    — 21 regioner + Riket, 1969–2025
#   data/processed/03-befutv-kommuner.json    — 6 Hallandskommuner, 1969–2025

library(readxl)
library(jsonlite)
library(dplyr)
library(stringr)
library(tidyr)
library(tibble)

output_dir <- here::here("data", "processed")

# =============================================================================
# 0. Läs in 2025 från SCB-uttag och bygg lookup-tabeller
# =============================================================================
bef2025 <- readRDS(here::here("data", "radata-bef2025.rds"))

# Lookup: kommunkod (4 siffror) → folkmängd 2025
bef2025_komm <- bef2025 |>
  filter(nchar(kommunkod) == 4) |>
  select(kommunkod, befolkning) |>
  deframe()

# Lookup: länskod (2 siffror) → folkmängd 2025
bef2025_lan <- bef2025 |>
  filter(nchar(kommunkod) == 2) |>
  select(kommunkod, befolkning) |>
  deframe()

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

# Lägg till 2025 som ny kolumn baserat på SCB-uttag
bef_raw[["2025"]] <- bef2025_komm[str_extract(bef_raw$region, "^\\d{4}")]

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
  select(kommunkod, kommun, befolkning = `2025`) |>
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
  select(kommun, befolkning = `2025`) |>
  mutate(befolkning = as.integer(befolkning))

write_json(halland, file.path(output_dir, "kommuner.json"), pretty = TRUE)
message("Kommuner (Halland): ", nrow(halland), " rader")

# =============================================================================
# 5. Befolkningsutveckling — Regioner (1969–2024)
# =============================================================================
reg_raw <- read_excel(
  here::here("data", "data_befutv.xlsx"),
  sheet = "reg_bef_6924"
)

# Lägg till 2025 baserat på SCB-uttag (länskod är 2-siffrig leading-prefix i Region)
reg_raw[["2025"]] <- bef2025_lan[
  str_pad(str_extract(reg_raw$Region, "^\\d+"), 2, pad = "0")
]

# Rensa regionnamn: "01 Stockholms län" → "Stockholm"
reg <- reg_raw |>
  mutate(
    region = Region |>
      str_remove("^\\d+\\s+") |>
      str_remove("s län$") |>
      str_remove(" län$")
  ) |>
  select(-Region) |>
  pivot_longer(
    cols = -region,
    names_to = "år",
    values_to = "befolkning"
  ) |>
  mutate(
    år = as.integer(round(as.numeric(år))),
    befolkning = as.integer(befolkning)
  )

# Beräkna "Riket" som summa av alla 21 regioner per år
riket <- reg |>
  summarise(befolkning = sum(befolkning), .by = år) |>
  mutate(region = "Riket")

reg_all <- bind_rows(reg, riket)

# Beräkna index (bas 100 = 1969)
bas1969 <- reg_all |>
  filter(år == 1969) |>
  select(region, bas = befolkning)

reg_index <- reg_all |>
  left_join(bas1969, by = "region") |>
  mutate(index = round(befolkning / bas * 100, 1)) |>
  select(år, region, befolkning, index)

write_json(reg_index, file.path(output_dir, "03-befutv-regioner.json"), pretty = TRUE)
message("Befutv regioner: ", n_distinct(reg_index$region), " regioner × ",
        n_distinct(reg_index$år), " år = ", nrow(reg_index), " rader")

# =============================================================================
# 6. Befolkningsutveckling — Hallands kommuner (1969–2024)
# =============================================================================
kom_raw <- read_excel(
  here::here("data", "data_befutv.xlsx"),
  sheet = "kom_bef_6924"
)

# Lägg till 2025 baserat på SCB-uttag (kommunkod är 4-siffrig prefix i Region)
kom_raw[["2025"]] <- bef2025_komm[str_extract(kom_raw$Region, "^\\d{4}")]

# Plocka ut kommunkod, joina med NUTS för att hitta Halland
kom <- kom_raw |>
  mutate(kommunkod = str_extract(Region, "^\\d{4}")) |>
  filter(!is.na(kommunkod)) |>
  left_join(nuts |> select(kommunkod, län), by = "kommunkod") |>
  filter(län == "Halland") |>
  mutate(kommun = str_remove(Region, "^\\d+\\s+")) |>
  select(-Region, -kommunkod, -län) |>
  pivot_longer(
    cols = -kommun,
    names_to = "år",
    values_to = "befolkning"
  ) |>
  mutate(
    år = as.integer(round(as.numeric(år))),
    befolkning = as.integer(befolkning)
  )

# Beräkna index (bas 100 = 1969)
kom_bas <- kom |>
  filter(år == 1969) |>
  select(kommun, bas = befolkning)

kom_index <- kom |>
  left_join(kom_bas, by = "kommun") |>
  mutate(index = round(befolkning / bas * 100, 1)) |>
  select(år, kommun, befolkning, index)

write_json(kom_index, file.path(output_dir, "03-befutv-kommuner.json"), pretty = TRUE)
message("Befutv kommuner: ", n_distinct(kom_index$kommun), " kommuner × ",
        n_distinct(kom_index$år), " år = ", nrow(kom_index), " rader")

# =============================================================================
# 7. Befolkningsutveckling — Alla kommuner + Riket (1969–2024)
#    Används som bakgrundsreferens i kommundiagrammet
# =============================================================================
alla_kom <- kom_raw |>
  mutate(kommunkod = str_extract(Region, "^\\d{4}")) |>
  filter(!is.na(kommunkod)) |>
  mutate(kommun = str_remove(Region, "^\\d+\\s+")) |>
  select(-Region) |>
  pivot_longer(
    cols = -c(kommun, kommunkod),
    names_to = "år",
    values_to = "befolkning"
  ) |>
  mutate(
    år = as.integer(round(as.numeric(år))),
    befolkning = as.integer(befolkning)
  )

# Filtrera bort kommuner som saknar data för samtliga år
n_years <- n_distinct(alla_kom$år)
komplett <- alla_kom |>
  filter(!is.na(befolkning)) |>
  count(kommun) |>
  filter(n == n_years) |>
  pull(kommun)

alla_kom <- alla_kom |>
  filter(kommun %in% komplett) |>
  select(-kommunkod)

# Lägg till Riket som referens
riket_kom <- riket |>
  mutate(kommun = "Riket") |>
  select(år, kommun, befolkning)
alla_kom <- bind_rows(alla_kom, riket_kom)

# Beräkna index (bas 100 = 1969)
alla_bas <- alla_kom |>
  filter(år == 1969) |>
  select(kommun, bas = befolkning)

alla_index <- alla_kom |>
  left_join(alla_bas, by = "kommun") |>
  mutate(index = round(befolkning / bas * 100, 1)) |>
  select(år, kommun, befolkning, index)

write_json(alla_index, file.path(output_dir, "03-befutv-alla-kommuner.json"), pretty = TRUE)
message("Befutv alla kommuner: ", n_distinct(alla_index$kommun), " kommuner × ",
        n_distinct(alla_index$år), " år = ", nrow(alla_index), " rader")

message("Data exporterad till: ", output_dir)

# =============================================================================
# 8. Kust vs Inland — befolkningsfördelning 2000/2010/2024
# =============================================================================
kust_inland <- readRDS(here::here("data", "bef_kust_inland.rds")) |>
  filter(del != "Utanför") |>
  group_by(År) |>
  mutate(andel = round(100 * n_personer / sum(n_personer), 1)) |>
  ungroup() |>
  rename(år = År, befolkning = n_personer) |>
  select(år, del, befolkning, andel)

write_json(kust_inland, file.path(output_dir, "03-kust-inland.json"), pretty = TRUE)
message("Kust/inland: ", nrow(kust_inland), " rader")

# =============================================================================
# 9. Tätorter i Halland — befolkning 2000/2010/2024
# =============================================================================
tatorter_hal <- readRDS(here::here("data", "bef_tatorter.rds")) |>
  rename(år = År, tatort = tatort, kommun = kommunnamn, befolkning = n_personer) |>
  select(år, tatort, kommun, befolkning)

write_json(tatorter_hal, file.path(output_dir, "03-tatorter.json"), pretty = TRUE)
message("Tätorter: ", n_distinct(tatorter_hal$tatort), " tätorter × ",
        n_distinct(tatorter_hal$år), " år = ", nrow(tatorter_hal), " rader")

# =============================================================================
# 10. Nordregio-typologi — Halland, befolkning per typologiklass 2000/2010/2024
# =============================================================================
# VIKTIGT — LÄS INNAN DU ÄNDRAR DET HÄR BLOCKET:
#
# Källan är `data/bef_nordregio.rds` — ett MANUELLT uttag från SCB STATIV
# (100 m-rutor) där varje 100 m-ruta klassats med Nordregios urban-rurala
# klassning från motsvarande 1 km-ruta. Resultatet har år 2000, 2010, 2024.
#
# Tabellen har inget skript som genererar den; den är ett engångsuttag som
# ligger på disk. Om STATIV-tidsserien ska uppdateras måste det uttaget
# göras om manuellt — det finns ingen automatiserad pipeline för det.
#
# Tidigare versioner av det här blocket läste från `nordregio_sverige.csv`
# (Nordregios egen publicerade data) och gav år jan08/jan22. Det MATCHAR
# INTE rapporttexten i sektioner/03-befolkning.qmd, som redovisar
# förändring 2000→2024. Att köra fel version skriver över rätt JSON och
# förstör figuren "Befolkningsförändring per urban-rural typologi".
#
# Alltså: läs ALLTID från bef_nordregio.rds här. Aldrig från CSV.
# =============================================================================

nordregio_hal <- readRDS(here::here("data", "bef_nordregio.rds"))

typologi_sv <- c(
  "Utanför klassificering"        = "Utanför klassificering",
  "Inner urban area"              = "Innerstad",
  "Outer urban area"              = "Ytterstad",
  "Peri-urban area"               = "Stadsnära",
  "Rural area close to urban"     = "Tätortsnära landsbygd",
  "Local centre in rural area"    = "Lokalt centrum",
  "Rural heartland"               = "Landsbygd",
  "Sparsely populated rural area" = "Gles landsbygd"
)

# Ordning från urban till rural
typologi_ordning <- c("Innerstad", "Ytterstad", "Stadsnära",
                      "Tätortsnära landsbygd", "Lokalt centrum",
                      "Landsbygd", "Gles landsbygd",
                      "Utanför klassificering")

nordregio_hal <- nordregio_hal |>
  transmute(
    typologi   = typologi_sv[title],
    år         = År,
    befolkning = n_personer
  ) |>
  mutate(ord = match(typologi, typologi_ordning)) |>
  arrange(år, ord) |>
  select(typologi, år, befolkning)

write_json(nordregio_hal, file.path(output_dir, "03-nordregio-halland.json"),
           pretty = TRUE, auto_unbox = TRUE)
message("Nordregio Halland (STATIV-källa): ",
        n_distinct(nordregio_hal$typologi), " klasser × ",
        n_distinct(nordregio_hal$år), " år = ",
        nrow(nordregio_hal), " rader")
