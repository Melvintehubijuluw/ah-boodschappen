// De weekflow: prijzen ophalen, voorraad bijhouden, menu voorstellen en een bestelling adviseren.
// Alle rekenwerk zit in src/domain; dit bestand koppelt data, AH-prijzen en rekenlogica.
import { bonusProducten, periodeVoorDatum, productPrijzen } from "./ah/index.js";
import type { Artikel, BestelRegel, Product, Recept, Week } from "./data/schema.js";
import {
  alleWeken,
  bewaarArtikelen,
  bewaarProducten,
  bewaarVoorraad,
  bewaarVooruit,
  bewaarWeek,
  dagenTussen,
  isoWeek,
  laadArtikelen,
  laadProducten,
  laadRecepten,
  laadVoorraad,
  laadVooruit,
  laadWeek,
  leesCache,
  schrijfCache,
  vandaag,
  volgendeMaandag,
} from "./data/store.js";
import { parseActie } from "./domain/actie.js";
import { bepaalAankoop, maxVoorraad, werkVerbruikBij, type Kandidaat } from "./domain/bestellen.js";
import { inhoudVanProduct } from "./domain/eenheden.js";
import { dagVolgorde, kiesMenu, type PlanContext, type ReceptScore } from "./domain/planner.js";
import { besteEenheidsprijs, isEchteBonus, regulierePrijs } from "./domain/prijs.js";
import type { BonusProduct, Periode, ProductPrijs } from "./types.js";

export const MINIMUM_BESTELLING = 50;
export const DAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"] as const;

// ---------- Week en periode ----------

/** Week voor de eerstvolgende bezorging (maandag), of een bestaande open week. */
export function huidigeWeek(leverdatum = volgendeMaandag()): Week {
  const week = isoWeek(leverdatum);
  return laadWeek(week) ?? { week, leverdatum, status: "open", menu: [], vooruitRecepten: [], persoonlijkeBonus: [], bestelling: [] };
}

/** Week die vóór de gegeven week het laatst besteld is. */
export function vorigeWeek(week: string): Week | null {
  const eerder = alleWeken().filter((w) => w.week < week && w.status !== "open");
  return eerder.at(-1) ?? null;
}

export async function periodeVan(w: Week): Promise<Periode> {
  const p = await periodeVoorDatum(w.leverdatum);
  if (!p) throw new Error(`Geen bonusperiode gevonden voor ${w.leverdatum}. De bonus van volgende week verschijnt vrijdag rond 13:00.`);
  return p;
}

// ---------- Producten en prijzen ----------

/** Werkt producten.json bij met titel/verpakking/inhoud uit AH-data (handmatige inhoud blijft staan). */
export function registreerProducten(prijzen: Iterable<ProductPrijs>): Record<string, Product> {
  const producten = laadProducten();
  for (const p of prijzen) {
    const oud = producten[String(p.productId)];
    producten[String(p.productId)] = {
      id: p.productId,
      titel: p.titel,
      merk: p.merk,
      verpakking: p.verpakking,
      inhoud: oud?.inhoudHandmatig ? oud.inhoud : (inhoudVanProduct(p.verpakking, p.netContents) ?? oud?.inhoud ?? null),
      inhoudHandmatig: oud?.inhoudHandmatig ?? false,
      bijgewerkt: vandaag(),
    };
  }
  bewaarProducten(producten);
  return producten;
}

/** Haalt de prijzen van alle bekende producten (en de bonus) op voor de periode en bewaart ze in de cache. */
export async function haalPrijzen(periode: Periode, extraIds: number[] = []): Promise<{ prijzen: number; bonus: number }> {
  const artikelen = laadArtikelen();
  const ids = new Set<number>([...artikelen.flatMap((a) => a.producten), ...extraIds]);
  const prijzen = await productPrijzen([...ids], periode);
  schrijfCache(`prijzen-${periode.start}.json`, [...prijzen.values()]);
  registreerProducten(prijzen.values());
  const bonus = await bonusProducten(periode);
  schrijfCache(`bonus-${periode.start}.json`, bonus);
  return { prijzen: prijzen.size, bonus: bonus.length };
}

