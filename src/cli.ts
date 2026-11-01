// Opdrachtregel voor de weekflow. Gebruik: npm run ah -- <opdracht> [opties]
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { productPrijzen, zoekProducten } from "./ah/index.js";
import type { Artikel, Week } from "./data/schema.js";
import {
  ROOT,
  WEKEN,
  alleWeken,
  bewaarProducten,
  bewaarVoorraad,
  bewaarWeek,
  laadArtikelen,
  laadProducten,
  laadRecepten,
  laadVoorraad,
  volgendeMaandag,
} from "./data/store.js";
import { formatEenheidsprijs, formatEuro, formatHoeveelheid, inhoudVanProduct, parseHoeveelheid } from "./domain/eenheden.js";
import { regulierePrijs } from "./domain/prijs.js";
import { renderReceptenMd } from "./render/recepten-md.js";
import { renderWeekMd } from "./render/week-md.js";
import { STANDAARD_LIJST, vergelijkStandaardlijst } from "./standaardlijst.js";
import { scriptAlleLijsten, scriptLeesLijst, scriptLeesMand, scriptMaakLijst, scriptVulMand } from "./web/scripts.js";
import {
  bonusKandidaten,
  bonusUitCache,
  haalPrijzen,
  huidigeWeek,
  maakAdvies,
  menuVoorstel,
  periodeVan,
  registreerProducten,
  rondWeekAf,
  verwachteVoorraad,
  verwerkTelling,
  vorigeWeek,
} from "./week.js";

const program = new Command().name("ah").description("AH-boodschappenbesteller");
const leverOptie = ["--levering <datum>", "bezorgdatum (YYYY-MM-DD), standaard volgende maandag"] as const;
const week = (o: { levering?: string }) => huidigeWeek(o.levering ?? volgendeMaandag());
const json = (x: unknown) => console.log(JSON.stringify(x, null, 2));

/** "artikel=waarde" paren; waarde mag een eenheid hebben ("1,5 l", "300 g"). */
function paren(lijst: string[], artikelen: Map<string, Artikel>): Record<string, number> {
  const uit: Record<string, number> = {};
  for (const p of lijst) {
    const [id, waarde] = p.split("=");
    if (!id || waarde === undefined) throw new Error(`Verwacht artikel=hoeveelheid, kreeg "${p}"`);
    const a = artikelen.get(id);
    if (!a) throw new Error(`Onbekend artikel "${id}"`);
    const getal = Number(waarde.replace(",", "."));
    if (!Number.isNaN(getal)) uit[id] = getal;
    else {
      const h = parseHoeveelheid(waarde);
      if (!h || h.eenheid !== a.eenheid) throw new Error(`Kan "${waarde}" niet lezen als ${a.eenheid} voor ${id}`);
      uit[id] = h.waarde;
    }
  }
  return uit;
}

program
  .command("status")
  .description("Overzicht: aantal recepten, artikelen en de stand van deze week")
  .option(...leverOptie)
  .action((o) => {
    const w = week(o);
    const vorige = vorigeWeek(w.week);
    json({
      recepten: laadRecepten().length,
      artikelen: laadArtikelen().length,
      voorraadGeteld: laadVoorraad().geteld,
      week: { week: w.week, leverdatum: w.leverdatum, status: w.status, menu: w.menu.length, bestelregels: w.bestelling.length },
      vorigeWeek: vorige ? { week: vorige.week, status: vorige.status, ontvangenIngevuld: !!vorige.ontvangen, gekooktIngevuld: vorige.menu.every((m) => m.gekookt !== undefined) } : null,
    });
  });

program
  .command("prijzen")
  .description("Haal prijzen en bonus op voor de bonusweek van de bezorgdatum")
  .option(...leverOptie)
  .action(async (o) => {
    const w = week(o);
    const periode = await periodeVan(w);
    const r = await haalPrijzen(periode, w.persoonlijkeBonus.map((p) => p.productId));
    bewaarWeek(w);
    console.log(`Bonusweek ${periode.start} t/m ${periode.eind}: ${r.prijzen} productprijzen, ${r.bonus} bonusproducten.`);
  });

