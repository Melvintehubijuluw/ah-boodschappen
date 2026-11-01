// Gedeelde types tussen de AH-client (src/ah) en de rekenlogica (src/domain).
// Alle hoeveelheden worden intern opgeslagen in basiseenheden: gram, milliliter of stuks.

export type Eenheid = "g" | "ml" | "stuk";

export interface Hoeveelheid {
  waarde: number;
  eenheid: Eenheid;
}

/** Een bonusperiode (bonusweek), datums als YYYY-MM-DD, inclusief. */
export interface Periode {
  start: string;
  eind: string;
}

/**
 * Prijs van één AH-product in een bepaalde periode, zoals de API die geeft.
 * `prijs` is de normale prijs per verpakking (was), `nu` de actuele prijs per verpakking (now).
 */
export interface ProductPrijs {
  productId: number;
  titel: string;
  merk: string | null;
  /** Ruwe verpakkingstekst van AH, bijv. "1 l", "500 g", "3 stuks", "6 x 1,5 l". */
  verpakking: string;
  /** Inhoud volgens AH-productdata (netContents), bijv. ["1.0 Liter"], indien bekend. */
  netContents: string[] | null;
  prijs: number;
  nu: number | null;
  /** Actiecode van AH, bijv. "X_FOR_Y", "BUNDLE_BULK". Null zonder actie. */
  actieCode: string | null;
  /** Actietekst van AH, bijv. "2 voor 2.99", "1+1 gratis", "25% korting". Null zonder actie. */
  actieOmschrijving: string | null;
  bestelbaar: boolean;
  periode: Periode;
}

/** Een product dat in een bonusperiode in de aanbieding is. */
export interface BonusProduct extends ProductPrijs {
  /** Naam van de bonusgroep, bijv. "Alle Campina yoghurt literpakken en kwark 500 gram". */
  groep: string | null;
  groepId: string | null;
  categorie: string | null;
}

/** Zoekresultaat uit de productzoeker. */
export interface ZoekResultaat {
  productId: number;
  titel: string;
  merk: string | null;
  verpakking: string;
  prijs: number;
  nu: number | null;
  /** Prijs per eenheid zoals AH die toont, bijv. "prijs per liter €0.84". */
  eenheidsprijsTekst: string | null;
  actieOmschrijving: string | null;
  isBonus: boolean;
  bestelbaar: boolean;
  categorie: string | null;
}

/**
 * Geïnterpreteerde bonusactie.
 * - geen: geen actie.
 * - stukprijs: de actieprijs `nu` geldt per stuk (procentkorting, "voor 1.99", volumevoordeel).
 * - groep: bij `aantal` stuks betaal je `bedrag` (vast bedrag) of `betaalStuks` × normale prijs.
 * - onbekend: actietekst niet herkend; behandel als geen actie en meld het.
 */
export type Actie =
  | { soort: "geen" }
  | { soort: "stukprijs" }
  | { soort: "groep"; aantal: number; bedrag?: number; betaalStuks?: number }
  | { soort: "onbekend"; omschrijving: string };
