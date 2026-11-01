import { describe, expect, it } from "vitest";
import type { Artikel } from "../data/schema.js";
import type { ProductPrijs } from "../types.js";
import { bepaalAankoop, maxVoorraad, werkVerbruikBij, type Behoefte, type Kandidaat } from "./bestellen.js";
import { maakPrijs } from "./testdata.js";

// Huishouden: AH houdbare melk huismerk €0,79 per 1 L. Hoeveelheden in ml.
const kandidaat = (productId: number, titel: string, inhoud: number, prijs: Partial<ProductPrijs> & { prijs: number }): Kandidaat => ({
  productId,
  titel,
  inhoud,
  prijs: maakPrijs({ productId, titel, ...prijs }),
});
const ahMelk = kandidaat(1, "AH Houdbare halfvolle melk", 1000, { prijs: 0.79 });
const melk = (deel: Partial<Behoefte> = {}): Behoefte => ({
  artikelId: "houdbare-melk",
  nodig: 3000,
  voorraad: 1000,
  ruimte: 0,
  eenheid: "ml",
  ...deel,
});

describe("bepaalAankoop", () => {
  it("nodig 3 L, voorraad 1 L → 2 pakken", () => {
    const { aankoop } = bepaalAankoop(melk(), [ahMelk]);
    expect(aankoop).toMatchObject({ productId: 1, aantal: 2, kosten: 1.58, hoeveelheid: 2000, nodigDeel: 2000, inslaanDeel: 0, reden: "nodig" });
  });

  it("niets nodig en geen ruimte → geen aankoop", () => {
    expect(bepaalAankoop(melk({ voorraad: 4000 }), [ahMelk]).aankoop).toBeNull();
  });

  it("Campina 'voor 0.90' is duurder dan huismerk → huismerk", () => {
    const campina = kandidaat(2, "Campina halfvolle melk", 1000, { prijs: 1.2, nu: 0.9, actieCode: "X_FOR_Y", actieOmschrijving: "voor 0.90" });
    const { aankoop } = bepaalAankoop(melk({ ruimte: 22000 }), [ahMelk, campina]);
    expect(aankoop).toMatchObject({ productId: 1, aantal: 2, reden: "nodig" });
  });

  it("Campina 1+1 gratis (€0,75/L) → inslaan tot de ruimte vol is", () => {
    const campina = kandidaat(2, "Campina halfvolle melk", 1000, { prijs: 1.5, nu: 1.5, actieCode: "X_FOR_Y", actieOmschrijving: "1+1 gratis" });
    const { aankoop } = bepaalAankoop(melk({ ruimte: 22000 }), [ahMelk, campina]);
    expect(aankoop).toMatchObject({
      productId: 2,
      aantal: 24,
      kosten: 18,
      hoeveelheid: 24000,
      nodigDeel: 2000,
      inslaanDeel: 22000,
      reden: "inslaan",
      besparing: 0.96,
    });
    expect(aankoop?.referentieEenheidsprijs).toBeCloseTo(0.00079);
    expect(aankoop?.eenheidsprijs).toBeCloseTo(0.00075);
    expect(aankoop?.toelichting).toBe("1+1 gratis: €0,75/L i.p.v. €0,79/L, 24× (2 L nodig, 22 L inslaan)");
  });

  it("inslaan rondt af naar volle actiegroepen", () => {
    const campina = kandidaat(2, "Campina", 1000, { prijs: 1.5, nu: 1.5, actieCode: "X_FOR_Y", actieOmschrijving: "1+1 gratis" });
    const { aankoop } = bepaalAankoop(melk({ ruimte: 3000 }), [ahMelk, campina]);
    expect(aankoop).toMatchObject({ productId: 2, aantal: 4, reden: "inslaan" });
  });

  it("inslaan ook zonder tekort als er ruimte is", () => {
    const campina = kandidaat(2, "Campina", 1000, { prijs: 1.5, nu: 1.5, actieCode: "X_FOR_Y", actieOmschrijving: "1+1 gratis" });
    const { aankoop } = bepaalAankoop(melk({ nodig: 0, voorraad: 2000, ruimte: 6000 }), [ahMelk, campina]);
    expect(aankoop).toMatchObject({ productId: 2, aantal: 6, nodigDeel: 0, inslaanDeel: 6000, reden: "inslaan" });
  });

  it("A-merk 25% korting (€0,78/L): goedkoper voor deze week, maar niet inslaan (< 5%)", () => {
    const amerk = kandidaat(3, "A-merk melk", 1000, { prijs: 1.04, nu: 0.78, actieCode: "X_FOR_Y", actieOmschrijving: "25% korting" });
    const { aankoop } = bepaalAankoop(melk({ ruimte: 22000 }), [ahMelk, amerk]);
    expect(aankoop).toMatchObject({ productId: 3, aantal: 2, kosten: 1.56, reden: "nodig", inslaanDeel: 0, besparing: 0.02 });
  });

  it("bederfelijk (ruimte 0) met 1+1 gratis en 1 nodig → 1 stuk", () => {
    const zalm = kandidaat(4, "Zalmfilet", 1, { prijs: 4, nu: 4, actieCode: "X_FOR_Y", actieOmschrijving: "1+1 gratis" });
    const { aankoop } = bepaalAankoop({ artikelId: "zalm", nodig: 1, voorraad: 0, ruimte: 0, eenheid: "stuk" }, [zalm]);
    expect(aankoop).toMatchObject({ aantal: 1, kosten: 4, reden: "nodig" });
  });

  it("gratis extra's worden meegenomen als ze passen", () => {
    const zalm = kandidaat(4, "Zalmfilet", 1, { prijs: 4, nu: 4, actieCode: "X_FOR_Y", actieOmschrijving: "1+1 gratis" });
    const { aankoop } = bepaalAankoop({ artikelId: "zalm", nodig: 1, voorraad: 0, ruimte: 1, eenheid: "stuk" }, [zalm]);
    expect(aankoop).toMatchObject({ aantal: 2, kosten: 4, nodigDeel: 1, inslaanDeel: 1 });
  });

  it("BUNDLE_BULK 8-pak leidt nooit tot inslaan", () => {
    const achtpak = kandidaat(5, "AH melk 8-pak", 8000, { prijs: 6.32, nu: 6.0, actieCode: "BUNDLE_BULK", actieOmschrijving: "5% volume voordeel" });
    const { aankoop } = bepaalAankoop(melk({ ruimte: 40000 }), [ahMelk, achtpak]);
    expect(aankoop?.reden).toBe("nodig");
    expect(aankoop?.aantal).toBe(1);
    const zonderRuimte = bepaalAankoop(melk(), [ahMelk, achtpak]).aankoop;
    expect(zonderRuimte).toMatchObject({ productId: 1, aantal: 2 });
  });

  it("kandidaat zonder inhoud wordt overgeslagen met melding", () => {
    const raar = kandidaat(6, "Onbekend pak", 0, { prijs: 0.1 });
    const { aankoop, meldingen } = bepaalAankoop(melk(), [raar, ahMelk]);
    expect(aankoop?.productId).toBe(1);
    expect(meldingen.join(" ")).toContain("Onbekend pak");
  });

  it("onbekende actie wordt als geen actie behandeld, met melding", () => {
    const vreemd = kandidaat(7, "Vreemde melk", 1000, { prijs: 0.8, actieCode: "X_FOR_Y", actieOmschrijving: "Spaar 10 zegels" });
    const { aankoop, meldingen } = bepaalAankoop(melk(), [vreemd, ahMelk]);
    expect(aankoop?.productId).toBe(1);
    expect(meldingen.some((m) => m.includes("Spaar 10 zegels"))).toBe(true);
  });

  it("geen bruikbare kandidaten → null met melding", () => {
    const { aankoop, meldingen } = bepaalAankoop(melk(), []);
    expect(aankoop).toBeNull();
    expect(meldingen.length).toBeGreaterThan(0);
  });

  it("kiest per bruikbare hoeveelheid, niet per verpakking", () => {
    const groot = kandidaat(8, "Melk 1,5 L", 1500, { prijs: 1.1 });
    // 1 L nodig, geen ruimte: 1,5 L-pak telt maar voor 1 L → €1,10/L, duurder dan huismerk.
    const { aankoop } = bepaalAankoop(melk({ nodig: 1000, voorraad: 0 }), [groot, ahMelk]);
    expect(aankoop?.productId).toBe(1);
  });
});

