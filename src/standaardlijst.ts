// Vergelijkt het AH-standaardlijstje (dat de gebruikers ook zelf aanpassen) met de standaardartikelen.
import type { Artikel } from "./data/schema.js";

/** Het favorietenlijstje "Standaardlijst" op ah.nl. */
export const STANDAARD_LIJST = "0cbfb39e-0394-42fb-afa3-113f4eefe30c";

export interface LijstVerschil {
  /** Op het lijstje, maar bij geen enkel artikel bekend: nieuw standaardartikel aanmaken. */
  nieuw: number[];
  /** Op het lijstje en bekend bij een artikel dat (nog) geen standaard is. */
  wordtStandaard: { productId: number; artikel: string }[];
  /** Standaardartikelen waarvan geen enkel product nog op het lijstje staat. */
  verdwenen: string[];
}

export function vergelijkStandaardlijst(lijst: number[], artikelen: Artikel[]): LijstVerschil {
  const opLijst = new Set(lijst);
  const perProduct = new Map<number, Artikel>();
  for (const a of artikelen) for (const p of [...a.producten]) if (!perProduct.has(p)) perProduct.set(p, a);

  const nieuw: number[] = [];
  const wordtStandaard: LijstVerschil["wordtStandaard"] = [];
  for (const id of opLijst) {
    const a = perProduct.get(id);
    if (!a) nieuw.push(id);
    else if (!a.standaard) wordtStandaard.push({ productId: id, artikel: a.id });
  }
  // Een vervanger (bijv. Campina i.p.v. huismerk) telt ook: het artikel staat dan nog op het lijstje.
  const verdwenen = artikelen.filter((a) => a.standaard && !a.producten.some((p) => opLijst.has(p))).map((a) => a.id);
  return { nieuw, wordtStandaard, verdwenen };
}
