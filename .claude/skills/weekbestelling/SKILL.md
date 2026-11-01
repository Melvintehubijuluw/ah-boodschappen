---
name: weekbestelling
description: De wekelijkse AH-bestelling, van voorraad tot gevulde winkelmand. Gebruik bij /weekbestelling, "weekmenu", "boodschappen bestellen" of na de zondagsherinnering.
---

# Weekbestelling

Volg de stappen in volgorde. De afspraken in `CLAUDE.md` gelden. Reken niet zelf: gebruik de CLI (`npm run ah -- ...`). Houd berichten kort en vraag alleen wat nodig is.

## 0. Voorbereiden
1. Draai `git pull`, en daarna `npm run ah -- status` en `npm run ah -- controle`.
   - Meldt `controle` problemen (inhoud onbekend, houdbaarheid of verbruik ontbreekt), los ze eerst op. Schat de houdbaarheid zelf voorzichtig in; vraag het verbruik aan de gebruiker.
2. Draai `npm run ah -- prijzen` (bonus en prijzen van de bezorgweek; standaard bezorging op de eerstvolgende maandag).
3. Open in Claude in Chrome een nieuw tabblad op `https://www.ah.nl/`. Controleer of de gebruiker is ingelogd. Zo niet, vraag de gebruiker in te loggen en wacht.
4. **Standaardlijstje bijwerken** (de gebruikers voegen daar zelf producten aan toe of halen ze weg):
   - Voer de output van `npm run ah -- web standaardlijst` uit met `javascript_tool`.
   - Geef het resultaat (de JSON) door aan `npm run ah -- standaardlijst '<json>'`.
   - `NIEUW`: draai `npm run ah -- product <id>`. Maak een standaardartikel aan in `data/artikelen.json` (zie `/voorraad`). Schat de houdbaarheid zelf in en vraag de gebruiker alleen het weekverbruik. Is het eigenlijk een vervanger van een bestaand artikel (zelfde product, ander merk), voeg het dan daar toe.
   - `WORDT STANDAARD`: zet `standaard: true` en vraag het weekverbruik.
   - `VERDWENEN`: vraag of het artikel van de standaardlijst af mag (`standaard: false`). Misschien is het per ongeluk verwijderd.

## 1. Persoonlijke bonus (Bonus Box)
1. Lees de persoonlijke aanbiedingen op `https://www.ah.nl/bonus` (persoonlijke bonus / Bonus Box) met `get_page_text`.
2. Adviseer welke 5 de gebruiker activeert. Kies op verwachte besparing, gegeven de standaardproducten (`data/artikelen.json`) en recepten die waarschijnlijk op het menu komen. Geef per keuze één regel met de reden.
3. De gebruiker activeert zelf in de app. Wacht op "klaar".
4. Leg elke geactiveerde aanbieding die een bekend product betreft vast:
   `npm run ah -- persoonlijke-bonus <productId> "<omschrijving>" [--nu <prijs>]`.

## 2. Vorige week controleren
Sla deze stap over als `status` geen vorige week toont.
1. Haal de werkelijke levering op. Open `https://www.ah.nl/bestellingen`, open de laatste bestelling en lees de producten en aantallen.
   - Productnummers staan in de links (`/producten/product/wi<id>`).
   - Leg vast met `npm run ah -- ontvangen <id>=<aantal> ...`.
2. Vraag welke diners van vorige week **niet** gekookt zijn. Leg vast met `npm run ah -- gekookt <ids> --niet`. Is alles gekookt, draai dan `gekookt <alle ids>`.

## 3. Voorraad
1. Draai `npm run ah -- voorraad verwacht` en laat een compact lijstje zien, gegroepeerd en in leesbare eenheden.
2. Vraag om foto's van koelkast, vriezer en voorraadkast. Via de Claude-app op de telefoon kan dat met Remote Control; ook slepen in de chat werkt.
3. Vergelijk de foto's met de verwachte voorraad. Noem alleen de twijfelgevallen ("ik zie geen kwark, is die op?"). De gebruiker corrigeert in vrije tekst.
4. Leg vast met `npm run ah -- voorraad telling <artikel>=<hoeveelheid> ...`. Gebruik alleen correcties; niet genoemde artikelen krijgen automatisch de verwachte waarde. De CLI toont het gemeten weekverbruik.

## 4. Vervangers in de bonus
1. Draai `npm run ah -- kandidaten`.
2. Beoordeel per artikel of een kandidaat **hetzelfde product** is, met een ander merk of een andere verpakking:
   - Bij ja: voeg de productId toe aan `producten` van het artikel in `data/artikelen.json`, en draai `npm run ah -- product <id>`. Is de inhoud onbekend (bijv. een multipack), zet die met `--inhoud`.
   - Bij nee: voeg de productId toe aan `afgewezen`.
   - Bij twijfel: vraag het de gebruiker.

## 5. Menu
1. Draai `npm run ah -- menu`. Laat het voorstel zien met per dag het recept en de reden (bonus, lang niet gegeten, restjes, vastgezet).
2. Bekijk ook vooruit-kansen. Is een bonusingrediënt van een ander recept lang genoeg houdbaar voor volgende week (bijv. verse ravioli, ±10 dagen), stel dan voor het vooruit te kopen.
3. De gebruiker accepteert of past aan, en geeft aan wat dubbel gekookt wordt.
4. Leg vast: `npm run ah -- menu-zet maandag=<id> dinsdag=<id> ... [--dubbel <ids>] [--vooruit <ids>]`.

## 6. Bestelling
1. Draai `npm run ah -- advies`. Laat zien:
   - Nodig deze week (kort).
   - **Inslaan** apart, met besparing. Is het meer dan €50 extra, meld het bovenaan.
   - Vooruit.
   - Totaal en besparing.
   - Meldingen.
2. **Onder €50:** kies uit de aanvulsuggesties (bonus eerst, alleen dingen die toch nodig zijn), draai `advies --extra <id>=<aantal> ...` en laat het opnieuw zien. Lukt aanvullen niet zinvol, meld het.
3. Vraag akkoord. Pas aan waar de gebruiker dat wil: menu opnieuw vastleggen of `--extra`.

## 7. Winkelmand vullen
1. Lees eerst de huidige mand: draai `npm run ah -- web mand` en voer de output uit met `javascript_tool` op het ah.nl-tabblad. Zitten er al producten in, vraag dan of die moeten blijven. Wat er al in zit wordt niet weggehaald; onze producten komen erbij.
2. Draai `npm run ah -- web vul-mand` en voer het script uit.
   - Controleer `fouten` en `afwijkingen` in het resultaat.
   - Bij afwijkingen: open `https://www.ah.nl/mandje`, corrigeer met de hand en meld het.
3. Noem het totaal uit de mand. Zeg dat de gebruiker zelf een bezorgmoment kiest en afrekent.

## 8. Afronden
1. Draai `npm run ah -- afronden`. Dat schrijft `weken/<week>.md` en zet de status op `besteld`.
2. Draai `npm run ah -- recepten-md` (de "laatst gegeten"-kolom wordt bijgewerkt).
3. Draai `npm test`, dan `git add -A`, `git commit -m "Week <week>: bestelling klaargezet"` en `git push`. Zonder push stuurt de cloud-taak om 19:00 een herinnering.
4. Sluit het Chrome-tabblad dat je opende.
5. Sluit af met een korte samenvatting: menu, totaal, besparing en wat er is ingeslagen of vooruit gekocht.