describe("maxVoorraad", () => {
  const artikel = (deel: Partial<Artikel>): Artikel => ({
    id: "melk",
    naam: "Melk",
    eenheid: "ml",
    standaard: true,
    voorraadkast: false,
    producten: [1],
    afgewezen: [],
    bederfelijk: false,
    verbruikHistorie: [],
    ...deel,
  });
  it("verbruik × houdbaarheid × (1 − marge) / 7", () => {
    expect(maxVoorraad(artikel({ verbruikPerWeek: 3000, houdbaarheidDagen: 70 }))).toBeCloseTo(24000);
    expect(maxVoorraad(artikel({ verbruikPerWeek: 3000, houdbaarheidDagen: 70 }), 0)).toBeCloseTo(30000);
  });
  it("null als gegevens ontbreken", () => {
    expect(maxVoorraad(artikel({ verbruikPerWeek: 3000 }))).toBeNull();
    expect(maxVoorraad(artikel({ houdbaarheidDagen: 70 }))).toBeNull();
  });
});

describe("werkVerbruikBij", () => {
  it("voegt toe, bewaart max 8 en middelt de laatste 4", () => {
    const r = werkVerbruikBij([1, 2, 3, 4, 5, 6, 7, 8], 9);
    expect(r.historie).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.gemiddelde).toBe(7.5);
  });
  it("met korte historie", () => {
    expect(werkVerbruikBij([], 3000)).toEqual({ historie: [3000], gemiddelde: 3000 });
    expect(werkVerbruikBij([1000], 2000).gemiddelde).toBe(1500);
    expect(werkVerbruikBij([1, 1], 2).gemiddelde).toBe(1.3);
  });
});
