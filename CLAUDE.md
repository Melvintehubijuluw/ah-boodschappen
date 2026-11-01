# AH-boodschappenbesteller

Wekelijkse Albert Heijn-bestelling voor een huishouden van 2 personen. Claude plant het menu, houdt de voorraad bij, zoekt de bonus uit en vult de winkelmand op ah.nl. **Afrekenen en een bezorgmoment kiezen doet de gebruiker altijd zelf.** Alle tekst naar de gebruiker en alle bestanden zijn in het Nederlands.

## Commando's (skills)

- `/weekbestelling`: de zondagflow, van voorraad tot gevulde winkelmand.
- `/recept`: een recept (eigen recept of link) toevoegen, inclusief AH-lijstje.
- `/voorraad`: tussendoor de voorraad bijwerken ("kattengrit is op").

## Afspraken (vastgelegd met de gebruiker)

**Ritme**
- Zondag plannen, maandag bezorgen. Menu: maandag t/m zaterdag 6 diners; zondag is vrij.
- Telt de bonus die geldt op de **bezorgdatum**. De bonus van volgende week verschijnt vrijdag rond 13:00.
- Een cloud-taak mailt de gebruiker op zondag om 08:00. Is de week om 19:00 nog niet `besteld`, dan volgt een tweede mail.
- De week geldt als afgerond als `weken/<week>.json` status `besteld` heeft en naar GitHub is gepusht.

**Recepten**
- Recepten zijn voor 2 personen. Online recepten reken je om.
- Voor nu stel je alleen diners voor. Ontbijt en lunch vallen onder de standaardlijst.
- **Rouleren** begint vanaf 18 recepten. Daaronder mogen recepten vaker terugkomen.
  - Een recept rust 2 weken.
  - Bonus mag de rustperiode doorbreken: geld besparen gaat voor.
  - Hetzelfde recept mag maximaal 2× per week.
  - Er is geen limiet op opeenvolgende weken.
  - Varieer op tags binnen de week.
- Dubbel koken geven de gebruikers per bestelling aan.
- Niet-gekookte recepten van vorige week krijgen voorrang.
- **Dagvolgorde** volgt de houdbaarheid (vis en gehakt vroeg). De gebruikers mogen dagen ruilen.
- **Ingrediënt naar product:** stel per ingrediënt het goedkoopste geschikte product voor, op **prijs per eenheid** (€/kg, €/L). De gebruiker keurt de lijst goed voordat het AH-lijstje wordt gemaakt.
- **Basisingrediënten** (zout, olie, kruiden, bouillon) staan in het recept met `voorraadkast: true`. Bestel ze alleen als de voorraad laag is.
- **Online recepten:** sla alleen de ingrediënten op en link naar de bron. Neem de bereidingstekst niet over (auteursrecht). Bij eigen recepten mag de bereiding er wel in.

**Voorraad en verbruik**
- Laat eerst de verwachte voorraad zien. De gebruiker stuurt foto's (via Remote Control vanaf de telefoon) en correcties in vrije tekst. Vraag alleen naar twijfelgevallen.
- Schattingen volstaan. Reken foto's en tekst om naar g, ml of stuks.
- Het verbruik van standaardproducten leert het systeem zelf: een gemiddelde over de laatste 4 weken (`voorraad telling`).
- Houd bederfelijke restjes bij. Recepten die ze opmaken krijgen voorrang.

**Geld besparen**
- Vergelijk altijd per eenheid en reken bonusacties mee (1+1, 2e halve prijs, X voor €Y, %, 3 halen 2 betalen).
- **Vervangers** mag Claude zelf kiezen, maar alleen hetzelfde product van een ander merk of in een andere verpakking. Magere melk van huismerk naar Campina mag; koffiebonen naar cups niet. Bij twijfel: vragen. Leg afgewezen producten vast in `afgewezen`.
- **Gewone weekhoeveelheid:** altijd de laagste prijs per eenheid, zonder marge.
- **Inslaan:** alleen bij een echte bonusactie die minstens **5%** goedkoper is per eenheid. Er is geen maximum aan de hoeveelheid; de grens is de houdbaarheid met 20% marge (opslag op zolder is geen probleem). Gaat het om meer dan €50 extra, meld dat dan bovenaan.
- **Houdbaarheid** schat Claude voorzichtig in en legt die per artikel vast (`houdbaarheidDagen`). De gebruiker mag het corrigeren.
- **Vooruit bestellen:** mag voor volgende week, als het product het zeker haalt. Het recept ligt dan vast voor volgende week (`data/vooruit.json`).
- **Onder €50:** vul aan met lang houdbare producten die toch nodig zijn, met voorkeur voor bonus. Lukt dat niet zinvol, meld het dan. Vul nooit aan met dingen die niet op de lijsten staan.
- **Persoonlijke bonus (Bonus Box):** geef aan het begin van de zondagsessie advies over welke 5 de gebruiker activeert. De gebruiker doet dat zelf in de app. Leg daarna vast met `persoonlijke-bonus`.

## Techniek

- `npm run ah -- <opdracht>` is de CLI (`src/cli.ts`). `npm run ah -- --help` toont alle opdrachten. Alle rekenwerk zit in de CLI: reken niet zelf, maar draai de CLI en presenteer het resultaat.
- **Bonus, prijzen en zoeken** gaan via de AH-app-API zonder login (`src/ah/`). Een wekelijkse steekproef tegen ah.nl is gewenst: wijken prijzen af, meld het dan.
- **Ingelogde acties** (winkelmand, favorietenlijstjes) gaan via **Claude in Chrome** op een ah.nl-tabblad.
  - `npm run ah -- web <opdracht>` geeft JavaScript dat je met `javascript_tool` uitvoert. Het gebruikt het `/gql`-adres van de website met de login-cookies van de gebruiker.
  - Voer nooit wachtwoorden in. Is de gebruiker uitgelogd, vraag dan om in te loggen.
  - Werkt het script niet, val dan terug op klikken op de website. Een favorietenlijstje open je via de popup en daarna "lijstje aanpassen" voor de volledige URL.
- **Data** (alles JSON, gevalideerd met zod in `src/data/schema.ts`):
  - `data/artikelen.json`: behoeften los van merk. `producten[0]` is het standaardproduct, de rest zijn goedgekeurde vervangers.
  - `data/producten.json`: AH-producten met inhoud per verpakking.
  - `data/recepten.json`: bron van `recepten.md`. Bewerk `recepten.md` nooit met de hand; draai `recepten-md`.
  - `data/voorraad.json`: laatste telling.
  - `data/vooruit.json`: vooruit gekochte producten.
  - `weken/<ISO-week>.json` en `.md`: menu, bestelling en samenvatting per week.
- Eenheden zijn intern gram (`g`), milliliter (`ml`) of `stuk`.
- Na elke sessie: `npm test`, dan `git add -A && git commit` en `git push`. De cloud-herinnering leest de status van GitHub.
