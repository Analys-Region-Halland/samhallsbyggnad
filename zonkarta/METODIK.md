# Metodik — Tätortsregioner och pendlingsflöden i Halland

## Syfte

Kartan visualiserar Hallands funktionella arbetsmarknadsgeografi i tre
nivåer: en regional helhetsbild, tätortsregioner (zoner) med intern
struktur och omvärldskopplingar, samt ortspecifika pendlingsrelationer.
Analysen bygger på SCB:s pendlingsstatistik (tätort-till-tätort) routad
på OpenStreetMap:s vägnät.

## Grunddata

| Data | Källa | Innehåll |
|------|-------|----------|
| Pendlingsflöden | SCB RAMS 2024 | OD-par: antal sysselsatta som bor i tätort A och arbetar i tätort B |
| Tätortspolygoner | SCB 2023 | Geografisk avgränsning, centroider |
| Dagbefolkning | SCB RAMS 2024 | Sysselsatt dagbefolkning per tätort (antal jobb) |
| Nattbefolkning | SCB RAMS 2024 | Sysselsatt nattbefolkning per tätort (förvärvsarbetande invånare) |
| Invånare | SCB 2024 | Total befolkning per tätort |
| Vägnät | OpenStreetMap via Geofabrik | Motorcar-nät: motorway, trunk, primary, secondary, tertiary |

Analysenheten är **tätorten** (SCB:s definition). Tätorter som spänner
över länsgräns (framför allt Göteborg) hanteras som separata noder per
länsdel.

## Två analytiska nivåer

Kartan vilar på två separata men sammanhängande klassificeringar som
använder samma pendlingsdata men med olika logik och trösklar.

### Nivå 1 — Tätortsregioner (FUA-klassning)

**Syfte:** Identifiera funktionella arbetsmarknadsområden — vilka
tätorter som graviterar mot vilken kärna.

**Metod i två steg:**

**Steg 1 — Kärnidentifiering.** En tätort klassas som ekonomiskt
centrum om dess sysselsatta dagbefolkning (antal jobb) utgör en
tillräckligt stor andel av Hallands totala dagbefolkning. Tre nivåer:

- Huvudcentrum: ≥ 20 % (Halmstad)
- Stort centrum: ≥ 8,5 % (Varberg, Falkenberg, Göteborg-delen, Kungsbacka)
- Litet centrum: ≥ 1 % (Laholm, Ullared, Hyltebruk, Ringhals, Onsala)

Validitetsregel: ett centrum som inte attraherar någon annan ort i
steg 2 uppgår i det centrum det har störst pendlingsflöde med.

**Steg 2 — Zontillhörighet (10 %-tröskel).** En tätort tillhör en
kärnas arbetsmarknadszon om minst **10 procent** av dess sysselsatta
nattbefolkning pendlar till kärnan. Tröskeln är andelsbaserad — det är
inte antalet pendlare som avgör utan hur stor del av ortens arbetskraft
som riktas mot kärnan.

Multi-membership tillåts: en ort kan tillhöra flera zoner samtidigt.
I praktiken tilldelas varje ort sin primära kärna (högsta andel).

**Resultat:** 10 tätortsregioner i Halland, varav 8 med kärna i
Halland och 2 med kärna utanför (Göteborg, Smålandsstenar).

### Nivå 2 — Utomregionala kopplingar

**Syfte:** Identifiera reella pendlingskopplingar som korsar
tätortsregionens gränser — zonens interaktion med omvärlden.

**Metod:** En koppling mellan en tätortsregion och en extern ort
definieras som reell om det sammanlagda pendlingsflödet (alla
zonmedlemmars OD-par till den externa orten, ut + in) uppgår till minst
**100 pendlare**.

Tröskeln är volymbaserad — till skillnad från den andelsbaserade
FUA-tröskeln. Motivering: utomregionala kopplingar handlar om
infrastrukturbelastning och storregional funktionalitet, inte om
enskilda orters arbetskraftsförsörjning.

**Exempel:** Om Halmstad tätort skickar 80 pendlare till Göteborg,
Getinge 15 och Oskarström 10 — totalt 105 — klassas Göteborg som en
reell koppling för Halmstads tätortsregion. Inget av OD-paren når
tröskeln ensamt, men aggregerat gör de det.

### Samspelet mellan nivåerna

De två nivåerna kompletterar varandra:

- **Nivå 1** svarar på: *var hör folk hemma funktionellt?*
  Andelslogiken fångar gravitationen — även en liten ort med 50
  sysselsatta "tillhör" Halmstad om 10 av dem pendlar dit.

- **Nivå 2** svarar på: *hur sitter regionen i ett större system?*
  Volymlogiken fångar de kopplingar som faktiskt belastar
  infrastrukturen och binder samman regioner.

