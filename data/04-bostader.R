# =============================================================================
# DATABEARBETNING - Kapitel 4: Bostäder
# =============================================================================
# Kör detta skript för att generera JSON-data till visualiseringarna

library(jsonlite)

# Output-mapp
output_dir <- here::here("data", "processed")

# -----------------------------------------------------------------------------
# Bostadsbyggande (exempeldata)
# -----------------------------------------------------------------------------

byggande <- data.frame(
  år = rep(2015:2024, 2),
  typ = rep(c("Flerbostadshus", "Småhus"), each = 10),
  antal = c(
    # Flerbostadshus
    850, 920, 1100, 1350, 1420, 1280, 1150, 980, 890, 950,
    # Småhus
    420, 480, 520, 580, 610, 550, 490, 420, 380, 410
  )
)

write_json(byggande, file.path(output_dir, "byggande.json"), pretty = TRUE)

# -----------------------------------------------------------------------------
# Bostadsbestånd per kommun (exempeldata)
# -----------------------------------------------------------------------------

bestand <- data.frame(
  kommun = c("Halmstad", "Varberg", "Falkenberg", "Kungsbacka", "Laholm", "Hylte"),
  hyresrätt = c(18500, 9200, 6800, 8900, 3200, 1100),
  bostadsrätt = c(12300, 7100, 4200, 9800, 1800, 600),
  äganderätt = c(21200, 18500, 14200, 24500, 8900, 3800)
)

write_json(bestand, file.path(output_dir, "bestand.json"), pretty = TRUE)

message("Data exporterad till: ", output_dir)
