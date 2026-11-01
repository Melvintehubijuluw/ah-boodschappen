// Lage-niveau client voor de (onofficiële) AH mobiele API: token, retries, REST en GraphQL.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const BASIS = "https://api.ah.nl";
const TOKEN_BESTAND = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".cache", "ah-token.json");
const MAX_POGINGEN = 3;

const BASIS_HEADERS = {
  "User-Agent": "Appie/9.28 (iPhone17,3; iPhone; CPU OS 26_1 like Mac OS X)",
  "x-client-name": "appie-ios",
  "x-client-version": "9.28",
  "x-application": "AHWEBSHOP",
  Accept: "application/json",
  "Content-Type": "application/json",
};

export class AhFout extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly endpoint: string,
  ) {
    super(message);
    this.name = "AhFout";
  }
}

const TokenSchema = z.object({ access_token: z.string(), expires_in: z.number() });
const CacheSchema = z.object({ token: z.string(), verlooptOp: z.number() });

let tokenInGeheugen: z.infer<typeof CacheSchema> | null = null;

async function leesCache(): Promise<z.infer<typeof CacheSchema> | null> {
  try {
    return CacheSchema.parse(JSON.parse(await readFile(TOKEN_BESTAND, "utf8")));
  } catch {
    return null;
  }
}

async function nieuwToken(): Promise<string> {
  const endpoint = "/mobile-auth/v1/auth/token/anonymous";
  const res = await metRetry(endpoint, () =>
    fetch(BASIS + endpoint, { method: "POST", headers: BASIS_HEADERS, body: JSON.stringify({ clientId: "appie-ios" }) }),
  );
  const data = parse(TokenSchema, await res.json().catch(() => null), endpoint);
  // Minuut marge zodat een token niet halverwege een reeks verzoeken verloopt.
  tokenInGeheugen = { token: data.access_token, verlooptOp: Date.now() + (data.expires_in - 60) * 1000 };
  await mkdir(dirname(TOKEN_BESTAND), { recursive: true });
  await writeFile(TOKEN_BESTAND, JSON.stringify(tokenInGeheugen), "utf8");
  return tokenInGeheugen.token;
}

let tokenBelofte: Promise<string> | null = null;

/** Geldig anoniem token uit geheugen, cachebestand of een nieuw verzoek (gelijktijdige aanroepen delen één verzoek). */
async function token(vernieuw = false): Promise<string> {
  if (!vernieuw) {
    tokenInGeheugen ??= await leesCache();
    if (tokenInGeheugen && tokenInGeheugen.verlooptOp > Date.now()) return tokenInGeheugen.token;
  }
  tokenBelofte ??= nieuwToken().finally(() => (tokenBelofte = null));
  return tokenBelofte;
}

const wacht = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isTijdelijk = (status: number) => status === 429 || status >= 500;

/** Voert een verzoek uit met exponentiële backoff bij 429, 5xx en netwerkfouten. */
async function metRetry(endpoint: string, doe: () => Promise<Response>): Promise<Response> {
  for (let poging = 1; ; poging++) {
    let res: Response;
    try {
      res = await doe();
    } catch (e) {
      if (poging >= MAX_POGINGEN)
        throw new AhFout(`AH API onbereikbaar (${endpoint}): ${(e as Error).message}`, null, endpoint);
      await wacht(500 * 2 ** (poging - 1));
      continue;
    }
    if (res.ok || !isTijdelijk(res.status) || poging >= MAX_POGINGEN) {
      if (!res.ok && res.status !== 401) {
        const tekst = (await res.text().catch(() => "")).slice(0, 200);
        throw new AhFout(`AH API gaf HTTP ${res.status} voor ${endpoint}${tekst ? `: ${tekst}` : ""}`, res.status, endpoint);
      }
      return res;
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    await wacht(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (poging - 1));
  }
}

/** Geauthenticeerd verzoek; bij 401 eenmalig een nieuw token proberen. */
async function verzoek(pad: string, init: RequestInit = {}): Promise<unknown> {
  const endpoint = pad.split("?")[0] ?? pad;
  for (let vernieuw = false; ; vernieuw = true) {
    const bearer = await token(vernieuw);
    const res = await metRetry(endpoint, () =>
      fetch(BASIS + pad, { ...init, headers: { ...BASIS_HEADERS, Authorization: `Bearer ${bearer}` } }),
    );
    if (res.status === 401) {
      if (vernieuw) throw new AhFout(`AH API weigert het token (HTTP 401) voor ${endpoint}`, 401, endpoint);
      continue;
    }
    try {
      return await res.json();
    } catch {
      throw new AhFout(`AH API gaf geen geldige JSON voor ${endpoint}`, res.status, endpoint);
    }
  }
}

export async function ahGet<T>(pad: string, schema: z.ZodType<T>): Promise<T> {
  return parse(schema, await verzoek(pad), pad.split("?")[0] ?? pad);
}

export interface GraphqlAntwoord {
  data: Record<string, unknown> | null;
  /** Aliassen (eerste padelement) waarvoor de API een fout gaf. */
  foutAliassen: string[];
  fouten: string[];
}

const GraphqlSchema = z.object({
  data: z.record(z.string(), z.unknown()).nullish(),
  errors: z.array(z.object({ message: z.string(), path: z.array(z.union([z.string(), z.number()])).nullish() })).nullish(),
});

export async function ahGraphql(query: string, variables: Record<string, unknown>): Promise<GraphqlAntwoord> {
  const ruw = await verzoek("/graphql", { method: "POST", body: JSON.stringify({ query, variables }) });
  const { data, errors } = parse(GraphqlSchema, ruw, "/graphql");
  return {
    data: data ?? null,
    foutAliassen: (errors ?? []).flatMap((e) => (typeof e.path?.[0] === "string" ? [e.path[0]] : [])),
    fouten: (errors ?? []).map((e) => e.message),
  };
}

export function parse<T>(schema: z.ZodType<T>, waarde: unknown, endpoint: string): T {
  const r = schema.safeParse(waarde);
  if (!r.success) throw new AhFout(`Onverwacht antwoord van AH (${endpoint}): ${z.prettifyError(r.error)}`, null, endpoint);
  return r.data;
}

/** Voert `fn` uit over alle items met maximaal `max` tegelijk; volgorde van resultaten blijft gelijk. */
export async function parallel<T, R>(items: readonly T[], max: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const uit: R[] = new Array(items.length);
  let volgende = 0;
  const werker = async () => {
    while (volgende < items.length) {
      const i = volgende++;
      uit[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(max, items.length) }, werker));
  return uit;
}

export const GELIJKTIJDIG = 3;