En ort kan alltså tillhöra en zon (nivå 1) och samtidigt ha starka
utomregionala kopplingar (nivå 2). Kungsbacka tillhör Göteborgs zon
men har egen koppling till Varberg. Det är inte en konflikt — det är
verkligheten.

## Vägnätsvisualisering

Pendlingsflödena projiceras på OpenStreetMap:s bilvägnät via
`dodgr`-paketet i R. Varje OD-par routas längs snabbaste bilvägen
och antalet pendlare ackumuleras segment för segment.

### Routing

- **Profil:** Anpassad hierarkisk motorcar-profil som starkt gynnar
  överordnade vägar (motorway/trunk = 1.0, primary = 0.85,
  secondary = 0.6, tertiary = 0.35). Förhindrar att routing dirigerar
  om trafik via tertiärvägar.
- **Bbox:** Halland + grannregioner (11.0–15.2°E, 55.4–58.3°N) —
  täcker kopplingar till Göteborg, Helsingborg, Jönköping, Växjö.
- **OD-filter:** Minst 5 pendlare per OD-par (SCB-data).

### Kedje-merge

OSM-segment mellan korsningar med identiskt flöde slås ihop till
sammanhängande kedjor. Reducerar antalet features ~5–10× utan
informationsförlust.

### Dual carriageways

Motorvägar (E6, E20) har separata OSM-ways per körriktning. Ett
pair-sharing-steg identifierar parallella kedjor och summerar deras
flöden. Inte perfekt vid avfarter/ramper men hanterar raksträckor.

## Tre vy-nivåer i visualiseringen

### Global vy

**Vad visas:** Alla ackumulerade pendlingsflöden på vägnätet. Varje
segments bredd och färg motsvarar det totala antalet pendlare som
traverserar det — oavsett vilken zon de tillhör.

**Visuell tröskel:** Segment med under 50 ackumulerade pendlare
döljs (brusfilter).

**Interaktion:** Klick på ort → ortspecifik vy. Klick på zon-hull →
zon-vy. Hover på segment → tooltip med ackumulerat flöde och topp 5
bidragande OD-par med riktning och andel.

### Zon-vy

**Vad visas:** Ackumulerade flöden som drivs av den valda zonens
orter, med zon-specifik skala. Alla segment där minst en zonmedlem
bidrar ritas i zonens färg.

**Panel:** Narrativ text om zonens befolkning, ekonomi, egenförsörjning,
kärna, inomregionala kopplingar (andelsbaserat, 10 %-tröskel) och
utomregionala kopplingar (volymbaserat, ≥ 100 pendlare).

**Interaktion:** Hover i kopplingslistan → OD-par-flöden ritas på
kartan (inte ackumulerat). Klick på ort → ortspecifik vy.

### Ortspecifik vy

**Vad visas:** En enskild orts pendlingsrutter — varje partners rutt
ritas separat med bredd proportionell mot det specifika OD-parets
volym. Egen skala. Tröskel: ≥ 25 pendlare.

**Etiketter:** Topp 5 partners visas med namn. Hover på partner i
panelen → enbart den rutten framhävs med ut/in-detalj.

## Datafiler

| Fil | Storlek | Innehåll |
|-----|---------|----------|
| `vagnat-flode.geojson` | ~4 MB | Vägsegment (kedjor) med flow, carry_json |
| `tatorter-halland.geojson` | 56 KB | Ortcentroider med nattbef, kommun, län |
| `halland-lan.geojson` | 60 KB | Hallands länspolygon |
| `ort-edges.json` | 1 MB | Per ort: bidragande segment + partner-chains |
| `ort-fua.json` | 32 KB | SCB-stamdata + zon-medlemskap per ort |
| `karnor.json` | 4 KB | Kärnor med medlemslistor |
| `invanare.json` | 40 KB | Invånare per tätort |
| `dagbef.json` | 40 KB | Dagbefolkning per tätort |

## Externa beroenden

- **D3.js v7** — laddas via CDN (`cdn.jsdelivr.net`)
- **Google Fonts** — IBM Plex Sans (text), Poppins (rubriker)
- Ingen byggprocess, inga node_modules — rent ES-modul-import.

## Kända begränsningar

- **Dual carriageways** kan ge visuellt staplade linjer vid motorvägar.
- **Okända destinationer** (SCB-kod 0000T0000/9999T9999) filtreras
  bort — alla siffror avser kända tätortsdestinationer.
- **Routing** baseras på restid, inte avstånd. Profilen gynnar
  hierarkiskt överordnade vägar men kan i enstaka fall avvika från
  faktiskt körda rutter.
- **Länsövergripande zoner** (Göteborg, Smålandsstenar) beskrivs med
  anpassad narrativ som fokuserar på Halland-perspektivet.
