import { describe, expect, it } from "vitest";
import { parseActie } from "./actie.js";
import { besteEenheidsprijs, isEchteBonus, isPermanent, kosten, regulierePrijs, stukprijs } from "./prijs.js";
import { maakPrijs } from "./testdata.js";

const metActie = (prijs: number, nu: number | null, omschrijving: string | null, code: string | null = "X_FOR_Y") => {
  const p = maakPrijs({ productId: 1, prijs, nu, actieOmschrijving: omschrijving, actieCode: omschrijving ? code : null });
  return { p, actie: parseActie(p.actieOmschrijving, p.actieCode) };
};

describe("kosten", () => {
  it("zonder actie", () => {
    const { p, actie } = metActie(0.79, null, null);
    expect(kosten(3, p, actie)).toBe(2.37);
    expect(kosten(0, p, actie)).toBe(0);
  });

  it("2 voor 2.99 (nu == prijs)", () => {
    const { p, actie } = metActie(1.79, 1.79, "2 voor 2.99");
    expect(kosten(1, p, actie)).toBe(1.79);
    expect(kosten(2, p, actie)).toBe(2.99);
    expect(kosten(3, p, actie)).toBe(4.78);
    expect(kosten(4, p, actie)).toBe(5.98);
  });

  it("1+1 gratis", () => {
    const { p, actie } = metActie(1.5, 1.5, "1+1 gratis");
    expect(kosten(1, p, actie)).toBe(1.5);
    expect(kosten(2, p, actie)).toBe(1.5);
    expect(kosten(3, p, actie)).toBe(3);
    expect(kosten(24, p, actie)).toBe(18);
  });

  it("2e halve prijs", () => {
    const { p, actie } = metActie(2, 2, "2e halve prijs");
    expect(kosten(2, p, actie)).toBe(3);
  });

  it("procentkorting gebruikt nu", () => {
    const { p, actie } = metActie(1.04, 0.78, "25% korting");
    expect(kosten(2, p, actie)).toBe(1.56);
  });

  it("groepsdeal die duurder is dan los wordt niet gebruikt", () => {
    const { p, actie } = metActie(2, 2, "2 voor 5");
    expect(kosten(2, p, actie)).toBe(4);
  });
});

describe("permanent en regulier", () => {
  it("BUNDLE_BULK volumevoordeel is permanent: nu is de normale prijs", () => {
    const { p, actie } = metActie(7.92, 7.52, "5% volume voordeel", "BUNDLE_BULK");
    expect(isPermanent(p)).toBe(true);
    expect(regulierePrijs(p)).toBe(7.52);
    expect(stukprijs(p, actie)).toBe(7.52);
    expect(isEchteBonus(p, actie)).toBe(false);
  });

  it("gewone bonus is niet permanent", () => {
    const { p, actie } = metActie(1.2, 0.9, "voor 0.90");
    expect(isPermanent(p)).toBe(false);
    expect(regulierePrijs(p)).toBe(1.2);
    expect(stukprijs(p, actie)).toBe(0.9);
    expect(isEchteBonus(p, actie)).toBe(true);
  });

  it("geen bonus zonder actie", () => {
    const { p, actie } = metActie(0.79, null, null);
    expect(isEchteBonus(p, actie)).toBe(false);
  });

  it("groepsdeal zonder voordeel is geen echte bonus", () => {
    const { p, actie } = metActie(2, 2, "2 voor 5");
    expect(isEchteBonus(p, actie)).toBe(false);
  });
});

describe("besteEenheidsprijs", () => {
  it("1+1 gratis op 1 L à 1.50 → 0.75 per L", () => {
    const { p, actie } = metActie(1.5, 1.5, "1+1 gratis");
    expect(besteEenheidsprijs(p, actie, 1000) * 1000).toBeCloseTo(0.75);
  });
  it("zonder actie: prijs / inhoud", () => {
    const { p, actie } = metActie(0.79, null, null);
    expect(besteEenheidsprijs(p, actie, 1000) * 1000).toBeCloseTo(0.79);
  });
});
