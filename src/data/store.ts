// Lezen en schrijven van de databestanden. Alles is JSON met validatie via zod.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  ArtikelSchema,
  ProductSchema,
  ReceptSchema,
  VooruitSchema,
  VoorraadSchema,
  WeekSchema,
  type Artikel,
  type Product,
  type Recept,
  type Vooruit,
  type Voorraad,
  type Week,
} from "./schema.js";

// AH_ROOT maakt testen met een losse datamap mogelijk.
export const ROOT = process.env.AH_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATA = join(ROOT, "data");
export const WEKEN = join(ROOT, "weken");
export const CACHE = join(DATA, "cache");

function lees<T>(pad: string, schema: z.ZodType<T>, standaard: T): T {
  if (!existsSync(pad)) return standaard;
  const ruw = JSON.parse(readFileSync(pad, "utf8"));
  const r = schema.safeParse(ruw);
  if (!r.success) throw new Error(`Ongeldig bestand ${pad}:\n${z.prettifyError(r.error)}`);
  return r.data;
}

function schrijf(pad: string, data: unknown): void {
  mkdirSync(dirname(pad), { recursive: true });
  writeFileSync(pad, JSON.stringify(data, null, 2) + "\n", "utf8");
}

const pad = (naam: string) => join(DATA, naam);

export const laadArtikelen = (): Artikel[] => lees(pad("artikelen.json"), z.array(ArtikelSchema), []);
export const bewaarArtikelen = (a: Artikel[]) => schrijf(pad("artikelen.json"), [...a].sort((x, y) => x.id.localeCompare(y.id)));

export const laadProducten = (): Record<string, Product> => lees(pad("producten.json"), z.record(z.string(), ProductSchema), {});
export const bewaarProducten = (p: Record<string, Product>) =>
  schrijf(pad("producten.json"), Object.fromEntries(Object.entries(p).sort(([a], [b]) => Number(a) - Number(b))));

export const laadRecepten = (): Recept[] => lees(pad("recepten.json"), z.array(ReceptSchema), []);
export const bewaarRecepten = (r: Recept[]) => schrijf(pad("recepten.json"), [...r].sort((x, y) => x.naam.localeCompare(y.naam)));

export const laadVoorraad = (): Voorraad => lees(pad("voorraad.json"), VoorraadSchema, { geteld: "1970-01-01", artikelen: {} });
export const bewaarVoorraad = (v: Voorraad) => schrijf(pad("voorraad.json"), v);

export const laadVooruit = (): Vooruit => lees(pad("vooruit.json"), VooruitSchema, []);
export const bewaarVooruit = (v: Vooruit) => schrijf(pad("vooruit.json"), v);

export const weekPad = (week: string) => join(WEKEN, `${week}.json`);
export const laadWeek = (week: string): Week | null => (existsSync(weekPad(week)) ? lees(weekPad(week), WeekSchema, null as never) : null);
export const bewaarWeek = (w: Week) => schrijf(weekPad(w.week), w);

/** Alle weken, oudste eerst. */
export function alleWeken(): Week[] {
  if (!existsSync(WEKEN)) return [];
  return readdirSync(WEKEN)
    .filter((f) => /^\d{4}-W\d{2}\.json$/.test(f))
    .sort()
    .map((f) => lees(join(WEKEN, f), WeekSchema, null as never));
}

export function leesCache<T>(naam: string): T | null {
  const p = join(CACHE, naam);
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
}
export const schrijfCache = (naam: string, data: unknown) => schrijf(join(CACHE, naam), data);

// ---- Datums ----

export const vandaag = () => new Date().toISOString().slice(0, 10);

function alsUTC(datum: string): Date {
  return new Date(`${datum}T00:00:00Z`);
}

export function plusDagen(datum: string, dagen: number): string {
  const d = alsUTC(datum);
  d.setUTCDate(d.getUTCDate() + dagen);
  return d.toISOString().slice(0, 10);
}

/** Eerstvolgende maandag ná `datum` (de standaard bezorgdag). */
export function volgendeMaandag(datum = vandaag()): string {
  const dag = alsUTC(datum).getUTCDay(); // 0 = zondag
  return plusDagen(datum, ((8 - dag) % 7) || 7);
}

/** ISO-weeknummer, bijv. "2026-W45". */
export function isoWeek(datum: string): string {
  const d = alsUTC(datum);
  const dag = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dag);
  const jaarStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const nr = Math.ceil(((d.getTime() - jaarStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(nr).padStart(2, "0")}`;
}

export function dagenTussen(van: string, tot: string): number {
  return Math.round((alsUTC(tot).getTime() - alsUTC(van).getTime()) / 86400000);
}
