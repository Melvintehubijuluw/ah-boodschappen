// Producten zoeken en prijzen per bonusperiode ophalen.
import { z } from "zod";
import type { Periode, ProductPrijs, ZoekResultaat } from "../types.js";
import { AhFout, ahGet, ahGraphql, GELIJKTIJDIG, parallel, parse } from "./client.js";

const BATCH = 25;

const ZoekSchema = z.object({
  products: z
    .array(
      z.object({
        webshopId: z.number(),
        title: z.string(),
        brand: z.string().nullish(),
        salesUnitSize: z.string().nullish(),
        unitPriceDescription: z.string().nullish(),
        currentPrice: z.number().nullish(),
        priceBeforeBonus: z.number().nullish(),
        isBonus: z.boolean().nullish(),
        bonusMechanism: z.string().nullish(),
        isOrderable: z.boolean().nullish(),
        mainCategory: z.string().nullish(),
      }),
    )
    .nullish(),
});

export async function zoekProducten(term: string, aantal = 10): Promise<ZoekResultaat[]> {
  const q = new URLSearchParams({ query: term, sortOn: "RELEVANCE", size: String(aantal), page: "0" });
  const { products } = await ahGet(`/mobile-services/product/search/v2?${q}`, ZoekSchema);
  return (products ?? []).flatMap((p) => {
    // Zonder priceBeforeBonus is currentPrice de normale prijs (komt voor bij "hasListPrice"-producten).
    const prijs = p.priceBeforeBonus ?? p.currentPrice;
    if (prijs == null) return [];
    return [
      {
        productId: p.webshopId,
        titel: p.title,
        merk: p.brand ?? null,
        verpakking: p.salesUnitSize ?? "",
        prijs,
        nu: p.priceBeforeBonus != null ? (p.currentPrice ?? null) : null,
        eenheidsprijsTekst: p.unitPriceDescription ?? null,
        actieOmschrijving: p.isBonus ? (p.bonusMechanism ?? null) : null,
        isBonus: p.isBonus ?? false,
        bestelbaar: p.isOrderable ?? true,
        categorie: p.mainCategory ?? null,
      },
    ];
  });
}

/** GraphQL-velden van een product; verwacht variabelen $s en $e (periode). */
export const PRODUCT_VELDEN = `id title brand salesUnitSize availability{isOrderable} tradeItem{contents{netContents}}
  priceV2(periodStart:$s,periodEnd:$e,forcePromotionVisibility:true){ now{amount} was{amount} promotionLabel{tiers{mechanism description}} }`;

const Bedrag = z.object({ amount: z.number().nullish() }).nullish();
export const GqlProductSchema = z.object({
  id: z.number(),
  title: z.string().nullish(),
  brand: z.string().nullish(),
  salesUnitSize: z.string().nullish(),
  availability: z.object({ isOrderable: z.boolean().nullish() }).nullish(),
  tradeItem: z.object({ contents: z.object({ netContents: z.array(z.string()).nullish() }).nullish() }).nullish(),
  priceV2: z
    .object({
      now: Bedrag,
      was: Bedrag,
      promotionLabel: z
        .object({ tiers: z.array(z.object({ mechanism: z.string().nullish(), description: z.string().nullish() })).nullish() })
        .nullish(),
    })
    .nullish(),
});
export type GqlProduct = z.infer<typeof GqlProductSchema>;

/** Zet een GraphQL-product om; null als er geen bruikbare prijs is (bijv. "Service kosten"). */
export function naarProductPrijs(p: GqlProduct, periode: Periode): ProductPrijs | null {
  const nu = p.priceV2?.now?.amount ?? null;
  const prijs = p.priceV2?.was?.amount ?? nu;
  if (prijs == null || prijs <= 0 || !p.title) return null;
  const tiers = p.priceV2?.promotionLabel?.tiers ?? [];
  const omschrijvingen = tiers.map((t) => t.description).filter((d): d is string => !!d);
  return {
    productId: p.id,
    titel: p.title,
    merk: p.brand ?? null,
    verpakking: p.salesUnitSize ?? "",
    netContents: p.tradeItem?.contents?.netContents ?? null,
    prijs,
    nu,
    actieCode: tiers[0]?.mechanism ?? null,
    actieOmschrijving: omschrijvingen.length ? omschrijvingen.join(" / ") : null,
    bestelbaar: p.availability?.isOrderable ?? true,
    periode,
  };
}

/**
 * Eén GraphQL-verzoek voor een batch ids. Let op: één onbekend id maakt de héle `data` null;
 * dan proberen we opnieuw zonder de aliassen die een fout gaven.
 */
async function prijzenBatch(ids: number[], periode: Periode): Promise<GqlProduct[]> {
  if (!ids.length) return [];
  const velden = ids.map((id) => `p${id}: product(id:${id}){ ${PRODUCT_VELDEN} }`).join("\n");
  const { data, foutAliassen, fouten } = await ahGraphql(`query Q($s:String,$e:String){ ${velden} }`, {
    s: periode.start,
    e: periode.eind,
  });
  if (!data) {
    const rest = ids.filter((id) => !foutAliassen.includes(`p${id}`));
    if (foutAliassen.length && rest.length < ids.length) return prijzenBatch(rest, periode);
    throw new AhFout(`AH GraphQL gaf geen productdata: ${fouten.join("; ") || "onbekende fout"}`, null, "/graphql");
  }
  return Object.values(data)
    .filter((v) => v != null)
    .map((v) => parse(GqlProductSchema, v, "/graphql product"));
}

/** Prijzen voor de gegeven producten in een periode; onbekende of prijsloze producten ontbreken. */
export async function productPrijzen(ids: number[], periode: Periode): Promise<Map<number, ProductPrijs>> {
  const uniek = [...new Set(ids)];
  const batches = Array.from({ length: Math.ceil(uniek.length / BATCH) }, (_, i) => uniek.slice(i * BATCH, (i + 1) * BATCH));
  const resultaten = await parallel(batches, GELIJKTIJDIG, (b) => prijzenBatch(b, periode));
  const uit = new Map<number, ProductPrijs>();
  for (const p of resultaten.flat()) {
    const pp = naarProductPrijs(p, periode);
    if (pp) uit.set(pp.productId, pp);
  }
  return uit;
}
