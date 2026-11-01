// Prijsberekeningen per product, rekening houdend met bonusacties.
import type { Actie, ProductPrijs } from "../types.js";

export const centen = (bedrag: number): number => Math.round((bedrag + Number.EPSILON) * 100) / 100;

/** Permanent multipackvoordeel (geen echte weekbonus). */
export function isPermanent(p: ProductPrijs): boolean {
  return p.actieCode === "BUNDLE_BULK" || /volume\s*voordeel/i.test(p.actieOmschrijving ?? "");
}

/** Wat we normaal (zonder weekbonus) per verpakking betalen. */
export function regulierePrijs(p: ProductPrijs): number {
  return isPermanent(p) && p.nu !== null ? p.nu : p.prijs;
}

/** Prijs van één verpakking nu. */
export function stukprijs(p: ProductPrijs, _actie: Actie): number {
  return p.nu !== null && p.nu < p.prijs ? p.nu : p.prijs;
}

/** Prijs van één volle groep van een groepsactie. */
function groepsprijs(p: ProductPrijs, actie: Extract<Actie, { soort: "groep" }>): number {
  return actie.bedrag ?? (actie.betaalStuks ?? actie.aantal) * p.prijs;
}

/** Totale kosten van `aantal` verpakkingen, in centen afgerond. */
export function kosten(aantal: number, p: ProductPrijs, actie: Actie): number {
  if (aantal <= 0) return 0;
  const sp = stukprijs(p, actie);
  const los = aantal * sp;
  if (actie.soort !== "groep") return centen(los);
  const groepen = Math.floor(aantal / actie.aantal);
  const metDeal = groepen * groepsprijs(p, actie) + (aantal - groepen * actie.aantal) * sp;
  return centen(Math.min(los, metDeal));
}

/** Echte (tijdelijke) bonus die goedkoper is dan normaal. */
export function isEchteBonus(p: ProductPrijs, actie: Actie): boolean {
  if (isPermanent(p)) return false;
  if (actie.soort === "groep") return kosten(actie.aantal, p, actie) < actie.aantal * p.prijs - 0.005;
  return actie.soort === "stukprijs" && p.nu !== null && p.nu < p.prijs;
}

/** Laagst haalbare prijs per basiseenheid (bij volle actiegroepen). */
export function besteEenheidsprijs(p: ProductPrijs, actie: Actie, inhoud: number): number {
  if (inhoud <= 0) return Infinity;
  const los = stukprijs(p, actie) / inhoud;
  if (actie.soort !== "groep") return los;
  return Math.min(los, kosten(actie.aantal, p, actie) / (actie.aantal * inhoud));
}
