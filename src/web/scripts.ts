// Genereert JavaScript dat Claude via Claude in Chrome uitvoert op een ah.nl-tabblad waar de gebruiker is ingelogd.
// De website heeft een eigen GraphQL-adres (/gql) dat met de login-cookies werkt. Zo hoeven we niet te klikken
// en slaan we geen tokens of wachtwoorden op.
//
// Vastgesteld op 2026-11-01:
// - basket { items { quantity product { id title } } summary { quantity price { totalPrice { amount } } } }
// - basketItemsAdd(items: [BasketMutation!]) met BasketMutation { id: productId, quantity }
// - favoriteListV2(ids: [String!]!) { id description totalSize items { id productId quantity } }
// - favoriteListAddV2(description: String!) → FavoriteListMutationResultV2 { status errorMessage result { ... } }
// - favoriteListProductsAddV2(id, products: [{ productId, quantity }])

const GQL_HELPER = `
const gql = async (query, variables = {}) => {
  const r = await fetch('/gql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-name': 'ah-favorites', 'x-client-version': '1' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors.map(e => e.message).join(' | '));
  return j.data;
};
const leesMand = async () => (await gql('query { basket { items { quantity product { id title } } summary { quantity price { totalPrice { amount } discount { amount } } } } }')).basket;
`;

/** Script dat de huidige winkelmand teruggeeft als JSON. */
export function scriptLeesMand(): string {
  return `${GQL_HELPER}
const m = await leesMand();
JSON.stringify({ items: m.items.map(i => ({ id: i.product.id, titel: i.product.title, aantal: i.quantity })), totaal: m.summary.price.totalPrice.amount, korting: m.summary.price.discount.amount });`;
}

/**
 * Script dat producten aan de winkelmand toevoegt (bovenop wat er al in zit)
 * en daarna controleert of elk aantal echt met het gevraagde aantal is gestegen.
 */
export function scriptVulMand(regels: { productId: number; aantal: number }[]): string {
  const items = regels.map((r) => ({ id: r.productId, quantity: r.aantal }));
  return `${GQL_HELPER}
const gewenst = ${JSON.stringify(items)};
const voor = await leesMand();
const aantalVoor = new Map(voor.items.map(i => [i.product.id, i.quantity]));
const fouten = [];
const voegToe = async (blok) => {
  try { await gql('mutation M($items: [BasketMutation!]!) { basketItemsAdd(items: $items) { __typename } }', { items: blok }); }
  catch (e) { fouten.push(String(e.message || e)); }
};
// Nieuwe producten: optellen en vast aantal zetten geven hetzelfde resultaat.
const nieuw = gewenst.filter(g => !aantalVoor.has(g.id));
for (let i = 0; i < nieuw.length; i += 10) await voegToe(nieuw.slice(i, i + 10));
// Producten die al in de mand zaten: eerst met één product bepalen of basketItemsAdd optelt of een vast aantal zet.
const bestaand = gewenst.filter(g => aantalVoor.has(g.id));
if (bestaand.length) {
  const eerste = bestaand[0];
  await voegToe([{ id: eerste.id, quantity: eerste.quantity }]);
  const nu = new Map((await leesMand()).items.map(i => [i.product.id, i.quantity])).get(eerste.id) || 0;
  const telOp = nu === aantalVoor.get(eerste.id) + eerste.quantity;
  if (!telOp) await voegToe([{ id: eerste.id, quantity: aantalVoor.get(eerste.id) + eerste.quantity }]);
  const rest = bestaand.slice(1).map(g => ({ id: g.id, quantity: telOp ? g.quantity : aantalVoor.get(g.id) + g.quantity }));
  for (let i = 0; i < rest.length; i += 10) await voegToe(rest.slice(i, i + 10));
}
const na = await leesMand();
const aantalNa = new Map(na.items.map(i => [i.product.id, i.quantity]));
const afwijkingen = gewenst
  .map(g => ({ id: g.id, verwacht: (aantalVoor.get(g.id) || 0) + g.quantity, nu: aantalNa.get(g.id) || 0 }))
  .filter(x => x.verwacht !== x.nu);
JSON.stringify({ fouten, afwijkingen, totaal: na.summary.price.totalPrice.amount, korting: na.summary.price.discount.amount, artikelen: na.summary.quantity });`;
}

/** Script dat een favorietenlijstje uitleest (id = de UUID uit de URL). */
export function scriptLeesLijst(lijstId: string): string {
  return `${GQL_HELPER}
const d = await gql('query FL($ids: [String!]!) { favoriteListV2(ids: $ids) { id description totalSize items { productId quantity } } }', { ids: [${JSON.stringify(lijstId.toUpperCase())}] });
JSON.stringify(d.favoriteListV2[0]);`;
}

/** Script dat alle favorietenlijstjes van de gebruiker opsomt. */
export function scriptAlleLijsten(): string {
  return `${GQL_HELPER}
const links = [...document.querySelectorAll('a[href*="/favorieten/lijst/"]')].map(a => ({ naam: a.innerText.replace(/\\s+/g, ' ').trim(), url: a.href }));
JSON.stringify(links);`;
}

/**
 * Script dat een nieuw favorietenlijstje maakt en producten toevoegt.
 * Geeft het lijst-id en de volledige URL terug. Werkt de API anders dan verwacht,
 * dan valt de skill terug op de website (popup → "lijstje aanpassen" → URL kopiëren).
 */
export function scriptMaakLijst(naam: string, producten: { productId: number; aantal: number }[]): string {
  return `${GQL_HELPER}
const naam = ${JSON.stringify(naam)};
const res = (await gql('mutation A($d: String!) { favoriteListAddV2(description: $d) { status errorMessage result { id description } } }', { d: naam })).favoriteListAddV2;
if (res.status !== 'SUCCESS' || !res.result) throw new Error('Lijst maken mislukt: ' + (res.errorMessage || res.status));
const id = res.result.id;
const p = ${JSON.stringify(producten.map((p) => ({ productId: p.productId, quantity: p.aantal })))};
const add = (await gql('mutation P($id: String!, $products: [FavoriteListProductMutation!]!) { favoriteListProductsAddV2(id: $id, products: $products) { status errorMessage } }', { id, products: p })).favoriteListProductsAddV2;
const check = (await gql('query FL($ids: [String!]!) { favoriteListV2(ids: $ids) { totalSize } }', { ids: [id.toUpperCase()] })).favoriteListV2[0];
JSON.stringify({ id: id.toLowerCase(), url: 'https://www.ah.nl/favorieten/lijst/' + id.toLowerCase(), toevoegen: add.status, fout: add.errorMessage, aantalInLijst: check.totalSize, verwacht: p.length });`;
}
