---
name: recept
description: Een nieuw recept toevoegen (eigen recept of link), omrekenen naar 2 personen, AH-producten kiezen en een AH-favorietenlijstje maken. Gebruik bij /recept of als de gebruiker een recept of receptlink deelt.
---

# Recept toevoegen

De afspraken in `CLAUDE.md` gelden.

## 1. Recept lezen
- **Link:** lees de pagina (WebFetch, of Chrome als dat niet lukt). Neem de naam, het aantal porties en de ingrediënten met hoeveelheden over. Neem de bereidingstekst **niet** over; die blijft via `bron` bereikbaar.
- **Eigen recept:** neem de ingrediënten en, als de gebruiker die geeft, de bereidingsstappen over.
- Reken om naar **2 personen**.
- Vraag alleen wat echt onduidelijk is, bijv. "1 blik tomaten: 400 g?".

## 2. Artikelen bepalen
Bepaal per ingrediënt het artikel, een behoefte los van merk (zie `data/artikelen.json`).
- Hergebruik een bestaand artikel als het hetzelfde product is, bijv. `ui`, `knoflook`, `olijfolie`.
- Nieuw artikel? Leg vast:
  - `id`: kebab-case.
  - `naam`.
  - `eenheid`: `g`, `ml` of `stuk`.
  - `zoekterm`.
  - `houdbaarheidDagen`: voorzichtige schatting.
  - `bederfelijk`: voor vis, vlees, verse kruiden, room enz.
  - `voorraadkast: true` voor basisingrediënten (zout, peper, olie, kruiden, bouillon, bloem, suiker).
- Hoeveelheden gaan in de eenheid van het artikel. Stuks blijven stuks (2 uien = 2 stuk); gewicht en volume gaan in g of ml.

## 3. Producten kiezen
1. Zoek per nieuw artikel met `npm run ah -- zoek <term> -n 10`.
2. Kies het **goedkoopste geschikte** product op prijs per eenheid. Let op een passende verpakking: een grote pot is goedkoper per kg, maar alleen zinvol als het opraakt of lang houdbaar is.
3. Draai `npm run ah -- product <id...>` om het product vast te leggen en de inhoud te controleren. Is de inhoud onbekend, gebruik `--inhoud`.
4. Laat de gebruiker één overzicht zien met per ingrediënt: hoeveelheid, gekozen product, prijs, prijs per eenheid en "voorraadkast" waar dat geldt. De gebruiker keurt goed of past aan.

## 4. Opslaan
1. Voeg het recept toe aan `data/recepten.json`:
   - `id`, `naam`, `maaltijd: "diner"`, `porties: 2`.
   - `bron`: de URL, of `"eigen"`.
   - `tags`: hoofdingrediënt zoals `vis`, `vlees`, `kip` of `vega`, plus basis zoals `pasta`, `rijst` of `aardappel`.
   - `ingredienten`.
   - `bereiding`: alleen bij eigen recepten.
   - `toegevoegd`: de datum van vandaag.
2. Voeg de nieuwe artikelen toe aan `data/artikelen.json`.
3. Draai `npm run ah -- controle`.

## 5. AH-lijstje maken
1. Open in Claude in Chrome een tabblad op `https://www.ah.nl/favorieten`. De gebruiker moet ingelogd zijn.
2. Draai `npm run ah -- web maak-lijst <recept-id>` en voer de output uit met `javascript_tool`.
   - Het resultaat bevat `url`, en `aantalInLijst` moet gelijk zijn aan `verwacht`.
   - Voorraadkast-producten staan ook in het lijstje: dat is het complete recept.
3. **Werkt het script niet**, gebruik dan de website:
   1. Maak een nieuw lijstje met de receptnaam en voeg de producten toe.
   2. Open het lijstje. Dat opent eerst een popup.
   3. Klik in de popup op **"lijstje aanpassen"**. Kopieer daarna de volledige URL (`https://www.ah.nl/favorieten/lijst/<uuid>`).
4. Zet de URL in `ahLijst` van het recept.

## 6. Afronden
1. Draai `npm run ah -- recepten-md`.
2. Draai `git add -A`, `git commit -m "Recept: <naam>"` en `git push`.
3. Meld het aantal recepten (x/18). Vanaf 18 gaat het menu rouleren.
