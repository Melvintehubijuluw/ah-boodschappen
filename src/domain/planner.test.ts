import { describe, expect, it } from "vitest";
import type { Artikel, Recept } from "../data/schema.js";
import { dagVolgorde, kiesMenu, scoreRecept, type PlanContext } from "./planner.js";

const recept = (id: string, tags: string[] = [], ingredienten: Recept["ingredienten"] = [{ artikel: "ui", hoeveelheid: 1 }], maaltijd: Recept["maaltijd"] = "diner"): Recept => ({
  id,
  naam: id,
  maaltijd,
  porties: 2,
  bron: "eigen",
  tags,
  ingredienten,
  toegevoegd: "2026-01-01",
});

const ctx = (deel: Partial<PlanContext> = {}): PlanContext => ({
  wekenGeleden: new Map(),
  nietGekookt: new Set(),
  besparing: new Map(),
  restjes: new Map(),
  vastgezet: [],
  rouleren: true,
  ...deel,
});

describe("scoreRecept", () => {
  it("telt bonus, restjes, niet gekookt en weken sinds laatst op", () => {
    const s = scoreRecept(
      recept("a"),
      ctx({ besparing: new Map([["a", 2.4]]), restjes: new Map([["a", 1]]), nietGekookt: new Set(["a"]), wekenGeleden: new Map([["a", 4]]) }),
    );
    expect(s.score).toBeCloseTo(2.4 * 3 + 1 * 2 + 5 + 4);
    expect(s.redenen).toContain("bonus bespaart €2,40");
    expect(s.redenen).toContain("4 weken niet gegeten");
  });

  it("nooit gegeten → +6, weken gemaximeerd op 6", () => {
    expect(scoreRecept(recept("a"), ctx()).score).toBe(6);
    expect(scoreRecept(recept("a"), ctx({ wekenGeleden: new Map([["a", 20]]) })).score).toBe(6);
  });

  it("rustregel: recent gegeten zonder bonus → −8", () => {
    const s = scoreRecept(recept("a"), ctx({ wekenGeleden: new Map([["a", 1]]) }));
    expect(s.score).toBe(1 - 8);
  });

  it("rustregel geldt pas bij rouleren", () => {
    expect(scoreRecept(recept("a"), ctx({ rouleren: false, wekenGeleden: new Map([["a", 1]]) })).score).toBe(1);
  });

  it("bonus mag de rustregel breken", () => {
    const s = scoreRecept(recept("a"), ctx({ wekenGeleden: new Map([["a", 1]]), besparing: new Map([["a", 1]]) }));
    expect(s.score).toBe(1 + 3);
  });
});

describe("kiesMenu", () => {
  it("alleen diners", () => {
    const r = kiesMenu([recept("a"), recept("ontbijt", [], undefined, "ontbijt")], ctx(), 6);
    expect(r.gekozen).not.toContain("ontbijt");
  });

  it("recept hooguit 2× per week", () => {
    const r = kiesMenu([recept("a"), recept("b")], ctx(), 6);
    expect(r.gekozen).toHaveLength(4);
    expect(r.gekozen.filter((id) => id === "a")).toHaveLength(2);
    expect(r.gekozen.filter((id) => id === "b")).toHaveLength(2);
  });

  it("vastgezet recept zit er altijd in, ook met lage score", () => {
    const recepten = ["a", "b", "c", "d", "e", "f", "g"].map((id) => recept(id));
    const r = kiesMenu(recepten, ctx({ vastgezet: ["g"], wekenGeleden: new Map([["g", 0]]) }), 6);
    expect(r.gekozen[0]).toBe("g");
    expect(r.gekozen).toHaveLength(6);
    expect(r.scores.find((s) => s.receptId === "g")?.redenen).toContain("vastgezet (vooruit gekocht)");
  });

  it("recent gegeten recept valt af zonder bonus, maar komt erin met bonus", () => {
    const recepten = ["a", "b", "c", "d", "e", "f", "g"].map((id) => recept(id));
    const recent = new Map([["g", 1]]);
    expect(kiesMenu(recepten, ctx({ wekenGeleden: recent }), 6).gekozen).not.toContain("g");
    expect(kiesMenu(recepten, ctx({ wekenGeleden: recent, besparing: new Map([["g", 2]]) }), 6).gekozen[0]).toBe("g");
  });

  it("variatie: −3 per al gekozen tag", () => {
    const recepten = [recept("vis1", ["vis"]), recept("vis2", ["vis"]), recept("pasta", ["pasta"])];
    // Gelijke basisscore: na vis1 wint pasta van vis2.
    expect(kiesMenu(recepten, ctx(), 2).gekozen).toEqual(["vis1", "pasta"]);
  });

  it("tweede keer zelfde recept krijgt −6", () => {
    // a heeft 5 punten voorsprong (nietGekookt), minder dan de herhalingsstraf.
    const recepten = [recept("a"), recept("b")];
    expect(kiesMenu(recepten, ctx({ nietGekookt: new Set(["a"]) }), 2).gekozen).toEqual(["a", "b"]);
  });

  it("minder recepten dan gevraagd → herhalingen, kortere lijst", () => {
    expect(kiesMenu([recept("a")], ctx(), 6).gekozen).toEqual(["a", "a"]);
  });
});

describe("dagVolgorde", () => {
  const artikel = (id: string, deel: Partial<Artikel>): Artikel => ({
    id,
    naam: id,
    eenheid: "g",
    standaard: false,
    voorraadkast: false,
    producten: [1],
    afgewezen: [],
    bederfelijk: false,
    verbruikHistorie: [],
    ...deel,
  });
  const artikelen = new Map<string, Artikel>([
    ["zalm", artikel("zalm", { bederfelijk: true, houdbaarheidDagen: 2 })],
    ["gehakt", artikel("gehakt", { bederfelijk: true, houdbaarheidDagen: 3 })],
    ["diepvriesspinazie", artikel("diepvriesspinazie", { houdbaarheidDagen: 180 })],
    ["pasta", artikel("pasta", { houdbaarheidDagen: 365 })],
  ]);
  const recepten = [
    recept("spinazie", [], [{ artikel: "diepvriesspinazie", hoeveelheid: 450 }]),
    recept("pasta", [], [{ artikel: "pasta", hoeveelheid: 250 }, { artikel: "onbekend", hoeveelheid: 1 }]),
    recept("gehakt", [], [{ artikel: "gehakt", hoeveelheid: 300 }]),
    recept("vis", [], [{ artikel: "zalm", hoeveelheid: 250 }, { artikel: "pasta", hoeveelheid: 100 }]),
  ];

  it("vis eerst, diepvries/houdbaar achteraan (stabiel)", () => {
    expect(dagVolgorde(["spinazie", "pasta", "gehakt", "vis"], recepten, artikelen)).toEqual(["vis", "gehakt", "spinazie", "pasta"]);
  });
});
