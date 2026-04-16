###### Paket ######

install.packages(c("sf", "rmapshaper", "jsonlite", "tidyverse", "mapgl"))

# walkerke/pmtiles — PMTiles-servering/visning, buntad go-pmtiles-binär
install.packages(
  "pmtiles",
  repos = c("https://walkerke.r-universe.dev", "https://cloud.r-project.org")
)

unlink("C:/Users/Robin Rikardsson/AppData/Local/R/win-library/4.5/Rcpp", recursive = TRUE)
install.packages("Rcpp")