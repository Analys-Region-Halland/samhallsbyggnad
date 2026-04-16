# =============================================================================
# RENDER - Samhällsbyggnad
# =============================================================================
# Kör hela detta skript: Ctrl+Shift+Enter (RStudio)

# Stoppa eventuell tidigare preview
try(quarto::quarto_preview_stop(), silent = TRUE)
Sys.sleep(1)

# Preview (väljer automatiskt ledig port)
quarto::quarto_preview("index.qmd", browse = TRUE)
