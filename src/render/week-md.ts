// Weeksamenvatting (weken/<week>.md): menu, bestelling, inslaan, vooruit en besparing.
import type { Recept, Week } from "../data/schema.js";
import { formatEuro } from "../domain/eenheden.js";

export function renderWeekMd(w: Week, recepten: Recept[], meldingen: string[] = []): string {
  const naam = new Map(recepten.map((r) => [r.id, r]));
  const r: string[] = [];
  const totaal = w.bestelling.reduce((s, x) => s + x.kosten, 0);
  const besparing = w.bestelling.reduce((s, x) => s + x.besparing, 0);
  const inslaan = w.bestelling.filter((x) => x.reden === "inslaan");
  const inslaanKosten = inslaan.reduce((s, x) => s + x.kosten, 0);

  r.push(`# Week ${w.week}`, "", `**Bezorging:** ${w.leverdatum} · **Status:** ${w.status}`, "");
  r.push(`**Totaal (schatting):** ${formatEuro(totaal)} · **Bespaard met bonus:** ${formatEuro(besparing)}`, "");
  if (inslaanKosten > 50) r.push(`> ⚠️ Deze week ${formatEuro(inslaanKosten)} extra aan inslaan.`, "");
  if (w.persoonlijkeBonus.length) {
    r.push(`**Persoonlijke bonus:** ${w.persoonlijkeBonus.map((p) => `${p.omschrijving} (${p.productId})`).join(", ")}`, "");
  }

  r.push("## Menu", "");
  for (const m of w.menu) {
    const rec = naam.get(m.recept);
    const link = rec?.ahLijst ? ` ([lijstje](${rec.ahLijst}))` : "";
    r.push(`- **${m.dag}**: ${rec?.naam ?? m.recept}${m.dubbel ? " (dubbel)" : ""}${m.vastgezet ? " 🔒" : ""}${link}`);
  }
  r.push("- **zondag**: vrij / restjes", "");
  if (w.vooruitRecepten.length) r.push(`**Vooruit gekocht voor volgende week:** ${w.vooruitRecepten.map((id) => naam.get(id)?.naam ?? id).join(", ")}`, "");

  const sectie = (titel: string, reden: Week["bestelling"][number]["reden"]) => {
    const regels = w.bestelling.filter((x) => x.reden === reden);
    if (!regels.length) return;
    r.push(`## ${titel}`, "", "| Product | Aantal | Kosten | Bespaard | Toelichting |", "|---|---:|---:|---:|---|");
    for (const x of regels) r.push(`| ${x.titel} | ${x.aantal} | ${formatEuro(x.kosten)} | ${x.besparing ? formatEuro(x.besparing) : ""} | ${x.toelichting ?? ""} |`);
    r.push("");
  };
  sectie("Nodig deze week", "nodig");
  sectie("Inslaan (bonus)", "inslaan");
  sectie("Vooruit voor volgende week", "vooruit");
  sectie("Aanvulling tot minimumbedrag", "aanvulling");

  if (meldingen.length) {
    r.push("## Meldingen", "");
    for (const m of meldingen) r.push(`- ${m}`);
    r.push("");
  }
  return r.join("\n");
}
