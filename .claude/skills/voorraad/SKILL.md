---
name: voorraad
description: Tussendoor de voorraad bijwerken of bekijken ("de kattengrit is op", "we hebben nog 3 pakken melk"), of een standaardproduct toevoegen of verwijderen. Gebruik bij /voorraad.
---

# Voorraad bijwerken

De afspraken in `CLAUDE.md` gelden.

- **Bekijken:** draai `npm run ah -- voorraad verwacht` en laat een compact overzicht zien.
- **Bijwerken:** zet de vrije tekst van de gebruiker om naar artikel-ids en hoeveelheden in g, ml of stuk. Draai `npm run ah -- voorraad zet <artikel>=<hoeveelheid> ...`. Dit meet geen verbruik; dat gebeurt alleen bij de wekelijkse telling.
- **Foto's:** schat wat je ziet, noem twijfelgevallen en leg daarna vast zoals hierboven.
- **Standaardproduct toevoegen:**
  1. Zoek met `npm run ah -- zoek <term>`.
  2. Kies het goedkoopste geschikte product op prijs per eenheid.
  3. Draai `npm run ah -- product <id>`.
  4. Voeg een artikel toe aan `data/artikelen.json` met:
     - `standaard: true`;
     - `verbruikPerWeek`: vraag de gebruiker om een schatting;
     - `houdbaarheidDagen`: voorzichtige schatting.

  Zet het product ook op het AH-standaardlijstje (https://www.ah.nl/favorieten/lijst/0cbfb39e-0394-42fb-afa3-113f4eefe30c), als de gebruiker dat wil.
- **Standaardproduct stoppen:** zet `standaard: false` (het artikel blijft bestaan voor recepten).
- **Afronden:** draai `npm run ah -- controle`, daarna `git add -A`, `git commit -m "Voorraad bijgewerkt"` en `git push`.