program
  .command("zoek <term...>")
  .description("Zoek AH-producten met prijs per eenheid")
  .option("-n, --aantal <n>", "aantal resultaten", "10")
  .action(async (term: string[], o) => {
    for (const p of await zoekProducten(term.join(" "), Number(o.aantal))) {
      const inhoud = inhoudVanProduct(p.verpakking, null);
      const prijs = p.nu ?? p.prijs;
      const per = inhoud ? formatEenheidsprijs(prijs / inhoud.waarde, inhoud.eenheid) : (p.eenheidsprijsTekst ?? "");
      console.log(`${p.productId}\t${formatEuro(prijs)}\t${per}\t${p.verpakking}\t${p.titel}${p.actieOmschrijving ? `\t[${p.actieOmschrijving}]` : ""}`);
    }
  });

program
  .command("product <ids...>")
  .description("Voeg producten toe aan producten.json of werk ze bij; --inhoud zet de inhoud per verpakking handmatig")
  .option("--inhoud <hoeveelheid>", 'bijv. "1 l", "3000 ml", "40 stuks"')
  .option(...leverOptie)
  .action(async (ids: string[], o) => {
    const periode = await periodeVan(week(o));
    const prijzen = await productPrijzen(ids.map(Number), periode);
    const producten = registreerProducten(prijzen.values());
    for (const id of ids) {
      const p = producten[id];
      if (!p) {
        console.log(`${id}: niet gevonden`);
        continue;
      }
      if (o.inhoud) {
        const h = parseHoeveelheid(o.inhoud);
        if (!h) throw new Error(`Kan inhoud "${o.inhoud}" niet lezen`);
        p.inhoud = h;
        p.inhoudHandmatig = true;
      }
      const pr = prijzen.get(Number(id));
      const per = p.inhoud && pr ? formatEenheidsprijs(regulierePrijs(pr) / p.inhoud.waarde, p.inhoud.eenheid) : "inhoud onbekend";
      console.log(`${id}\t${p.titel}\t${p.verpakking}\t${p.inhoud ? formatHoeveelheid(p.inhoud.waarde, p.inhoud.eenheid) : "?"}\t${pr ? formatEuro(regulierePrijs(pr)) : "?"}\t${per}${pr?.actieOmschrijving ? `\t[${pr.actieOmschrijving}]` : ""}`);
    }
    bewaarProducten(producten);
  });

program
  .command("kandidaten")
  .description("Bonusproducten die mogelijk een vervanger zijn (beoordeel: zelfde product, ander merk?)")
  .option(...leverOptie)
  .action(async (o) => {
    const periode = await periodeVan(week(o));
    for (const { artikel, producten } of bonusKandidaten(periode)) {
      console.log(`\n${artikel.id} (${artikel.naam}):`);
      for (const p of producten) console.log(`  ${p.productId}\t${formatEuro(p.nu ?? p.prijs)}\t${p.verpakking}\t${p.titel}\t[${p.actieOmschrijving ?? ""}]`);
    }
  });

program
  .command("bonus <term...>")
  .description("Zoek in de bonus van de bezorgweek")
  .option(...leverOptie)
  .action(async (term: string[], o) => {
    const periode = await periodeVan(week(o));
    const woorden = term.map((t) => t.toLowerCase());
    for (const p of bonusUitCache(periode).filter((b) => woorden.every((w) => b.titel.toLowerCase().includes(w)))) {
      console.log(`${p.productId}\t${formatEuro(p.nu ?? p.prijs)}\t${p.verpakking}\t${p.titel}\t[${p.actieOmschrijving ?? ""}]`);
    }
  });

const voorraad = program.command("voorraad").description("Voorraad bekijken en tellen");
voorraad
  .command("verwacht")
  .description("Verwachte voorraad per artikel (laatste telling + levering − verbruik)")
  .option(...leverOptie)
  .action((o) => {
    for (const r of verwachteVoorraad(week(o))) {
      const e = r.artikel.eenheid;
      const f = (x: number) => formatHoeveelheid(Math.round(x), e);
      console.log(`${r.artikel.id}\t${f(r.verwacht)}\t(geteld ${f(r.geteld)} + geleverd ${f(r.ontvangen)} − recepten ${f(r.recepten)} − standaard ${f(r.standaard)})`);
    }
  });
