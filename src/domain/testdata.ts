// Hulpjes voor tests: een ProductPrijs met redelijke standaardwaarden.
import type { ProductPrijs } from "../types.js";

export function maakPrijs(deel: Partial<ProductPrijs> & { productId: number; prijs: number }): ProductPrijs {
  return {
    titel: `Product ${deel.productId}`,
    merk: null,
    verpakking: "1 l",
    netContents: null,
    nu: null,
    actieCode: null,
    actieOmschrijving: null,
    bestelbaar: true,
    periode: { start: "2026-11-02", eind: "2026-11-08" },
    ...deel,
  };
}
