// Live tests tegen de echte AH API; draaien alleen met AH_LIVE=1.
import { describe, expect, it } from "vitest";
import { bonusPeriodes, bonusProducten, periodeVoorDatum, productPrijzen, zoekProducten } from "./index.js";

describe.skipIf(!process.env.AH_LIVE)("AH API (live)", () => {
  it("zoekt houdbare melk", async () => {
    const res = await zoekProducten("houdbare melk");
    const melk = res.find((r) => r.productId === 450534);
    expect(melk?.titel).toBe("AH Houdbare halfvolle melk");
    expect(melk?.prijs).toBeCloseTo(0.84, 1);
  });

  it("kent bonusperiodes", async () => {
    const periodes = await bonusPeriodes();
    expect(periodes.length).toBeGreaterThan(0);
    for (const p of periodes) expect(p.start <= p.eind).toBe(true);
  });

  it("geeft periode-correcte prijzen en laat onbekende ids weg", async () => {
    const periode = await periodeVoorDatum("2026-11-03");
    expect(periode).toEqual({ start: "2026-11-02", eind: "2026-11-08" });
    const prijzen = await productPrijzen([450534, 48785, 48785, 999999999], periode!);
    expect(prijzen.size).toBe(2);
    expect(prijzen.get(48785)?.actieOmschrijving).toBe("2 voor 2.99");
    expect(prijzen.get(48785)?.actieCode).toBe("X_FOR_Y");
    expect(prijzen.get(450534)?.netContents).toEqual(["1.0 Liter"]);
  });

  it("haalt alle bonusproducten van een periode op", { timeout: 120_000 }, async () => {
    const periode = await periodeVoorDatum("2026-11-03");
    const start = Date.now();
    const producten = await bonusProducten(periode!);
    console.log(`${producten.length} bonusproducten in ${((Date.now() - start) / 1000).toFixed(1)}s`);
    expect(producten.length).toBeGreaterThan(100);
    expect(new Set(producten.map((p) => p.productId)).size).toBe(producten.length);
    for (const p of producten) {
      expect(p.prijs).toBeGreaterThan(0);
      expect(p.categorie).toBeTruthy();
    }
    const yoghurt = producten.find((p) => p.productId === 48785);
    expect(yoghurt?.groepId).toBe("817928");
  });
});