voorraad
  .command("telling [paren...]")
  .description('Leg de telling vast: artikel=hoeveelheid ("melk=2000" of "melk=2 l"); niet genoemd = verwachte waarde')
  .option(...leverOptie)
  .action((p: string[] = [], o) => {
    const artikelen = new Map(laadArtikelen().map((a) => [a.id, a]));
    const { verbruik } = verwerkTelling(week(o), paren(p, artikelen));
    console.log("Telling opgeslagen.");
    for (const v of verbruik) {
      const e = artikelen.get(v.artikel)!.eenheid;
      console.log(`${v.artikel}: deze week ${formatHoeveelheid(Math.round(v.gemeten), e)}, gemiddeld ${formatHoeveelheid(Math.round(v.gemiddelde), e)}/week`);
    }
  });
voorraad
  .command("zet <paren...>")
  .description("Pas de voorraad tussendoor aan zonder verbruik te meten (bijv. kattengrit=0)")
  .action((p: string[]) => {
    const artikelen = new Map(laadArtikelen().map((a) => [a.id, a]));
    const v = laadVoorraad();
    Object.assign(v.artikelen, paren(p, artikelen));
    bewaarVoorraad(v);
    console.log("Voorraad bijgewerkt.");
  });

program
  .command("menu")
  .description("Stel 6 diners voor (maandag t/m zaterdag)")
  .option(...leverOptie)
  .action(async (o) => {
    const w = week(o);
    const v = menuVoorstel(w, await periodeVan(w));
    console.log(v.rouleren ? "Rouleren actief (≥ 18 recepten)." : "Minder dan 18 recepten: herhalen toegestaan.");
    for (const m of v.menu) console.log(`${m.dag}\t${m.recept.id}\t${m.recept.naam}\t${m.score?.redenen.join("; ") ?? ""}`);
    console.log("\nAlle scores:");
    for (const s of v.scores.slice(0, 12)) console.log(`  ${s.score.toFixed(1)}\t${s.receptId}\t${s.redenen.join("; ")}`);
  });

program
  .command("menu-zet <dagen...>")
  .description('Leg het menu vast: "maandag=recept-id" ...; --dubbel en --vooruit met recept-ids')
  .option("--dubbel <ids...>", "recepten die dubbel gekookt worden")
  .option("--vooruit <ids...>", "recepten voor volgende week waarvan bonusingrediënten nu al gekocht worden")
  .option(...leverOptie)
  .action((dagen: string[], o) => {
    const w = week(o);
    const recepten = new Set(laadRecepten().map((r) => r.id));
    const vast = new Set(w.menu.filter((m) => m.vastgezet).map((m) => m.recept));
    const menu: Week["menu"] = dagen.map((d) => {
      const [dag, recept] = d.split("=");
      if (!recept || !recepten.has(recept)) throw new Error(`Onbekend recept in "${d}"`);
      return { dag: dag as Week["menu"][number]["dag"], recept, dubbel: (o.dubbel ?? []).includes(recept), vastgezet: vast.has(recept) };
    });
    for (const id of o.vooruit ?? []) if (!recepten.has(id)) throw new Error(`Onbekend recept "${id}"`);
    bewaarWeek({ ...w, menu, vooruitRecepten: o.vooruit ?? [] });
    console.log(`Menu voor ${w.week} opgeslagen (${menu.length} dagen).`);
  });

program
  .command("persoonlijke-bonus <productId> <omschrijving>")
  .description('Leg een geactiveerde persoonlijke bonus vast, bijv. 450534 "1+1 gratis" [--nu 0.59]')
  .option("--nu <prijs>", "actieprijs per stuk als die bekend is")
  .option(...leverOptie)
  .action((id: string, omschrijving: string, o) => {
    const w = week(o);
    const pb = w.persoonlijkeBonus.filter((p) => p.productId !== Number(id));
    pb.push({ productId: Number(id), omschrijving, ...(o.nu ? { nu: Number(o.nu) } : {}) });
    bewaarWeek({ ...w, persoonlijkeBonus: pb });
    console.log("Persoonlijke bonus opgeslagen. Draai `prijzen` opnieuw als het product nieuw is.");
  });

