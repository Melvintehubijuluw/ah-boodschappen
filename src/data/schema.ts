// Schema's van de databestanden in data/ en weken/. Elk bestand wordt bij inlezen gevalideerd.
import { z } from "zod";

export const EenheidSchema = z.enum(["g", "ml", "stuk"]);

/**
 * Een artikel is een behoefte ("houdbare halfvolle melk"), los van merk.
 * `producten[0]` is het standaardproduct; de rest zijn goedgekeurde vervangers (zelfde product, ander merk of verpakking).
 */
export const ArtikelSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  naam: z.string(),
  eenheid: EenheidSchema,
  /** Staat op de wekelijkse standaardlijst. */
  standaard: z.boolean().default(false),
  /** Basisingrediënt (zout, olie, kruiden): alleen bestellen als de voorraad laag is. */
  voorraadkast: z.boolean().default(false),
  producten: z.array(z.number().int()).min(1),
  /** Producten die bewust géén vervanger zijn (worden niet opnieuw voorgesteld). */
  afgewezen: z.array(z.number().int()).default([]),
  /** Zoekwoorden om bonusvervangers te vinden, bijv. "houdbare halfvolle melk". */
  zoekterm: z.string().optional(),
  /** Voorzichtige schatting van de houdbaarheid ongeopend, in dagen. */
  houdbaarheidDagen: z.number().positive().optional(),
  /** Snel bederfelijk (vis, vlees, verse kruiden, room): restjes krijgen voorrang. */
  bederfelijk: z.boolean().default(false),
  /** Gemiddeld verbruik per week in de eenheid van het artikel (standaardartikelen en voorraadkast). */
  verbruikPerWeek: z.number().nonnegative().optional(),
  /** Gemeten verbruik per week, nieuwste laatst (max 13 bewaard). */
  verbruikHistorie: z.array(z.number().nonnegative()).default([]),
  /** Voorraadkast: bestel aan als voorraad onder deze hoeveelheid zakt. */
  minVoorraad: z.number().nonnegative().optional(),
  notitie: z.string().optional(),
});
export type Artikel = z.infer<typeof ArtikelSchema>;

/** Bekende AH-producten met (eventueel handmatig bepaalde) inhoud. */
export const ProductSchema = z.object({
  id: z.number().int(),
  titel: z.string(),
  merk: z.string().nullable().default(null),
  verpakking: z.string(),
  /** Inhoud per verpakking in basiseenheid; null = onbekend, moet handmatig gezet worden. */
  inhoud: z.object({ waarde: z.number().positive(), eenheid: EenheidSchema }).nullable(),
  inhoudHandmatig: z.boolean().default(false),
  bijgewerkt: z.string(),
});
export type Product = z.infer<typeof ProductSchema>;

export const IngredientSchema = z.object({
  artikel: z.string(),
  /** Hoeveelheid voor het recept (2 personen) in de eenheid van het artikel. */
  hoeveelheid: z.number().positive(),
  /** Zoals in het recept geschreven, bijv. "2 tenen knoflook". */
  omschrijving: z.string().optional(),
});

export const ReceptSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  naam: z.string(),
  maaltijd: z.enum(["ontbijt", "lunch", "diner"]).default("diner"),
  porties: z.number().int().positive().default(2),
  /** URL van het online recept, of "eigen". */
  bron: z.string(),
  /** Volledige URL van het AH-favorietenlijstje. */
  ahLijst: z.string().url().optional(),
  /** Bijv. "vis", "vlees", "vega", "pasta", "rijst", "aardappel". */
  tags: z.array(z.string()).default([]),
  ingredienten: z.array(IngredientSchema).min(1),
  /** Alleen voor eigen recepten: bereidingsstappen. Online recepten linken naar de bron. */
  bereiding: z.array(z.string()).optional(),
  toegevoegd: z.string(),
});
export type Recept = z.infer<typeof ReceptSchema>;

export const VoorraadSchema = z.object({
  /** Datum (YYYY-MM-DD) van de laatste telling. */
  geteld: z.string(),
  /** Hoeveelheid per artikel-id, in de eenheid van het artikel. */
  artikelen: z.record(z.string(), z.number().nonnegative()),
});
export type Voorraad = z.infer<typeof VoorraadSchema>;

/** Producten die vooruit besteld zijn voor een recept in een latere week. */
export const VooruitSchema = z.array(
  z.object({
    artikel: z.string(),
    productId: z.number().int(),
    hoeveelheid: z.number().positive(),
    recept: z.string(),
    besteldInWeek: z.string(),
    voorWeek: z.string(),
  }),
);
export type Vooruit = z.infer<typeof VooruitSchema>;

export const BestelRegelSchema = z.object({
  productId: z.number().int(),
  titel: z.string(),
  artikel: z.string().nullable(),
  aantal: z.number().int().positive(),
  kosten: z.number().nonnegative(),
  /** nodig = deze week nodig, inslaan = extra door bonus, vooruit = voor volgende week, aanvulling = minimumbedrag. */
  reden: z.enum(["nodig", "inslaan", "vooruit", "aanvulling"]),
  toelichting: z.string().optional(),
  besparing: z.number().default(0),
});
export type BestelRegel = z.infer<typeof BestelRegelSchema>;

export const WeekSchema = z.object({
  /** ISO-week van de bezorgdatum, bijv. "2026-W45". */
  week: z.string().regex(/^\d{4}-W\d{2}$/),
  leverdatum: z.string(),
  status: z.enum(["open", "besteld", "afgerond"]).default("open"),
  menu: z
    .array(
      z.object({
        dag: z.enum(["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"]),
        recept: z.string(),
        dubbel: z.boolean().default(false),
        /** Na afloop van de week ingevuld; false = niet gekookt. */
        gekookt: z.boolean().optional(),
        vastgezet: z.boolean().default(false),
      }),
    )
    .default([]),
  /** Recepten die deze week vooruit zijn ingekocht voor volgende week. */
  vooruitRecepten: z.array(z.string()).default([]),
  /** Geactiveerde persoonlijke bonus: prijs per verpakking voor deze week. */
  persoonlijkeBonus: z
    .array(z.object({ productId: z.number().int(), nu: z.number().optional(), omschrijving: z.string() }))
    .default([]),
  bestelling: z.array(BestelRegelSchema).default([]),
  /** Wat er werkelijk geleverd is (uit de bestelgeschiedenis), ingevuld bij de volgende planning. */
  ontvangen: z.array(z.object({ productId: z.number().int(), aantal: z.number().int().nonnegative() })).optional(),
  /** Telling aan het begin van de planning van deze week (artikel-id → hoeveelheid). */
  telling: z.record(z.string(), z.number().nonnegative()).optional(),
  totaal: z.number().optional(),
  besparing: z.number().optional(),
});
export type Week = z.infer<typeof WeekSchema>;