export function bonusUitCache(periode: Periode): BonusProduct[] {
  return leesCache<BonusProduct[]>(`bonus-${periode.start}.json`) ?? [];
}

/** Alle bekende prijzen voor de periode: producten uit de cache, aangevuld met bonusproducten en persoonlijke bonus. */
export function prijsKaart(periode: Periode, w?: Week): Map<number, ProductPrijs> {
  const kaart = new Map<number, ProductPrijs>();
  for (const p of bonusUitCache(periode)) kaart.set(p.productId, p);
  const cache = leesCache<ProductPrijs[]>(`prijzen-${periode.start}.json`);
  if (!cache) throw new Error(`Geen prijzen in cache voor ${periode.start}. Draai eerst: npm run ah -- prijzen`);
  for (const p of cache) kaart.set(p.productId, p);
  for (const pb of w?.persoonlijkeBonus ?? []) {
    const p = kaart.get(pb.productId);
    if (p) kaart.set(pb.productId, { ...p, nu: pb.nu ?? p.nu, actieOmschrijving: pb.omschrijving, actieCode: "PERSOONLIJK" });
  }
  return kaart;
}

/** Kandidaten (standaardproduct + goedgekeurde vervangers) voor een artikel, met inhoud in de eenheid van het artikel. */
export function kandidatenVoor(a: Artikel, kaart: Map<number, ProductPrijs>, producten: Record<string, Product>, meldingen: string[]): Kandidaat[] {
  const uit: Kandidaat[] = [];
  for (const id of a.producten) {
    const prijs = kaart.get(id);
    const prod = producten[String(id)];
    if (!prijs) {
      meldingen.push(`${a.naam}: geen prijs voor product ${id} (niet leverbaar of niet opgehaald).`);
      continue;
    }
    if (!prod?.inhoud || prod.inhoud.eenheid !== a.eenheid) {
      meldingen.push(`${a.naam}: inhoud van "${prijs.titel}" (${id}) onbekend in ${a.eenheid}. Zet met: npm run ah -- product ${id} --inhoud "<hoeveelheid>"`);
      continue;
    }
    uit.push({ productId: id, titel: prijs.titel, inhoud: prod.inhoud.waarde, prijs });
  }
  return uit;
}

/** Bonusproducten die mogelijk een vervanger zijn voor een artikel (Claude beoordeelt of het hetzelfde product is). */
export function bonusKandidaten(periode: Periode): { artikel: Artikel; producten: BonusProduct[] }[] {
  const bonus = bonusUitCache(periode);
  const woorden = (t: string) => t.toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter((w) => w.length > 2);
  return laadArtikelen()
    .map((artikel) => {
      const zoek = woorden(artikel.zoekterm ?? artikel.naam);
      const bekend = new Set([...artikel.producten, ...artikel.afgewezen]);
      const producten = bonus.filter((b) => {
        if (bekend.has(b.productId)) return false;
        const titel = b.titel.toLowerCase();
        return zoek.length > 0 && zoek.every((w) => titel.includes(w));
      });
      return { artikel, producten };
    })
    .filter((x) => x.producten.length > 0);
}

// ---------- Voorraad ----------

function productNaarArtikel(artikelen: Artikel[]): Map<number, Artikel> {
  const m = new Map<number, Artikel>();
  for (const a of artikelen) for (const id of a.producten) if (!m.has(id)) m.set(id, a);
  return m;
}

/** Hoeveelheid per artikel die een week heeft opgeleverd (werkelijk ontvangen, anders de bestelling). */
function ontvangenPerArtikel(w: Week, artikelen: Artikel[], producten: Record<string, Product>): Map<string, number> {
  const naarArtikel = productNaarArtikel(artikelen);
  const regels = w.ontvangen ?? w.bestelling.map((r) => ({ productId: r.productId, aantal: r.aantal }));
  const uit = new Map<string, number>();
  for (const r of regels) {
    const a = naarArtikel.get(r.productId);
    const inhoud = producten[String(r.productId)]?.inhoud;
    if (!a || !inhoud || inhoud.eenheid !== a.eenheid) continue;
    uit.set(a.id, (uit.get(a.id) ?? 0) + r.aantal * inhoud.waarde);
  }
  return uit;
}