program
  .command("advies")
  .description("Bereken de bestelling voor het vastgelegde menu en sla die op in de week")
  .option("--extra <paren...>", "extra producten productId=aantal (bijv. aanvulling tot het minimum)")
  .option(...leverOptie)
  .action(async (o) => {
    const w = week(o);
    if (!w.menu.length) console.log("Let op: nog geen menu vastgelegd; alleen standaardproducten.");
    const extra = (o.extra ?? []).map((p: string) => {
      const [id, n] = p.split("=");
      return { productId: Number(id), aantal: Number(n ?? 1) };
    });
    const a = maakAdvies(w, await periodeVan(w), extra);
    bewaarWeek({ ...w, bestelling: a.regels, totaal: a.totaal, besparing: a.besparing });
    for (const r of a.regels) console.log(`${r.reden}\t${r.aantal}×\t${formatEuro(r.kosten)}\t${r.titel}\t${r.toelichting ?? ""}`);
    console.log(`\nTotaal ${formatEuro(a.totaal)}, bespaard ${formatEuro(a.besparing)}.`);
    if (a.onderMinimum > 0) {
      console.log(`\nOnder minimum (${formatEuro(a.onderMinimum)} tekort). Aanvulsuggesties (bonus eerst):`);
      for (const s of a.aanvulSuggesties.slice(0, 10)) console.log(`  ${s.productId}\t${s.bonus ? "BONUS\t" : "\t"}${s.titel} (${s.artikel.id})`);
    }
    if (a.meldingen.length) console.log(`\nMeldingen:\n- ${a.meldingen.join("\n- ")}`);
  });

program
  .command("ontvangen <paren...>")
  .description("Leg vast wat er vorige week werkelijk geleverd is: productId=aantal ...")
  .option("--week <week>", "week (standaard de vorige bestelde week)")
  .option(...leverOptie)
  .action((p: string[], o) => {
    const w = o.week ? alleWeken().find((x) => x.week === o.week) : vorigeWeek(week(o).week);
    if (!w) throw new Error("Geen vorige week gevonden.");
    const ontvangen = p.map((x) => {
      const [id, n] = x.split("=");
      return { productId: Number(id), aantal: Number(n) };
    });
    bewaarWeek({ ...w, ontvangen });
    console.log(`Ontvangen voor ${w.week} opgeslagen (${ontvangen.length} producten).`);
  });

program
  .command("gekookt <ids...>")
  .description("Markeer recepten van vorige week als NIET gekookt (--niet) of gekookt")
  .option("--niet", "deze recepten zijn niet gekookt")
  .option(...leverOptie)
  .action((ids: string[], o) => {
    const w = vorigeWeek(week(o).week);
    if (!w) throw new Error("Geen vorige week gevonden.");
    const menu = w.menu.map((m) => ({ ...m, gekookt: ids.includes(m.recept) ? !o.niet : (m.gekookt ?? true) }));
    bewaarWeek({ ...w, menu });
    console.log(`Vorige week (${w.week}) bijgewerkt.`);
  });

program
  .command("afronden")
  .description("Markeer de week als besteld, leg vooruit-aankopen vast en schrijf de weeksamenvatting")
  .option(...leverOptie)
  .action((o) => {
    const w = rondWeekAf(week(o));
    const md = renderWeekMd(w, laadRecepten());
    const pad = join(WEKEN, `${w.week}.md`);
    writeFileSync(pad, md, "utf8");
    console.log(`Week ${w.week} afgerond. Samenvatting: ${pad}`);
  });

program
  .command("samenvatting")
  .description("Toon de weeksamenvatting (markdown)")
  .option(...leverOptie)
  .action((o) => console.log(renderWeekMd(week(o), laadRecepten())));

program
  .command("recepten-md")
  .description("Maak recepten.md opnieuw uit data/recepten.json")
  .action(() => {
    const md = renderReceptenMd(laadRecepten(), new Map(laadArtikelen().map((a) => [a.id, a])), laadProducten(), alleWeken());
    writeFileSync(join(ROOT, "recepten.md"), md, "utf8");
    console.log("recepten.md bijgewerkt.");
  });

