// AH-actieteksten ("1+1 gratis", "2 voor 2.99") omzetten naar een rekenbare Actie.
import type { Actie } from "../types.js";

const GETAL = String.raw`(\d+(?:[.,]\d+)?)`;
const leesGetal = (s: string): number => Number(s.replace(",", "."));
const STUKPRIJS_CODES = new Set(["BONUS", "FIXED_PRICE", "PERCENTAGE", "WEIGHT", "AMOUNT", "PERSOONLIJK"]);

function groep(aantal: number, betaal: { bedrag?: number; betaalStuks?: number }): Actie | null {
  if (!Number.isInteger(aantal) || aantal < 1) return null;
  if (betaal.betaalStuks !== undefined && (betaal.betaalStuks < 0 || betaal.betaalStuks > aantal)) return null;
  if (betaal.bedrag !== undefined && !(betaal.bedrag >= 0)) return null;
  return { soort: "groep", aantal, ...betaal };
}

export function parseActie(omschrijving: string | null, actieCode: string | null): Actie {
  // Volumevoordeel van multipacks is permanent: gewoon de prijs per stuk.
  if (actieCode === "BUNDLE_BULK") return { soort: "stukprijs" };
  // "Feestfavoriet" is een label zonder korting.
  if (actieCode === "FESTIVE_FAVOURITE") return { soort: "geen" };

  const origineel = (omschrijving ?? "").trim();
  if (!origineel) return actieCode ? { soort: "onbekend", omschrijving: actieCode } : { soort: "geen" };
  const s = origineel.toLowerCase().replace(/\s+/g, " ");
  let m: RegExpExecArray | null;

  // "1+1 gratis", "2+1 gratis"
  if ((m = /(\d+) ?\+ ?(\d+) gratis/.exec(s))) {
    const a = Number(m[1]);
    const r = groep(a + Number(m[2]), { betaalStuks: a });
    if (r) return r;
  }

  // "2e gratis", "2e halve prijs", "2e artikel 50% korting"
  if ((m = /\b(\d+)e (?:(?:artikel|verpakking|product) )?(.*)$/.exec(s))) {
    const n = Number(m[1]);
    const rest = m[2]!;
    let korting: number | null = null;
    let p: RegExpExecArray | null;
    if (/^halve prijs/.test(rest)) korting = 0.5;
    else if ((p = new RegExp(String.raw`^${GETAL} ?% korting`).exec(rest))) korting = leesGetal(p[1]!) / 100;
    else if (/^gratis/.test(rest)) korting = 1;
    if (korting !== null && korting <= 1) {
      const r = groep(n, { betaalStuks: n - korting });
      if (r) return r;
    }
  }

  // "3 halen 2 betalen"
  if ((m = /(\d+) halen,? (\d+) betalen/.exec(s))) {
    const r = groep(Number(m[1]), { betaalStuks: Number(m[2]) });
    if (r) return r;
  }

  // "2 voor 2.99", "3 voor €3"
  if ((m = new RegExp(String.raw`(?:^|\s)(\d+) voor ?€? ?${GETAL}\b`).exec(s))) {
    const r = groep(Number(m[1]), { bedrag: leesGetal(m[2]!) });
    if (r) return r;
  }

  // Prijs per stuk: "25% korting", "voor 1.99", "volume voordeel", overige kortingen.
  if (/% ?korting/.test(s)) return { soort: "stukprijs" };
  if (new RegExp(String.raw`(?:^|\s)voor ?€? ?\d`).test(s)) return { soort: "stukprijs" };
  if (/volume ?voordeel/.test(s)) return { soort: "stukprijs" };
  if (/korting/.test(s)) return { soort: "stukprijs" };

  // Acties waarbij AH de actieprijs al in `nu` zet ("BONUS", "per 100 GRAM voor €2.69", "€1.00 euro korting").
  if (actieCode && STUKPRIJS_CODES.has(actieCode)) return { soort: "stukprijs" };

  return { soort: "onbekend", omschrijving: origineel };
}
