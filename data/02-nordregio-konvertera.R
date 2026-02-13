# =============================================================================
# 02-NORDREGIO-KONVERTERA.R
# Läser Nordregios parquet, filtrerar till Sverige, exporterar CSV
# Kör detta lokalt (kräver arrow-paketet)
# install.packages("arrow")
# =============================================================================

library(arrow)
library(dplyr)

proj_dir <- getwd()

message("Läser parquet...")
df <- read_parquet(file.path(proj_dir, "shape", "nordregio_typologi.parquet"))

message("Kolumner: ", paste(names(df), collapse = ", "))
message("Rader totalt: ", nrow(df))

# Filtrera till Sverige (kommunkoder börjar med "SE")
sverige <- df %>%
  filter(grepl("^SE", codmun22)) %>%
  mutate(
    kommunkod = substr(codmun22, 3, 6),
    lanskod = substr(codmun22, 3, 4)
  ) %>%
  select(Rut_id, kommunkod, lanskod, UrbRurTyp, jan08, jan17, jan22)

message("Svenska rutor: ", nrow(sverige))
message("Unika kommuner: ", n_distinct(sverige$kommunkod))
message("Unika län: ", n_distinct(sverige$lanskod))

message("\nTypologiklasser:")
print(table(sverige$UrbRurTyp, useNA = "ifany"))

message("\nLänskoder:")
print(sort(unique(sverige$lanskod)))

# Exportera
out_path <- file.path(proj_dir, "data", "processed", "nordregio_sverige.csv")
write.csv(sverige, out_path, row.names = FALSE)
message("\nSkrev ", out_path, " (", nrow(sverige), " rader)")