/** Wat de recepten van een week (alleen gekookt, dubbel telt 2×) aan artikelen verbruiken. */
export function receptVerbruik(menu: Week["menu"], recepten: Recept[], alleenGekookt = true): Map<string, number> {
  const perId = new Map(recepten.map((r) => [r.id, r]));
  const uit = new Map<string, number>();
  for (const m of menu) {
    if (alleenGekookt && m.gekookt === false) continue;
    const r = perId.get(m.recept);
    if (!r) continue;
    const factor = m.dubbel ? 2 : 1;
    for (const ing of r.ingredienten) uit.set(ing.artikel, (uit.get(ing.artikel) ?? 0) + ing.hoeveelheid * factor);
  }
  return uit;
}

export interface VerwachtRegel {
  artikel: Artikel;
  geteld: number;
  ontvangen: number;
  recepten: number;
  standaard: number;
  verwacht: number;
}

/** Verwachte voorraad nu: laatste telling + vorige levering − recepten − standaardverbruik. */
export function verwachteVoorraad(w: Week): VerwachtRegel[] {
  const artikelen = laadArtikelen();
  const producten = laadProducten();
  const recepten = laadRecepten();
  const voorraad = laadVoorraad();
  const vorige = vorigeWeek(w.week);
  // Alleen de vorige levering meetellen als die ná de laatste telling kwam.
  const telt = vorige && vorige.leverdatum >= voorraad.geteld;
  const ontvangen = telt ? ontvangenPerArtikel(vorige, artikelen, producten) : new Map<string, number>();
  const verbruikt = telt ? receptVerbruik(vorige.menu, recepten) : new Map<string, number>();
  const weken = voorraad.geteld === "1970-01-01" ? 0 : Math.max(0, dagenTussen(voorraad.geteld, vandaag())) / 7;

  return artikelen.map((a) => {
    const geteld = voorraad.artikelen[a.id] ?? 0;
    const o = ontvangen.get(a.id) ?? 0;
    const rv = verbruikt.get(a.id) ?? 0;
    const sv = a.standaard ? (a.verbruikPerWeek ?? 0) * weken : 0;
    return { artikel: a, geteld, ontvangen: o, recepten: rv, standaard: sv, verwacht: Math.max(0, geteld + o - rv - sv) };
  });
}

/**
 * Verwerkt de telling: niet genoemde artikelen krijgen de verwachte waarde.
 * Voor standaardartikelen wordt het gemeten weekverbruik bijgewerkt.
 */
export function verwerkTelling(w: Week, correcties: Record<string, number>): { verbruik: { artikel: string; gemeten: number; gemiddelde: number }[] } {
  const verwacht = verwachteVoorraad(w);
  const voorraad = laadVoorraad();
  const artikelen = laadArtikelen();
  const perId = new Map(artikelen.map((a) => [a.id, a]));
  for (const id of Object.keys(correcties)) if (!perId.has(id)) throw new Error(`Onbekend artikel "${id}"`);

  const nieuw: Record<string, number> = {};
  for (const r of verwacht) nieuw[r.artikel.id] = correcties[r.artikel.id] ?? Math.round(r.verwacht);

  const verbruik: { artikel: string; gemeten: number; gemiddelde: number }[] = [];
  const eerdereTelling = voorraad.geteld !== "1970-01-01";
  const dagen = eerdereTelling ? dagenTussen(voorraad.geteld, vandaag()) : 0;
  if (eerdereTelling && dagen >= 3) {
    for (const r of verwacht) {
      const a = r.artikel;
      if (!a.standaard) continue;
      const gemeten = Math.max(0, ((r.geteld + r.ontvangen - r.recepten - (nieuw[a.id] ?? 0)) * 7) / dagen);
      // De eerste schatting van de gebruiker telt mee als eerste meting.
      const basis = a.verbruikHistorie.length === 0 && a.verbruikPerWeek !== undefined ? [a.verbruikPerWeek] : a.verbruikHistorie;
      const { historie, gemiddelde } = werkVerbruikBij(basis, gemeten);
      a.verbruikHistorie = historie;
      a.verbruikPerWeek = gemiddelde;
      verbruik.push({ artikel: a.id, gemeten, gemiddelde });
    }
    bewaarArtikelen(artikelen);
  }
  bewaarVoorraad({ geteld: vandaag(), artikelen: nieuw });
  bewaarWeek({ ...w, telling: nieuw });
  return { verbruik };
}

