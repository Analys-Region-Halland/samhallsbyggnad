# =============================================================================
# BEARBETA ALL DATA
# Kör alla databearbetningsskript och exporterar JSON
# =============================================================================

library(here)

message("Bearbetar data...")

# Lista alla R-skript i data-mappen (utom detta)
skript <- list.files(
  here("data"),
  pattern = "^\\d{2}-.*\\.R$",
  full.names = TRUE
)

# Kör varje skript
for (s in skript) {
  message("  - ", basename(s))
  source(s)
}

message("Klar!")
