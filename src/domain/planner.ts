// Weekmenu kiezen: bonus en restjes eerst, daarna variatie en rouleren.
import type { Artikel, Recept } from "../data/schema.js";
import { formatEuro } from "./eenheden.js";

export interface PlanContext {
  /** Weken sinds laatst gegeten; ontbreekt = nooit. */
  wekenGeleden: Map<string, number>;
  nietGekookt: Set<string>;
  /** € bonusbesparing als het recept deze week gekookt wordt. */
  besparing: Map<string, number>;
  /** € waarde van bederfelijke restjes die het recept opmaakt. */
  restjes: Map<string, number>;
  /** Vastgezette recepten (vooruit gekocht), altijd in het menu. */
  vastgezet: string[];
  /** Rustregel actief (vanaf 18 recepten). */
  rouleren: boolean;
}

export interface ReceptScore {
  receptId: string;
  score: number;
  redenen: string[];
}

const MAX_PER_WEEK = 2;
const HERHAAL_STRAF = 6;
const TAG_STRAF = 3;
const RUST_STRAF = 8;
const RUST_WEKEN = 3;
/** Bederfelijk zonder bekende houdbaarheid: behandel als snel op. */
const BEDERFELIJK_ONBEKEND_DAGEN = 3;
const NIET_BEDERFELIJK_DAGEN = 99;

const weken = (n: number): string => (n === 1 ? "1 week" : `${n} weken`);

export function scoreRecept(recept: Recept, ctx: PlanContext): ReceptScore {
  const id = recept.id;
  const redenen: string[] = [];
  if (recept.maaltijd !== "diner") return { receptId: id, score: -Infinity, redenen: ["geen diner"] };
  if (ctx.vastgezet.includes(id)) redenen.push("vastgezet (vooruit gekocht)");

  let score = 0;
  const besparing = ctx.besparing.get(id) ?? 0;
  if (besparing > 0) {
    score += besparing * 3;
    redenen.push(`bonus bespaart ${formatEuro(besparing)}`);
  }
  const restjes = ctx.restjes.get(id) ?? 0;
  if (restjes > 0) {
    score += restjes * 2;
    redenen.push(`maakt restjes op (${formatEuro(restjes)})`);
  }
  if (ctx.nietGekookt.has(id)) {
    score += 5;
    redenen.push("vorige keer niet gekookt");
  }
  const w = ctx.wekenGeleden.get(id);
  if (w === undefined) {
    score += 6;
    redenen.push("nog nooit gegeten");
  } else {
    score += Math.min(w, 6);
    if (w > 0) redenen.push(`${weken(w)} niet gegeten`);
    if (ctx.rouleren && w < RUST_WEKEN) {
      // Besparen gaat voor: een bonus mag de rustregel breken.
      if (besparing > 0) redenen.push("recent gegeten, maar bonus gaat voor");
      else {
        score -= RUST_STRAF;
        redenen.push(w === 0 ? "deze week al gegeten" : `pas ${weken(w)} geleden gegeten`);
      }
    }
  }
  return { receptId: id, score, redenen };
}

export function kiesMenu(recepten: Recept[], ctx: PlanContext, aantal = 6): { gekozen: string[]; scores: ReceptScore[] } {
  const diners = recepten.filter((r) => r.maaltijd === "diner");
  const scores = diners.map((r) => scoreRecept(r, ctx));
  const scoreVan = new Map(scores.map((s) => [s.receptId, s.score]));
  const perId = new Map(recepten.map((r) => [r.id, r]));

  const gekozen: string[] = [];
  const keer = new Map<string, number>();
  const tags = new Set<string>();
  const kies = (r: Recept): void => {
    gekozen.push(r.id);
    keer.set(r.id, (keer.get(r.id) ?? 0) + 1);
    for (const t of r.tags) tags.add(t);
  };

  // Vastgezet eerst (ook als het recept geen diner is: het is al gekocht).
  for (const id of ctx.vastgezet) {
    const r = perId.get(id);
    if (r && gekozen.length < aantal && (keer.get(id) ?? 0) < MAX_PER_WEEK) kies(r);
  }

  // Daarna gretig de hoogste score, met straf voor herhaling en dubbele tags.
  while (gekozen.length < aantal) {
    let beste: Recept | null = null;
    let besteScore = -Infinity;
    for (const r of diners) {
      const k = keer.get(r.id) ?? 0;
      if (k >= MAX_PER_WEEK) continue;
      const dubbeleTags = new Set(r.tags.filter((t) => tags.has(t))).size;
      const s = (scoreVan.get(r.id) ?? 0) - (k > 0 ? HERHAAL_STRAF : 0) - TAG_STRAF * dubbeleTags;
      if (beste === null || s > besteScore) {
        beste = r;
        besteScore = s;
      }
    }
    if (!beste) break;
    kies(beste);
  }

  return { gekozen, scores: [...scores].sort((a, b) => b.score - a.score) };
}

/** Volgorde van de dagen: recepten met snel bederfelijke ingrediënten eerst. */
export function dagVolgorde(gekozen: string[], recepten: Recept[], artikelen: Map<string, Artikel>): string[] {
  const perId = new Map(recepten.map((r) => [r.id, r]));
  const dagen = (id: string): number => {
    let min = NIET_BEDERFELIJK_DAGEN;
    for (const ing of perId.get(id)?.ingredienten ?? []) {
      const a = artikelen.get(ing.artikel);
      if (a?.bederfelijk) min = Math.min(min, a.houdbaarheidDagen ?? BEDERFELIJK_ONBEKEND_DAGEN);
    }
    return min;
  };
  return gekozen
    .map((id, i) => ({ id, i, d: dagen(id) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.id);
}
