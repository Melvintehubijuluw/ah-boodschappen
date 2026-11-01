// Kiest per artikel welk product en hoeveel we bestellen, inclusief inslaan bij echte bonus.
import type { Artikel } from "../data/schema.js";
import type { Actie, Eenheid, ProductPrijs } from "../types.js";
import { parseActie } from "./actie.js";
import { formatEenheidsprijs, formatEuro, formatHoeveelheid } from "./eenheden.js";
import { besteEenheidsprijs, centen, isEchteBonus, kosten, regulierePrijs } from "./prijs.js";

export interface Kandidaat {
  productId: number;
  titel: string;
  /** Inhoud per verpakking, in de eenheid van het artikel. */
  inhoud: number;
  prijs: ProductPrijs;
}

export interface Behoefte {
  artikelId: string;
  nodig: number;
  voorraad: number;
  /** Max extra hoeveelheid bovenop het tekort; 0 = niet inslaan (bederfelijk / onbekend). */
  ruimte: number;
  /** Eenheid van het artikel, alleen voor de toelichting. */
  eenheid?: Eenheid;
}

export interface Aankoop {
  productId: number;
  titel: string;
  aantal: number;
  kosten: number;
  hoeveelheid: number;
  nodigDeel: number;
  inslaanDeel: number;
  /** Per basiseenheid (ml/g/stuk). */
  eenheidsprijs: number;
  referentieEenheidsprijs: number;
  besparing: number;
  reden: "nodig" | "inslaan";
  toelichting: string;
}

/** Marge tegen afrondingsruis bij vergelijken van hoeveelheden. */
const EPS = 1e-9;

interface Optie {
  k: Kandidaat;
  actie: Actie;
  groep: number;
}

const kostenVan = (o: Optie, aantal: number): number => kosten(aantal, o.k.prijs, o.actie);

export function bepaalAankoop(
  b: Behoefte,
  kandidaten: Kandidaat[],
  opties: { inslaanMarge?: number } = {},
): { aankoop: Aankoop | null; meldingen: string[] } {
  const marge = opties.inslaanMarge ?? 0.05;
  const meldingen: string[] = [];
  const tekort = Math.max(0, b.nodig - b.voorraad);
  const ruimte = Math.max(0, b.ruimte);
  const max = tekort + ruimte;

  const geldig: Optie[] = [];
  for (const k of kandidaten) {
    if (!(k.inhoud > 0)) {
      meldingen.push(`${k.titel}: inhoud onbekend, overgeslagen.`);
      continue;
    }
    let actie = parseActie(k.prijs.actieOmschrijving, k.prijs.actieCode);
    if (actie.soort === "onbekend") {
      meldingen.push(`${k.titel}: actie "${actie.omschrijving}" niet herkend, gerekend zonder actie.`);
      actie = { soort: "geen" };
    }
    geldig.push({ k, actie, groep: actie.soort === "groep" ? actie.aantal : 1 });
  }
  if (geldig.length === 0) {
    if (tekort > 0 || kandidaten.length > 0) meldingen.push(`${b.artikelId}: geen bruikbaar product gevonden.`);
    return { aankoop: null, meldingen };
  }

  const referentie = Math.min(...geldig.map((o) => regulierePrijs(o.k.prijs) / o.k.inhoud));

  // 1. Basisaankoop: goedkoopste per bruikbare hoeveelheid.
  let basis: { o: Optie; aantal: number } | null = null;
  if (tekort > 0) {
    let besteScore = Infinity;
    let besteKosten = Infinity;
    for (const o of geldig) {
      const aantal = Math.ceil(tekort / o.k.inhoud - EPS);
      const nuttig = Math.min(aantal * o.k.inhoud, max);
      const kst = kostenVan(o, aantal);
      const score = kst / nuttig;
      if (score < besteScore - EPS || (Math.abs(score - besteScore) <= EPS && kst < besteKosten)) {
        basis = { o, aantal };
        besteScore = score;
        besteKosten = kst;
      }
    }
    // Gratis extra's (bijv. 1+1) meenemen als ze in de ruimte passen.
    if (basis) {
      const { o, aantal } = basis;
      const grens = kostenVan(o, aantal) + 0.005;
      for (let q = aantal + o.groep - 1; q > aantal; q--) {
        if (kostenVan(o, q) <= grens && q * o.k.inhoud <= max + EPS) {
          basis = { o, aantal: q };
          break;
        }
      }
    }
  }

  // 2. Inslaan: alleen bij een echte bonus die minstens `marge` goedkoper is dan normaal.
  let inslaan: { o: Optie; aantal: number } | null = null;
  if (ruimte > 0) {
    let beste = Infinity;
    let keuze: Optie | null = null;
    for (const o of geldig) {
      if (!isEchteBonus(o.k.prijs, o.actie)) continue;
      const ep = besteEenheidsprijs(o.k.prijs, o.actie, o.k.inhoud);
      if (ep <= (1 - marge) * referentie + EPS && ep < beste) {
        beste = ep;
        keuze = o;
      }
    }
    if (keuze) {
      let aantal = Math.floor(max / keuze.k.inhoud + EPS);
      aantal = Math.floor(aantal / keuze.groep) * keuze.groep;
      aantal = Math.max(aantal, Math.ceil(tekort / keuze.k.inhoud - EPS));
      const basisHoeveelheid = basis ? basis.aantal * basis.o.k.inhoud : 0;
      if (aantal > 0 && aantal * keuze.k.inhoud > basisHoeveelheid + EPS) inslaan = { o: keuze, aantal };
    }
  }

  const keuze = inslaan ?? basis;
  if (!keuze) return { aankoop: null, meldingen };
  return { aankoop: maakAankoop(keuze.o, keuze.aantal, tekort, referentie, inslaan ? "inslaan" : "nodig", b.eenheid), meldingen };
}