// ---------- Menu ----------

function wekenGeleden(week: string): Map<string, number> {
  const uit = new Map<string, number>();
  const [jaar, nr] = week.split("-W").map(Number) as [number, number];
  for (const w of alleWeken()) {
    if (w.week >= week) continue;
    const [j, n] = w.week.split("-W").map(Number) as [number, number];
    const verschil = (jaar - j) * 52 + (nr - n);
    for (const m of w.menu) if (m.gekookt !== false) uit.set(m.recept, Math.min(uit.get(m.recept) ?? Infinity, verschil));
  }
  return uit;
}

/** Bonusbesparing (€) per recept als het deze week gekookt wordt. */
export function receptBesparing(recept: Recept, kaart: Map<number, ProductPrijs>, artikelen: Map<string, Artikel>, producten: Record<string, Product>): number {
  let totaal = 0;
  for (const ing of recept.ingredienten) {
    const a = artikelen.get(ing.artikel);
    if (!a || a.voorraadkast) continue;
    const k = kandidatenVoor(a, kaart, producten, []);
    if (!k.length) continue;
    const ref = Math.min(...k.map((x) => regulierePrijs(x.prijs) / x.inhoud));
    const bonus = k
      .map((x) => ({ x, actie: parseActie(x.prijs.actieOmschrijving, x.prijs.actieCode) }))
      .filter(({ x, actie }) => isEchteBonus(x.prijs, actie))
      .map(({ x, actie }) => besteEenheidsprijs(x.prijs, actie, x.inhoud));
    if (!bonus.length) continue;
    totaal += Math.max(0, ref - Math.min(...bonus)) * ing.hoeveelheid;
  }
  return Math.round(totaal * 100) / 100;
}

export interface MenuVoorstel {
  menu: { dag: string; recept: Recept; score?: ReceptScore }[];
  scores: ReceptScore[];
  rouleren: boolean;
}

export function menuVoorstel(w: Week, periode: Periode): MenuVoorstel {
  const recepten = laadRecepten().filter((r) => r.maaltijd === "diner");
  const artikelen = new Map(laadArtikelen().map((a) => [a.id, a]));
  const producten = laadProducten();
  const kaart = prijsKaart(periode, w);
  const voorraad = laadVoorraad();
  const vorige = vorigeWeek(w.week);

  const besparing = new Map<string, number>();
  const restjes = new Map<string, number>();
  for (const r of recepten) {
    besparing.set(r.id, receptBesparing(r, kaart, artikelen, producten));
    let waarde = 0;
    for (const ing of r.ingredienten) {
      const a = artikelen.get(ing.artikel);
      const op = voorraad.artikelen[ing.artikel] ?? 0;
      if (!a?.bederfelijk || op <= 0) continue;
      const k = kandidatenVoor(a, kaart, producten, []);
      const ref = k.length ? Math.min(...k.map((x) => regulierePrijs(x.prijs) / x.inhoud)) : 0;
      waarde += Math.min(op, ing.hoeveelheid) * ref;
    }
    restjes.set(r.id, Math.round(waarde * 100) / 100);
  }

  const vastgezet = laadVooruit()
    .filter((v) => v.voorWeek === w.week)
    .map((v) => v.recept);
  const ctx: PlanContext = {
    wekenGeleden: wekenGeleden(w.week),
    nietGekookt: new Set(vorige?.menu.filter((m) => m.gekookt === false).map((m) => m.recept) ?? []),
    besparing,
    restjes,
    vastgezet: [...new Set(vastgezet)],
    rouleren: recepten.length >= 18,
  };
  const { gekozen, scores } = kiesMenu(recepten, ctx, DAGEN.length);
  const volgorde = dagVolgorde(gekozen, recepten, artikelen);
  const perId = new Map(recepten.map((r) => [r.id, r]));
  return {
    menu: volgorde.map((id, i) => ({ dag: DAGEN[i]!, recept: perId.get(id)!, score: scores.find((s) => s.receptId === id) })),
    scores,
    rouleren: ctx.rouleren,
  };
}

