import { describe, expect, it } from "vitest";
import type { Artikel } from "./data/schema.js";
import { vergelijkStandaardlijst } from "./standaardlijst.js";

const artikel = (id: string, producten: number[], standaard = true): Artikel => ({
  id,
  naam: id,
  eenheid: "stuk",
  standaard,
  voorraadkast: false,
  producten,
  afgewezen: [],
  bederfelijk: false,
  verbruikHistorie: [],
});

describe("vergelijkStandaardlijst", () => {
  const artikelen = [artikel("melk", [1, 2]), artikel("kwark", [3]), artikel("ui", [4], false)];

  it("niets veranderd", () => {
    expect(vergelijkStandaardlijst([1, 3], artikelen)).toEqual({ nieuw: [], wordtStandaard: [], verdwenen: [] });
  });

  it("handmatig toegevoegd product is nieuw", () => {
    expect(vergelijkStandaardlijst([1, 3, 99], artikelen).nieuw).toEqual([99]);
  });

  it("product van een receptartikel wordt standaard", () => {
    expect(vergelijkStandaardlijst([1, 3, 4], artikelen).wordtStandaard).toEqual([{ productId: 4, artikel: "ui" }]);
  });

  it("verwijderd product geeft verdwenen artikel", () => {
    expect(vergelijkStandaardlijst([1], artikelen).verdwenen).toEqual(["kwark"]);
  });

  it("vervanger op het lijstje telt als aanwezig", () => {
    expect(vergelijkStandaardlijst([2, 3], artikelen).verdwenen).toEqual([]);
  });
});
