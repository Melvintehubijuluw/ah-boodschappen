import { describe, expect, it } from "vitest";
import {
  formatEenheidsprijs,
  formatEuro,
  formatHoeveelheid,
  inhoudVanProduct,
  parseHoeveelheid,
} from "./eenheden.js";

describe("parseHoeveelheid", () => {
  it.each([
    ["1 l", 1000, "ml"],
    ["1 liter", 1000, "ml"],
    ["750 ml", 750, "ml"],
    ["33 cl", 330, "ml"],
    ["500 g", 500, "g"],
    ["1 kg", 1000, "g"],
    ["ca. 500 g", 500, "g"],
    ["6 x 1,5 l", 9000, "ml"],
    ["2 x 125 g", 250, "g"],
    ["3 stuks", 3, "stuk"],
    ["40 stuks", 40, "stuk"],
    ["per stuk", 1, "stuk"],
    ["38 wasbeurten", 38, "stuk"],
    ["10 rollen", 10, "stuk"],
    ["20 tabletten", 20, "stuk"],
    ["10 zakjes", 10, "stuk"],
    ["1.0 Liter", 1000, "ml"],
    ["500 Gram", 500, "g"],
    ["0.75 Kilogram", 750, "g"],
    ["1,1 l", 1100, "ml"],
  ] as const)("%s → %d %s", (tekst, waarde, eenheid) => {
    expect(parseHoeveelheid(tekst)).toEqual({ waarde, eenheid });
  });

  it.each(["", "onbekend", "1 doos", "abc g"])("onbekend: %s → null", (tekst) => {
    expect(parseHoeveelheid(tekst)).toBeNull();
  });
});

describe("inhoudVanProduct", () => {
  it("geeft voorkeur aan netContents", () => {
    expect(inhoudVanProduct("ca. 1 l", ["0.75 Kilogram"])).toEqual({ waarde: 750, eenheid: "g" });
  });
  it("neemt de eerste leesbare netContents", () => {
    expect(inhoudVanProduct("1 l", ["zie verpakking", "1.5 Liter"])).toEqual({ waarde: 1500, eenheid: "ml" });
  });
  it("valt terug op verpakking", () => {
    expect(inhoudVanProduct("6 x 1,5 l", null)).toEqual({ waarde: 9000, eenheid: "ml" });
    expect(inhoudVanProduct("500 g", ["???"])).toEqual({ waarde: 500, eenheid: "g" });
  });
  it("null als niets leesbaar is", () => {
    expect(inhoudVanProduct("los", null)).toBeNull();
  });
});

describe("formatten", () => {
  it("formatHoeveelheid", () => {
    expect(formatHoeveelheid(1500, "ml")).toBe("1,5 L");
    expect(formatHoeveelheid(1000, "ml")).toBe("1 L");
    expect(formatHoeveelheid(750, "ml")).toBe("750 ml");
    expect(formatHoeveelheid(1200, "g")).toBe("1,2 kg");
    expect(formatHoeveelheid(300, "g")).toBe("300 g");
    expect(formatHoeveelheid(3, "stuk")).toBe("3 stuks");
    expect(formatHoeveelheid(1, "stuk")).toBe("1 stuk");
  });
  it("formatEenheidsprijs", () => {
    expect(formatEenheidsprijs(0.00084, "ml")).toBe("€0,84/L");
    expect(formatEenheidsprijs(0.00398, "g")).toBe("€3,98/kg");
    expect(formatEenheidsprijs(0.25, "stuk")).toBe("€0,25/stuk");
  });
  it("formatEuro", () => {
    expect(formatEuro(1.5)).toBe("€1,50");
    expect(formatEuro(12)).toBe("€12,00");
    expect(formatEuro(1.005)).toBe("€1,01");
    expect(formatEuro(-0.4)).toBe("-€0,40");
  });
});