// ---------- Bestellen ----------

export interface Advies {
  regels: BestelRegel[];
  totaal: number;
  besparing: number;
  meldingen: string[];
  onderMinimum: number;
  aanvulSuggesties: { artikel: Artikel; productId: number; titel: string; bonus: boolean }[];
}

export function maakAdvies(w: Week, periode: Periode, extra: { productId: number; aantal: number }[] = []): Advies {
  const artikelen = laadArtikelen();
  const perId = new Map(artikelen.map((a) => [a.id, a]));
  const producten = laadProducten();
  const recepten = laadRecepten();
  const kaart = prijsKaart(periode, w);
  const meldingen: string[] = [];
  const voorraad = w.telling ?? laadVoorraad().artikelen;

  // Gereserveerd voor latere weken (vooruit gekocht) telt niet mee als beschikbaar.
  const gereserveerd = new Map<string, number>();
  for (const v of laadVooruit()) if (v.voorWeek > w.week) gereserveerd.set(v.artikel, (gereserveerd.get(v.artikel) ?? 0) + v.hoeveelheid);

  const receptNodig = receptVerbruik(w.menu, recepten, false);
  const vooruitNodig = receptVerbruik(
    w.vooruitRecepten.map((r) => ({ dag: "maandag" as const, recept: r, dubbel: false, vastgezet: true })),
    recepten,
    false,
  );

  const regels: BestelRegel[] = [];
  for (const a of artikelen) {
    const beschikbaar = Math.max(0, (voorraad[a.id] ?? 0) - (gereserveerd.get(a.id) ?? 0));
    const recept = receptNodig.get(a.id) ?? 0;
    let nodig = recept + (a.standaard ? (a.verbruikPerWeek ?? 0) : 0);
    if (a.voorraadkast) {
      const ondergrens = Math.max(recept, a.minVoorraad ?? 0);
      if (beschikbaar >= ondergrens && beschikbaar > 0) nodig = 0;
      else nodig = Math.max(ondergrens, recept, 1e-6);
    }
    const max = maxVoorraad(a);
    const ruimte = max === null ? 0 : Math.max(0, max - Math.max(nodig, beschikbaar));
    if (nodig <= beschikbaar && ruimte <= 0) continue;

    const kandidaten = kandidatenVoor(a, kaart, producten, meldingen);
    if (!kandidaten.length) {
      if (nodig > beschikbaar) meldingen.push(`${a.naam}: nodig maar geen bruikbaar product. Controleer het artikel.`);
      continue;
    }
    const { aankoop, meldingen: m } = bepaalAankoop({ artikelId: a.id, nodig, voorraad: beschikbaar, ruimte, eenheid: a.eenheid }, kandidaten);
    meldingen.push(...m.map((x) => `${a.naam}: ${x}`));
    if (!aankoop) continue;
    regels.push({
      productId: aankoop.productId,
      titel: aankoop.titel,
      artikel: a.id,
      aantal: aankoop.aantal,
      kosten: aankoop.kosten,
      reden: aankoop.reden,
      toelichting: aankoop.toelichting,
      besparing: aankoop.besparing,
    });
  }

  // Vooruit: alleen ingrediënten die nu in de bonus zijn worden al gekocht.
  for (const [artikelId, hoeveelheid] of vooruitNodig) {
    const a = perId.get(artikelId);
    if (!a) continue;
    const kandidaten = kandidatenVoor(a, kaart, producten, meldingen).filter((k) =>
      isEchteBonus(k.prijs, parseActie(k.prijs.actieOmschrijving, k.prijs.actieCode)),
    );
    if (!kandidaten.length) continue;
    if (!a.houdbaarheidDagen || a.houdbaarheidDagen < 10) {
      meldingen.push(`Vooruit ${a.naam}: houdbaarheid ${a.houdbaarheidDagen ?? "onbekend"} dagen; controleer of het tot volgende week goed blijft.`);
    }
    const { aankoop } = bepaalAankoop({ artikelId, nodig: hoeveelheid, voorraad: 0, ruimte: 0, eenheid: a.eenheid }, kandidaten);
    if (aankoop) {
      regels.push({
        productId: aankoop.productId,
        titel: aankoop.titel,
        artikel: artikelId,
        aantal: aankoop.aantal,
        kosten: aankoop.kosten,
        reden: "vooruit",
        toelichting: `voor volgende week: ${aankoop.toelichting}`,
        besparing: aankoop.besparing,
      });
    }
  }

  for (const e of extra) {
    const p = kaart.get(e.productId);
    if (!p) {
      meldingen.push(`Extra product ${e.productId}: geen prijs bekend.`);
      continue;
    }
    const actie = parseActie(p.actieOmschrijving, p.actieCode);
    const stuk = p.nu !== null && p.nu < p.prijs ? p.nu : p.prijs;
    regels.push({
      productId: e.productId,
      titel: p.titel,
      artikel: productNaarArtikel(artikelen).get(e.productId)?.id ?? null,
      aantal: e.aantal,
      kosten: Math.round(stuk * e.aantal * 100) / 100,
      reden: "aanvulling",
      toelichting: actie.soort === "geen" ? "aanvulling tot minimumbedrag" : `aanvulling, actie: ${p.actieOmschrijving}`,
      besparing: 0,
    });
  }

  const totaal = Math.round(regels.reduce((s, r) => s + r.kosten, 0) * 100) / 100;
  const besparing = Math.round(regels.reduce((s, r) => s + r.besparing, 0) * 100) / 100;
  const onderMinimum = Math.max(0, Math.round((MINIMUM_BESTELLING - totaal) * 100) / 100);

  const aanvulSuggesties: Advies["aanvulSuggesties"] = [];
  if (onderMinimum > 0) {
    for (const a of artikelen) {
      if (!a.houdbaarheidDagen || a.houdbaarheidDagen < 28 || !(a.standaard || a.voorraadkast)) continue;
      for (const k of kandidatenVoor(a, kaart, producten, [])) {
        const bonus = isEchteBonus(k.prijs, parseActie(k.prijs.actieOmschrijving, k.prijs.actieCode));
        aanvulSuggesties.push({ artikel: a, productId: k.productId, titel: k.titel, bonus });
      }
    }
    aanvulSuggesties.sort((x, y) => Number(y.bonus) - Number(x.bonus));
    meldingen.push(`Bestelling is ${totaal.toFixed(2)} euro: ${onderMinimum.toFixed(2)} euro onder het minimum van ${MINIMUM_BESTELLING} euro.`);
  }

  return { regels, totaal, besparing, meldingen, onderMinimum, aanvulSuggesties };
}

/** Markeert de week als besteld en legt vooruit gekochte producten vast. */
export function rondWeekAf(w: Week): Week {
  const volgende = isoWeek(new Date(Date.parse(`${w.leverdatum}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10));
  const vooruit = laadVooruit().filter((v) => v.besteldInWeek !== w.week);
  const producten = laadProducten();
  for (const r of w.bestelling.filter((r) => r.reden === "vooruit")) {
    const inhoud = producten[String(r.productId)]?.inhoud;
    if (!r.artikel || !inhoud) continue;
    const recept = w.vooruitRecepten.find((id) => laadRecepten().find((x) => x.id === id)?.ingredienten.some((i) => i.artikel === r.artikel));
    vooruit.push({
      artikel: r.artikel,
      productId: r.productId,
      hoeveelheid: r.aantal * inhoud.waarde,
      recept: recept ?? w.vooruitRecepten[0] ?? "onbekend",
      besteldInWeek: w.week,
      voorWeek: volgende,
    });
  }
  // Reserveringen voor weken die voorbij zijn, vervallen.
  bewaarVooruit(vooruit.filter((v) => v.voorWeek >= w.week));
  const klaar: Week = { ...w, status: "besteld" };
  bewaarWeek(klaar);
  return klaar;
}