program
  .command("standaardlijst <json>")
  .description("Vergelijk het AH-standaardlijstje (output van `web standaardlijst`) met de standaardartikelen")
  .action((tekst: string) => {
    const lijst = JSON.parse(tekst) as { items: { productId: number }[] };
    const artikelen = laadArtikelen();
    const producten = laadProducten();
    const v = vergelijkStandaardlijst(
      lijst.items.map((i) => i.productId),
      artikelen,
    );
    const naam = (id: number) => producten[String(id)]?.titel ?? `product ${id} (draai: product ${id})`;
    if (!v.nieuw.length && !v.wordtStandaard.length && !v.verdwenen.length) return console.log("Standaardlijst ongewijzigd.");
    for (const id of v.nieuw) console.log(`NIEUW\t${id}\t${naam(id)}`);
    for (const x of v.wordtStandaard) console.log(`WORDT STANDAARD\t${x.productId}\t${naam(x.productId)}\t(artikel ${x.artikel})`);
    for (const id of v.verdwenen) console.log(`VERDWENEN\t${id}\t${artikelen.find((a) => a.id === id)?.naam}`);
  });

program
  .command("controle")
  .description("Controleer of alle data klopt (verwijzingen, inhoud van producten)")
  .action(() => {
    const artikelen = laadArtikelen();
    const ids = new Set(artikelen.map((a) => a.id));
    const producten = laadProducten();
    const fouten: string[] = [];
    for (const a of artikelen) {
      for (const p of a.producten) {
        const prod = producten[String(p)];
        if (!prod) fouten.push(`${a.id}: product ${p} staat niet in producten.json (draai: product ${p})`);
        else if (!prod.inhoud || prod.inhoud.eenheid !== a.eenheid) fouten.push(`${a.id}: inhoud van ${p} "${prod.titel}" onbekend in ${a.eenheid}`);
      }
      if (a.standaard && a.verbruikPerWeek === undefined) fouten.push(`${a.id}: standaardartikel zonder verbruikPerWeek`);
      if ((a.standaard || a.voorraadkast) && !a.houdbaarheidDagen) fouten.push(`${a.id}: houdbaarheid onbekend (nodig om in te slaan)`);
    }
    for (const r of laadRecepten()) for (const i of r.ingredienten) if (!ids.has(i.artikel)) fouten.push(`recept ${r.id}: onbekend artikel ${i.artikel}`);
    console.log(fouten.length ? `${fouten.length} problemen:\n- ${fouten.join("\n- ")}` : "Alles klopt.");
  });

const web = program.command("web").description("JavaScript voor Claude in Chrome (uitvoeren op een ah.nl-tabblad, ingelogd)");
web.command("mand").description("Lees de winkelmand").action(() => console.log(scriptLeesMand()));
web
  .command("vul-mand")
  .description("Voeg de bestelling van de week toe aan de winkelmand")
  .option(...leverOptie)
  .action((o) => console.log(scriptVulMand(week(o).bestelling.map((r) => ({ productId: r.productId, aantal: r.aantal })))));
web
  .command("standaardlijst")
  .description("Lees het AH-standaardlijstje")
  .action(() => console.log(scriptLeesLijst(STANDAARD_LIJST)));
web.command("lijst <id>").description("Lees een favorietenlijstje").action((id: string) => console.log(scriptLeesLijst(id)));
web.command("lijsten").description("Lijstjes op de pagina ah.nl/favorieten").action(() => console.log(scriptAlleLijsten()));
web
  .command("maak-lijst <recept-id>")
  .description("Maak het AH-lijstje voor een recept (producten = standaardproduct per ingrediënt, niet voorraadkast)")
  .action((id: string) => {
    const r = laadRecepten().find((x) => x.id === id);
    if (!r) throw new Error(`Onbekend recept ${id}`);
    const artikelen = new Map(laadArtikelen().map((a) => [a.id, a]));
    const producten = laadProducten();
    const regels = r.ingredienten.map((i) => {
      const a = artikelen.get(i.artikel);
      if (!a) throw new Error(`Onbekend artikel ${i.artikel}`);
      const p = producten[String(a.producten[0])];
      const aantal = p?.inhoud && p.inhoud.eenheid === a.eenheid ? Math.max(1, Math.ceil(i.hoeveelheid / p.inhoud.waarde)) : 1;
      return { productId: a.producten[0]!, aantal };
    });
    console.log(scriptMaakLijst(r.naam, regels));
  });

program.parseAsync().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
