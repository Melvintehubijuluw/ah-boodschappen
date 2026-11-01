import { describe, expect, it } from "vitest";
import { parseActie } from "./actie.js";

describe("parseActie", () => {
  it.each([
    ["1+1 gratis", { soort: "groep", aantal: 2, betaalStuks: 1 }],
    ["2+1 gratis", { soort: "groep", aantal: 3, betaalStuks: 2 }],
    ["1 + 1 GRATIS", { soort: "groep", aantal: 2, betaalStuks: 1 }],
    ["2e gratis", { soort: "groep", aantal: 2, betaalStuks: 1 }],
    ["2e artikel gratis", { soort: "groep", aantal: 2, betaalStuks: 1 }],
    ["2e halve prijs", { soort: "groep", aantal: 2, betaalStuks: 1.5 }],
    ["2e artikel 50% korting", { soort: "groep", aantal: 2, betaalStuks: 1.5 }],
    ["2e verpakking 25% korting", { soort: "groep", aantal: 2, betaalStuks: 1.75 }],
    ["3 halen 2 betalen", { soort: "groep", aantal: 3, betaalStuks: 2 }],
    ["2 voor 2.99", { soort: "groep", aantal: 2, bedrag: 2.99 }],
    ["2 voor 2,99", { soort: "groep", aantal: 2, bedrag: 2.99 }],
    ["3 voor €3", { soort: "groep", aantal: 3, bedrag: 3 }],
    ["2 voor 5", { soort: "groep", aantal: 2, bedrag: 5 }],
    ["25% korting", { soort: "stukprijs" }],
    ["voor 1.99", { soort: "stukprijs" }],
    ["5% volume voordeel", { soort: "stukprijs" }],
    ["Extra korting", { soort: "stukprijs" }],
  ] as const)("%s", (tekst, verwacht) => {
    expect(parseActie(tekst, "X_FOR_Y")).toEqual(verwacht);
  });

  it("BUNDLE_BULK is altijd stukprijs", () => {
    expect(parseActie("8 voor 6.00", "BUNDLE_BULK")).toEqual({ soort: "stukprijs" });
  });

  it("geen actie", () => {
    expect(parseActie(null, null)).toEqual({ soort: "geen" });
    expect(parseActie("  ", null)).toEqual({ soort: "geen" });
  });

  it("onbekende tekst", () => {
    expect(parseActie("Gratis bezorging", null)).toEqual({ soort: "onbekend", omschrijving: "Gratis bezorging" });
  });

  it("actiecode zonder tekst is onbekend", () => {
    expect(parseActie(null, "X_FOR_Y")).toEqual({ soort: "onbekend", omschrijving: "X_FOR_Y" });
  });
it("feestfavoriet is geen korting", () => {
    expect(parseActie("Feestfavoriet", "FESTIVE_FAVOURITE")).toEqual({ soort: "geen" });
  });

  it("acties met actieprijs in nu zijn stukprijs", () => {
    expect(parseActie("BONUS", "BONUS")).toEqual({ soort: "stukprijs" });
    expect(parseActie("per 100 GRAM voor €2.69", "WEIGHT")).toEqual({ soort: "stukprijs" });
    expect(parseActie("€1.00 euro korting", "AMOUNT")).toEqual({ soort: "stukprijs" });
    expect(parseActie("1+1 gratis", "PERSOONLIJK")).toEqual({ soort: "groep", aantal: 2, betaalStuks: 1 });
  });
});