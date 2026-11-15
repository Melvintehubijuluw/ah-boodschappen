// Maakt recepten.md: het leesbare overzicht van alle recepten. Bron is data/recepten.json; dit bestand niet met de hand bewerken.
import type { Artikel, Product, Recept, Week } from "../data/schema.js";

const DOEL_RECEPTEN = 18;

function hoeveelheidTekst(waarde: number, eenheid: Artikel["eenheid"]): string {
  const n = (x: number) => String(Math.round(x * 10) / 10).replace(".", ",");
  if (eenheid === "g") return waarde >= 1000 ? `${n(waarde / 1000)} kg` : `${n(waarde)} g`;
  if (eenheid === "ml") return waarde >= 1000 ? `${n(waarde / 1000)} L` : `${n(waarde)} ml`;
  return waarde === 1 ? "1 stuk" : `${n(waarde)} stuks`;
}

function laatstGegeten(receptId: string, weken: Week[]): string | null {
  for (const w of [...weken].reverse()) {
    if (w.status === "open") continue;
    if (w.menu.some((m) => m.recept === receptId && m.gekookt !== false)) return w.week;
  }
  return null;
}

export function renderReceptenMd(
  recepten: Recept[],
  artikelen: Map<string, Artikel>,
  producten: Record<string, Product>,
  weken: Week[],
): string {
  const r: string[] = [];
  r.push("# Recepten", "");
  r.push("> Automatisch gemaakt uit `data/recepten.json`. Niet met de hand bewerken: gebruik `/recept` of vraag het Claude.", "");
  const n = recepten.length;
  r.push(
    n >= DOEL_RECEPTEN
      ? `**${n} recepten**: het weekmenu rouleert (een recept rust 2 weken, tenzij de bonus het goedkoper maakt).`
      : `**${n} van ${DOEL_RECEPTEN} recepten**: tot ${DOEL_RECEPTEN} mogen recepten vaker terugkomen.`,
    "",
  );

  if (n === 0) {
    r.push("_Nog geen recepten. Voeg er een toe met `/recept`._", "");
    return r.join("\n");
  }

  r.push("| Recept | Tags | Laatst gegeten | AH-lijstje |", "|---|---|---|---|");
  for (const rec of recepten) {
    const lijst = rec.ahLijst ? `[lijstje](${rec.ahLijst})` : "_nog niet gemaakt_";
    const anker = rec.id;
    r.push(`| [${rec.naam}](#${anker}) | ${rec.tags.join(", ")} | ${laatstGegeten(rec.id, weken) ?? "nog niet"} | ${lijst} |`);
  }
  r.push("");

  for (const rec of recepten) {
    r.push(`<a id="${rec.id}"></a>`, `## ${rec.naam}`, "");
    const meta = [
      `**Maaltijd:** ${rec.maaltijd}`,
      `**Porties:** ${rec.porties}`,
      rec.tags.length ? `**Tags:** ${rec.tags.join(", ")}` : null,
      `**Bron:** ${rec.bron === "eigen" ? "eigen recept" : `[${new URL(rec.bron).hostname}](${rec.bron})`}`,
      rec.ahLijst ? `**AH-lijstje:** ${rec.ahLijst}` : null,
    ].filter(Boolean);
    r.push(meta.join("  \n"), "");
    if (rec.notitie) r.push(`> ${rec.notitie}`, "");
    r.push("**Ingrediënten**", "");
    for (const ing of rec.ingredienten) {
      const art = artikelen.get(ing.artikel);
      const naam = art?.naam ?? `⚠️ onbekend artikel "${ing.artikel}"`;
      const hv = art ? hoeveelheidTekst(ing.hoeveelheid, art.eenheid) : String(ing.hoeveelheid);
      const prod = art ? producten[String(art.producten[0])] : undefined;
      const extra = [ing.omschrijving, art?.voorraadkast ? "voorraadkast" : null, prod ? `AH: ${prod.titel}` : null].filter(Boolean).join(" · ");
      r.push(`- ${hv} ${naam}${extra ? ` — ${extra}` : ""}`);
    }
    r.push("");
    if (rec.bereiding?.length) {
      r.push("**Bereiding**", "");
      rec.bereiding.forEach((stap, i) => r.push(`${i + 1}. ${stap}`));
      r.push("");
    }
  }
  return r.join("\n");
}
