# publicera.R — Sätt upp git, pusha till GitHub och publicera via gh-pages
# Kör rad för rad i RStudio (Ctrl+Enter)
# OBS: rapport.qmd heter nu index.qmd (Quartos krav för website-projekt)

# ── 1. Git-identitet (ändra till din email) ──────────────────────────────────
system('git config --global user.name "Robin Kronoberg"')
system('git config --global user.email "robin.kronoberg@gmail.com"')  # <-- ÄNDRA

# ── 2. Stagea nya/ändrade filer och committa ─────────────────────────────────
setwd("C:/Users/Robin Rikardsson/Desktop/Rprojekt/samhallsbyggnad")
system("git add -A")
system('git commit -m "Initial commit: Samhällsbyggnad i Halland"')

# ── 3. Koppla till GitHub och pusha ──────────────────────────────────────────
system("git branch -M main")
system("git remote add origin https://github.com/robinkronoberg/samhallsbyggnad.git")
system("git push -u origin main")

# ── 4. Publicera till GitHub Pages ───────────────────────────────────────────
# Första gången: utan --no-prompt så Quarto kan skapa gh-pages-branchen
# Kör denna rad i RStudio TERMINAL (inte konsolen), den behöver interaktiv input
# quarto publish gh-pages

# Klar! Sidan hamnar på:
# https://robinkronoberg.github.io/samhallsbyggnad/
