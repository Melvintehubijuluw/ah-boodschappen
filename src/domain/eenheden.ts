// Inhoud van AH-verpakkingen lezen en hoeveelheden/prijzen leesbaar maken.
import type { Eenheid, Hoeveelheid } from "../types.js";

/** Eenheidwoord → basiseenheid en factor. */
const EENHEDEN: Record<string, { eenheid: Eenheid; factor: number }> = {};
function registreer(woorden: string[], eenheid: Eenheid, factor: number): void {
  for (const w of woorden) EENHEDEN[w] = { eenheid, factor };
}
registreer(["mg", "milligram"], "g", 0.001);
registreer(["g", "gr", "gram", "grams"], "g", 1);
registreer(["kg", "kilo", "kilogram", "kilogrammen"], "g", 1000);
registreer(["ml", "milliliter", "millilitre"], "ml", 1);
registreer(["cl", "centiliter"], "ml", 10);
registreer(["dl", "deciliter"], "ml", 100);
registreer(["l", "lt", "ltr", "liter", "litre", "liters"], "ml", 1000);
registreer(
  [
    "st", "stuk", "stuks", "rol", "rollen", "wasbeurt", "wasbeurten", "tablet", "tabletten",
    "zakje", "zakjes", "capsule", "capsules", "pad", "pads", "plakjes", "plak", "eieren",
  ],
  "stuk",
  1,
);

const GETAL = String.raw`(\d+(?:[.,]\d+)?)`;
// Optioneel "6 x", dan getal en eenheidwoord, bijv. "6 x 1,5 l" of "500 Gram".
const PATROON = new RegExp(String.raw`^(?:(\d+)\s*x\s*)?${GETAL}\s*([a-z]+)\.?$`);

const leesGetal = (s: string): number => Number(s.replace(",", "."));
const afronden = (n: number, decimalen = 6): number => {
  const f = 10 ** decimalen;
  return Math.round((n + Number.EPSILON) * f) / f;
};

export function parseHoeveelheid(tekst: string): Hoeveelheid | null {
  let s = tekst.trim().toLowerCase().replace(/\s+/g, " ");
  s = s.replace(/^(ca\.?|circa|±)\s*/, "");
  // "per stuk", "per kg": zonder getal is het er één van.
  const per = /^per ([a-z]+)$/.exec(s);
  if (per) {
    const e = EENHEDEN[per[1]!];
    return e ? { waarde: afronden(e.factor), eenheid: e.eenheid } : null;
  }
  const m = PATROON.exec(s);
  if (!m) return null;
  const e = EENHEDEN[m[3]!];
  if (!e) return null;
  const aantal = m[1] ? Number(m[1]) : 1;
  const waarde = afronden(aantal * leesGetal(m[2]!) * e.factor);
  return waarde > 0 ? { waarde, eenheid: e.eenheid } : null;
}

export function inhoudVanProduct(verpakking: string, netContents: string[] | null): Hoeveelheid | null {
  for (const n of netContents ?? []) {
    const h = parseHoeveelheid(n);
    if (h) return h;
  }
  return parseHoeveelheid(verpakking);
}

/** Getal met Nederlandse komma, zonder overbodige nullen. */
function getal(n: number, maxDecimalen: number): string {
  return n
    .toFixed(maxDecimalen)
    .replace(/\.?0+$/, "")
    .replace(".", ",");
}

export function formatHoeveelheid(waarde: number, eenheid: Eenheid): string {
  switch (eenheid) {
    case "ml":
      return Math.abs(waarde) >= 1000 ? `${getal(waarde / 1000, 2)} L` : `${getal(waarde, 1)} ml`;
    case "g":
      return Math.abs(waarde) >= 1000 ? `${getal(waarde / 1000, 2)} kg` : `${getal(waarde, 1)} g`;
    case "stuk":
      return `${getal(waarde, 2)} ${waarde === 1 ? "stuk" : "stuks"}`;
  }
}

export function formatEuro(bedrag: number): string {
  const centen = Math.round((Math.abs(bedrag) + Number.EPSILON) * 100);
  const tekst = `€${(centen / 100).toFixed(2).replace(".", ",")}`;
  return bedrag < 0 && centen > 0 ? `-${tekst}` : tekst;
}

/** Prijs per basiseenheid (per ml/g/stuk) → "€0,84/L", "€3,98/kg", "€0,25/stuk". */
export function formatEenheidsprijs(prijsPerBasiseenheid: number, eenheid: Eenheid): string {
  switch (eenheid) {
    case "ml":
      return `${formatEuro(prijsPerBasiseenheid * 1000)}/L`;
    case "g":
      return `${formatEuro(prijsPerBasiseenheid * 1000)}/kg`;
    case "stuk":
      return `${formatEuro(prijsPerBasiseenheid)}/stuk`;
  }
}
