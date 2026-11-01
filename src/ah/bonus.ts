// Bonusperiodes en alle landelijke bonusproducten van een periode.
import { z } from "zod";
import type { BonusProduct, Periode } from "../types.js";
import { AhFout, ahGet, ahGraphql, GELIJKTIJDIG, parallel, parse } from "./client.js";
import { GqlProductSchema, naarProductPrijs, PRODUCT_VELDEN, productPrijzen } from "./producten.js";

const GROEPEN_PER_VERZOEK = 8;

const MetadataSchema = z.object({
  periods: z.array(
    z.object({
      bonusStartDate: z.string(),
      bonusEndDate: z.string(),
      tabs: z
        .array(
          z.object({
            urlMetadataList: z
              .array(z.object({ bonusType: z.string().nullish(), description: z.string().nullish() }))
              .nullish(),
          }),
        )
        .nullish(),
    }),
  ),
});
type Metadata = z.infer<typeof MetadataSchema>;

// Metadata verandert hooguit per dag; één keer per proces ophalen is genoeg.
let metadataBelofte: Promise<Metadata> | null = null;
function metadata(): Promise<Metadata> {
  metadataBelofte ??= ahGet("/mobile-services/bonuspage/v3/metadata", MetadataSchema).catch((e: unknown) => {
    metadataBelofte = null;
    throw e;
  });
  return metadataBelofte;
}

export async function bonusPeriodes(): Promise<Periode[]> {
  const { periods } = await metadata();
  return periods.map((p) => ({ start: p.bonusStartDate, eind: p.bonusEndDate }));
}

/** De bonusperiode waar `datum` (YYYY-MM-DD) in valt, of null als AH die (nog) niet kent. */
export async function periodeVoorDatum(datum: string): Promise<Periode | null> {
  return (await bonusPeriodes()).find((p) => p.start <= datum && datum <= p.eind) ?? null;
}

const SectieSchema = z.object({
  bonusGroupOrProducts: z
    .array(
      z.object({
        product: z
          .object({ webshopId: z.number(), segmentId: z.string().nullish(), bonusSegmentDescription: z.string().nullish() })
          .nullish(),
        bonusGroup: z.object({ id: z.string(), segmentDescription: z.string().nullish() }).nullish(),
      }),
    )
    .nullish(),
});

const PromotieSchema = z.array(
  z.object({ id: z.string(), title: z.string().nullish(), products: z.array(GqlProductSchema).nullish() }),
);

interface Groep {
  id: string;
  naam: string | null;
  categorie: string;
}

/** Haalt de producten van meerdere bonusgroepen op in één GraphQL-verzoek (via aliassen). */
async function groepProducten(groepen: Groep[], periode: Periode): Promise<BonusProduct[]> {
  if (!groepen.length) return [];
  const velden = groepen
    .map(
      (g, i) =>
        `g${i}: bonusPromotions(input:{id:${JSON.stringify(g.id)},periodStart:$s,periodEnd:$e,forcePromotionVisibility:true,showAllPromotionSegments:true}){ id title products{ ${PRODUCT_VELDEN} } }`,
    )
    .join("\n");
  const { data, foutAliassen, fouten } = await ahGraphql(`query B($s:String,$e:String){ ${velden} }`, {
    s: periode.start,
    e: periode.eind,
  });
  if (!data) {
    const rest = groepen.filter((_, i) => !foutAliassen.includes(`g${i}`));
    if (foutAliassen.length && rest.length < groepen.length) return groepProducten(rest, periode);
    throw new AhFout(`AH GraphQL gaf geen bonusgroepen: ${fouten.join("; ") || "onbekende fout"}`, null, "/graphql");
  }
  return groepen.flatMap((g, i) =>
    parse(PromotieSchema, data[`g${i}`] ?? [], "/graphql bonusPromotions").flatMap((promo) =>
      (promo.products ?? []).flatMap((p) => {
        const pp = naarProductPrijs(p, periode);
        return pp ? [{ ...pp, groep: promo.title ?? g.naam, groepId: g.id, categorie: g.categorie }] : [];
      }),
    ),
  );
}

/**
 * Alle landelijke (NATIONAL) bonusproducten van een periode, met periode-correcte prijzen.
 * Verzoeken: 1 metadata + 1 per categorie + 1 per 8 bonusgroepen + 1 per 25 losse producten.
 */
export async function bonusProducten(periode: Periode): Promise<BonusProduct[]> {
  const meta = (await metadata()).periods.find((p) => p.bonusStartDate === periode.start && p.bonusEndDate === periode.eind);
  if (!meta) throw new AhFout(`Bonusperiode ${periode.start} t/m ${periode.eind} is niet (meer) beschikbaar bij AH`, null, "/bonuspage/v3/metadata");

  const categorieen = [
    ...new Set(
      (meta.tabs ?? []).flatMap((t) =>
        (t.urlMetadataList ?? []).flatMap((u) => (u.bonusType === "NATIONAL" && u.description ? [u.description] : [])),
      ),
    ),
  ];

  const secties = await parallel(categorieen, GELIJKTIJDIG, async (categorie) => {
    const q = new URLSearchParams({ application: "AHWEBSHOP", date: periode.start, promotionType: "NATIONAL", category: categorie });
    const s = await ahGet(`/mobile-services/bonuspage/v2/section?${q}`, SectieSchema);
    return { categorie, items: s.bonusGroupOrProducts ?? [] };
  });

  const groepen = new Map<string, Groep>();
  const losseProducten = new Map<number, { groep: string | null; groepId: string | null; categorie: string }>();
  for (const { categorie, items } of secties) {
    for (const { product, bonusGroup } of items) {
      if (bonusGroup && !groepen.has(bonusGroup.id))
        groepen.set(bonusGroup.id, { id: bonusGroup.id, naam: bonusGroup.segmentDescription ?? null, categorie });
      if (product && !losseProducten.has(product.webshopId))
        losseProducten.set(product.webshopId, {
          groep: product.bonusSegmentDescription ?? null,
          groepId: product.segmentId ?? null,
          categorie,
        });
    }
  }

  const groepLijst = [...groepen.values()];
  const brokken = Array.from({ length: Math.ceil(groepLijst.length / GROEPEN_PER_VERZOEK) }, (_, i) =>
    groepLijst.slice(i * GROEPEN_PER_VERZOEK, (i + 1) * GROEPEN_PER_VERZOEK),
  );
  const uitGroepen = (await parallel(brokken, GELIJKTIJDIG, (b) => groepProducten(b, periode))).flat();
  const prijzen = await productPrijzen([...losseProducten.keys()], periode);

  // Ontdubbelen op productId; losse producten eerst, daarna groepsproducten.
  const uit = new Map<number, BonusProduct>();
  for (const [id, info] of losseProducten) {
    const p = prijzen.get(id);
    if (p) uit.set(id, { ...p, ...info });
  }
  for (const p of uitGroepen) if (!uit.has(p.productId)) uit.set(p.productId, p);
  return [...uit.values()];
}