function maakAankoop(o: Optie, aantal: number, tekort: number, referentie: number, reden: Aankoop["reden"], eenheid?: Eenheid): Aankoop {
  const kst = kostenVan(o, aantal);
  const hoeveelheid = aantal * o.k.inhoud;
  const nodigDeel = Math.min(tekort, hoeveelheid);
  const inslaanDeel = hoeveelheid - nodigDeel;
  const eenheidsprijs = kst / hoeveelheid;
  const besparing = Math.max(0, centen((referentie - eenheidsprijs) * hoeveelheid));

  // Toelichting, bijv. "1+1 gratis: €0,75/L i.p.v. €0,79/L, 24× (2 L nodig, 22 L inslaan)".
  const label = o.k.prijs.actieOmschrijving ?? "normale prijs";
  const hv = (n: number): string => (eenheid ? formatHoeveelheid(n, eenheid) : String(Math.round(n * 100) / 100));
  const prijsTekst = eenheid
    ? besparing > 0
      ? `${formatEenheidsprijs(eenheidsprijs, eenheid)} i.p.v. ${formatEenheidsprijs(referentie, eenheid)}`
      : formatEenheidsprijs(eenheidsprijs, eenheid)
    : `${formatEuro(kst)}${besparing > 0 ? ` (${formatEuro(besparing)} voordeel)` : ""}`;
  const extraWoord = reden === "inslaan" ? "inslaan" : "extra";
  const verdeling = inslaanDeel > EPS ? ` (${hv(nodigDeel)} nodig, ${hv(inslaanDeel)} ${extraWoord})` : "";
  const toelichting = `${label}: ${prijsTekst}, ${aantal}×${verdeling}`;

  return {
    productId: o.k.productId,
    titel: o.k.titel,
    aantal,
    kosten: kst,
    hoeveelheid,
    nodigDeel,
    inslaanDeel,
    eenheidsprijs,
    referentieEenheidsprijs: referentie,
    besparing,
    reden,
    toelichting,
  };
}

/** Maximale voorraad die we binnen de houdbaarheid opmaken, met veiligheidsmarge. */
export function maxVoorraad(artikel: Artikel, marge = 0.2): number | null {
  if (artikel.verbruikPerWeek === undefined || artikel.houdbaarheidDagen === undefined) return null;
  return (artikel.verbruikPerWeek * artikel.houdbaarheidDagen * (1 - marge)) / 7;
}

/** Bij deze houdbaarheid of langer verbruik je langzaam en onregelmatig (wasmiddel, olie): middel over een kwartaal. */
export const LANG_HOUDBAAR_DAGEN = 60;

/** Meetvenster in weken: 4 voor verse producten, 13 voor lang houdbare. */
export function meetVenster(artikel: Artikel): number {
  return (artikel.houdbaarheidDagen ?? 0) >= LANG_HOUDBAAR_DAGEN ? 13 : 4;
}

/** Nieuwe meting toevoegen (max 13 bewaard); gemiddelde over de laatste `venster` weken, op 1 decimaal. */
export function werkVerbruikBij(historie: number[], gemeten: number, venster = 4): { historie: number[]; gemiddelde: number } {
  const nieuw = [...historie, Math.max(0, gemeten)].slice(-13);
  const laatste = nieuw.slice(-venster);
  const gemiddelde = Math.round((laatste.reduce((s, n) => s + n, 0) / laatste.length) * 10) / 10;
  return { historie: nieuw, gemiddelde };
}
