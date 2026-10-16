// Test de bout en bout : iPhone simulé + dépôt GitHub simulé.
// Usage : npm install && npm test
//   (dans un environnement où Chromium est déjà installé : CHROME=/chemin/vers/chrome npm test)
import { chromium, devices } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8800 + Math.floor(Math.random() * 100);
const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: root, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const URL_APP = `http://localhost:${PORT}/`;

// ---- Faux GitHub (API contents + fichier brut) ----
let remote = readFileSync(join(root, "data/centrales.json"), "utf8")
  .replace(/(\{"n": "CNPE St Laurent", "lat": [\d.-]+, "lon": [\d.-]+)\}/, '$1, "note": "Emplacement à confirmer"}');
let sha = "sha0", rev = 0;
const commits = [];
async function github(route) {
  const req = route.request(), url = req.url(), h = { "access-control-allow-origin": "*" };
  if (!url.includes("/DataNavigationCentrales")) return route.fulfill({ status: 404, json: { message: "mauvais dépôt" }, headers: h });
  if (url.includes("raw.githubusercontent.com")) return route.fulfill({ body: remote, contentType: "application/json", headers: h });
  if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { ...h, "access-control-allow-headers": "*", "access-control-allow-methods": "GET,PUT" } });
  if (req.headers()["authorization"] !== "Bearer good") return route.fulfill({ status: 401, json: { message: "Bad credentials" }, headers: h });
  if (req.method() === "GET") return route.fulfill({ json: { sha, content: Buffer.from(remote).toString("base64") }, headers: h });
  const body = JSON.parse(req.postData());
  if (body.sha !== sha) return route.fulfill({ status: 409, json: { message: "conflict" }, headers: h });
  remote = Buffer.from(body.content, "base64").toString("utf8");
  sha = `sha${++rev}`;
  commits.push(body.message);
  return route.fulfill({ json: { content: { sha } }, headers: h });
}
const count = () => (remote.match(/"n":/g) || []).length;
const initial = count();

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
// standalone : appli lancée depuis l'écran d'accueil (iPhone). tutorial : garder le didacticiel
// du premier lancement ouvert (sinon il est passé).
async function phone(device = "iPhone 15 Pro", { standalone = false, tutorial = false } = {}) {
  const ctx = await browser.newContext({ ...devices[device], locale: "fr-FR", geolocation: { latitude: 45.2, longitude: 5.9 }, permissions: ["geolocation"] });
  await ctx.route(/api\.github\.com|raw\.githubusercontent\.com/, github);
  await ctx.route(/tile\.openstreetmap|arcgisonline|nominatim/, (r) => r.fulfill({ status: 204 }));
  if (standalone) await ctx.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  // Chrome sans sélecteurs de fichiers (Android avant Chrome 132) : téléchargement du fichier de favoris
  await ctx.addInitScript(() => { for (const k of ["showSaveFilePicker", "showOpenFilePicker"]) { delete window[k]; delete Window.prototype[k]; } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(URL_APP);
  await page.waitForSelector(".row");
  await page.waitForTimeout(800);
  if (!tutorial && await page.isVisible("#news")) { await page.click("#newsSkip"); await page.waitForTimeout(300); }
  return { ctx, page };
}
const status = (p) => p.$eval("#status", (e) => e.textContent);
const names = (p) => p.$$eval(".row-name", (r) => r.map((x) => x.textContent));
let step = 0;
const ok = (msg) => console.log(`✓ ${++step}. ${msg}`);

try {
  // Lecture seule, recherche
  const { ctx: ctxA, page: A } = await phone();
  assert.equal(await status(A), "À jour");
  assert.equal(await A.isVisible("#add"), false);
  assert.equal(await A.isVisible("#news"), false);
  assert.equal(await A.isVisible("#favFile"), false);   // Safari sur iPhone : seulement dans l'appli installée
  ok("lecteur : liste à jour, pas de bouton +, ni didacticiel ni question sur les favoris dans Safari");
  {
    const { ctx, page } = await phone();
    assert.equal(await page.isVisible("#install"), true);
    await page.click("#installNo");
    assert.equal(await page.isVisible("#install"), false);
    await page.reload(); await page.waitForSelector(".row"); await page.waitForTimeout(500);
    assert.equal(await page.isVisible("#install"), false);
    assert.equal(await page.isVisible("#news"), false);   // ni didacticiel ni nouveautés dans Safari
    assert.deepEqual(page.errors, []);
    await ctx.close();
  }
  ok("Safari sur iPhone : la croix « Déjà installée » masque le bandeau d'installation, même au lancement suivant");

  // Didacticiel : toutes les fiches (sauf édition) au premier lancement, une seule fois
  {
    const { ctx, page } = await phone("Pixel 7", { tutorial: true });
    const pages = await page.evaluate(() => NEWS.reduce((n, e) => n + (e.items || []).filter((it) => !it.editors).length, 0));
    assert.equal(await page.isVisible("#news"), true);
    assert.equal(await page.textContent("#newsKicker"), "Bienvenue");
    assert.equal(await page.textContent("#newsTitle"), "Lancer la navigation, même sans réseau");
    assert.equal(await page.$$eval("#newsDots span", (d) => d.length), pages);
    assert.equal(await page.isVisible("#favFile"), false);
    for (let i = 1; i < pages; i++) await page.click("#newsNext");
    assert.equal(await page.textContent("#newsNext"), "Compris");
    assert.equal(await page.isVisible("#newsWhere"), true);
    await page.click("#newsNext"); await page.waitForTimeout(300);
    assert.equal(await page.isVisible("#news"), false);
    assert.equal(await page.isVisible("#favFile"), true);   // la question des favoris vient après
    await page.click("#favFileLater");
    await page.reload(); await page.waitForSelector(".row"); await page.waitForTimeout(500);
    assert.equal(await page.isVisible("#news"), false);
    assert.deepEqual(page.errors, []);
    await ctx.close();
  }
  {
    const { ctx, page } = await phone(undefined, { standalone: true, tutorial: true });
    assert.equal(await page.isVisible("#news"), true);
    assert.equal(await page.textContent("#newsKicker"), "Bienvenue");
    await ctx.close();
  }
  ok("didacticiel au premier lancement (Android, appli installée sur iPhone), puis la question des favoris ; plus ensuite");
  await A.fill("#q", "st lau"); await A.waitForTimeout(200);
  assert.deepEqual(await names(A), ["CNPE St Laurent"]);
  ok("recherche « st lau » → CNPE St Laurent");
  assert.equal(await A.textContent(".row .tag.note"), "Emplacement à confirmer");
  await A.click(".row"); await A.waitForTimeout(300);
  assert.equal(await A.isVisible("#sheetNote"), true);
  assert.equal(await A.textContent("#sheetNote"), "Emplacement à confirmer");
  await A.click("#close"); await A.waitForTimeout(200);
  await A.fill("#q", "rhinau"); await A.waitForTimeout(200);
  await A.click(".row"); await A.waitForTimeout(300);
  assert.equal(await A.isVisible("#sheetNote"), false);
  await A.click("#close"); await A.waitForTimeout(200);
  await A.fill("#q", "");
  ok("remarque « Emplacement à confirmer » dans la liste et la fiche, absente ailleurs");

  // Hors ligne au relancement
  await A.evaluate(() => navigator.serviceWorker.ready);
  await ctxA.setOffline(true);
  await A.reload(); await A.waitForSelector(".row");
  assert.equal((await A.$$(".row")).length > 500, true);
  await ctxA.setOffline(false);
  ok("relance sans réseau : liste disponible");

  // Code d'édition
  await A.click("#openSettings");
  assert.equal(await A.isVisible("#setControl"), false);
  assert.match(await A.textContent("#setVersion"), /^Version \d+\.\d+\.\d+ \(cache \d{4}-\d{2}-\d{2}\.\d+\)$/);
  ok("réglages : numéro de version et de cache affichés");
  await A.fill("#setToken", "bad"); await A.click("#setTokenGo"); await A.waitForTimeout(300);
  assert.match(await A.$eval("#setTokenMsg", (e) => e.textContent), /pas valide/);
  await A.fill("#setToken", "good"); await A.click("#setTokenGo"); await A.waitForTimeout(500);
  assert.equal(await A.isVisible("#setControl"), true);
  assert.match(await A.getAttribute("#setControl", "href"), /^https:\/\/claude\.ai\/artifact\//);
  await A.waitForSelector("#news[open]");
  assert.equal(await A.textContent("#newsTitle"), "Les codes Google compris à l'ajout");
  await A.click("#newsNext"); await A.waitForTimeout(200);
  assert.equal(await A.textContent("#newsTitle"), "Modifier une centrale");
  await A.click("#newsNext"); await A.waitForTimeout(200);
  assert.equal(await A.isVisible("#news"), false);
  ok("code validé : les nouveautés réservées à l'édition sont présentées");
  await A.click("#setClose");
  assert.equal(await A.isVisible("#add"), true);
  ok("code refusé puis accepté, bouton + visible, lien « Contrôle des positions GPS » dans les réglages");

  // Ajout synchronisé
  await A.click("#add"); await A.waitForTimeout(300);
  await A.fill("#fName", "TEST AJOUT"); await A.fill("#fCoords", "45.5, 6.5");
  await A.selectOption("#fGroup", "UP Alpes|GEH Ecrins Vercors");
  await A.click("#editorSave");
  await A.waitForTimeout(2500);
  assert.equal(count(), initial + 1);
  assert.match(commits.at(-1), /^Ajout de TEST AJOUT/);
  assert.match(remote, /\{"n": "CNPE St Laurent", "lat": [\d.-]+, "lon": [\d.-]+, "note": "Emplacement à confirmer"\}/);
  assert.ok(remote.includes('{"n": "TEST AJOUT", "lat": 45.5, "lon": 6.5, "up": "UP Alpes", "geh": "GEH Ecrins Vercors"}'));
  ok("ajout envoyé au dépôt (commit) avec son groupe, remarques existantes conservées");

  // Codes Google (Plus Codes) et formats GPS dans l'écran d'ajout
  await ctxA.route(/nominatim/, (r) => (r.request().url().includes("Arrens")
    ? r.fulfill({ json: [{ lat: "42.9617", lon: "-0.2097", name: "Arrens-Marsous", display_name: "Arrens-Marsous, Hautes-Pyrénées" }], headers: { "access-control-allow-origin": "*" } })
    : r.fallback()));
  await A.click("#add"); await A.waitForTimeout(300);
  await A.fill("#fCoords", "XQ5R+9M Arrens-Marsous"); await A.waitForTimeout(1600);
  assert.match(await A.textContent("#fCoordsMsg"), /^42\.95843\d, -0\.20831\d · /);
  await A.fill("#fCoords", "8FVC9G8F+6X");
  assert.match(await A.textContent("#fCoordsMsg"), /^47\.36556\d, 8\.52493\d · /);
  await A.fill("#fCoords", "N 45° 6.272' E 1° 57.215'");
  assert.notEqual(await A.getAttribute("#fCoordsMsg", "class"), "error");
  await A.fill("#fSearch", "XQ5R+9M, 65400 Arrens-Marsous"); await A.press("#fSearch", "Enter"); await A.waitForTimeout(600);
  assert.match(await A.inputValue("#fCoords"), /^42\.95843\d, -0\.20831\d$/);
  await A.click("#editorCancel"); await A.waitForTimeout(200);
  ok("écran d'ajout : codes Google court (avec commune) et complet, degrés-minutes des GPS");

  // Autre téléphone
  const { page: B } = await phone("Pixel 7");
  assert.equal(await B.isVisible("#favFile"), true);
  await B.click("#favFileLater"); await B.waitForTimeout(200);
  assert.equal(await B.textContent("#toastMsg"), "À faire plus tard dans Réglages\u00a0→\u00a0Favoris");
  assert.equal(await B.isVisible("#toastAction"), false);
  await B.reload(); await B.waitForSelector(".row"); await B.waitForTimeout(500);
  assert.equal(await B.isVisible("#favFile"), false);
  ok("favoris : question posée au premier lancement ; « Plus tard » renvoie aux Réglages et elle n'est plus posée");
  await B.fill("#q", "test ajout"); await B.waitForTimeout(200);
  assert.deepEqual(await names(B), ["TEST AJOUT"]);
  await B.click(".row"); await B.waitForTimeout(300);
  assert.equal(await B.isVisible("#goPlans"), false);
  ok("autre téléphone (Android) : voit l'ajout, pas de bouton Plans");

  // Suppression + annulation
  await A.fill("#q", "test ajout"); await A.waitForTimeout(200);
  await A.click(".row"); await A.waitForTimeout(300);
  await A.click("#remove"); await A.waitForTimeout(200);
  assert.equal(count(), initial + 1);   // rien de supprimé avant la confirmation
  assert.match(await A.textContent("#confirm p"), /pour tout le monde/);
  assert.equal(await A.textContent("#confirmOk"), "Supprimer pour tous");
  await A.click("#confirmOk"); await A.waitForTimeout(2200);
  assert.equal(count(), initial);
  await A.click("#toastAction"); await A.waitForTimeout(2500);
  assert.equal(count(), initial + 1);
  ok("suppression confirmée puis annulée");

  // Hors ligne + conflit
  await ctxA.setOffline(true); await A.evaluate(() => dispatchEvent(new Event("offline")));
  await A.click("#add"); await A.waitForTimeout(300);
  await A.fill("#fName", "HORS LIGNE"); await A.fill("#fCoords", "44.1, 3.2"); await A.click("#editorSave");
  await A.waitForTimeout(1800);
  assert.equal(await status(A), "1 en attente");
  remote = remote.replace("\n]\n", ',\n{"n": "AUTRE", "lat": 43.1, "lon": 2.1}\n]\n'); sha = "shaX";
  await ctxA.setOffline(false); await A.evaluate(() => dispatchEvent(new Event("online")));
  await A.waitForTimeout(2500);
  assert.equal(await status(A), "À jour");
  assert.ok(remote.includes("HORS LIGNE") && remote.includes("AUTRE"));
  ok("modification hors ligne envoyée au retour du réseau, sans écraser une modif concurrente");

  // Modifier une centrale : balayage → « Modifier », écran d'ajout rempli, envoi, annulation
  await A.fill("#q", "test ajout"); await A.waitForTimeout(200);
  const oldId = await A.getAttribute(".row", "data-id"), countBefore = count();
  await A.click(".row"); await A.waitForTimeout(300);
  assert.equal(await A.isVisible("#sheetGroup"), true);
  assert.equal(await A.textContent("#sheetGroup"), "UP Alpes · GEH Ecrins Vercors");
  assert.equal(await A.isVisible("#sheetMap"), true);   // aussi depuis la liste
  assert.equal(await A.isVisible("#edit"), true);
  await A.click("#sheetStar"); await A.waitForTimeout(200);
  await A.click("#close"); await A.waitForTimeout(200);
  {
    const b = await A.locator(".swipe").first().boundingBox();
    const x = b.x + b.width - 30, y = b.y + b.height / 2;
    await A.mouse.move(x, y); await A.mouse.down();
    for (let i = 1; i <= 12; i++) await A.mouse.move(x - (200 * i) / 12, y);
    await A.mouse.up(); await A.waitForTimeout(600);
  }
  assert.equal(await A.isVisible(".swipe .swipe-edit"), true);
  assert.equal(await A.isVisible(".swipe .swipe-del"), false);   // pas un récent
  await A.click(".swipe .swipe-edit"); await A.waitForTimeout(400);
  assert.equal(await A.isVisible("#editor"), true);
  assert.equal(await A.textContent("#editorTitle"), "Modifier la centrale");
  assert.equal(await A.textContent("#editorSave"), "Enregistrer");
  assert.equal(await A.inputValue("#fName"), "TEST AJOUT");
  assert.equal(await A.inputValue("#fGroup"), "UP Alpes|GEH Ecrins Vercors");
  assert.equal(await A.inputValue("#fCoords"), "45.500000, 6.500000");
  assert.equal(await A.isDisabled("#editorSave"), false);
  await A.fill("#fName", "TEST MODIF");
  await A.fill("#fNote", "Tête de GU");
  await A.click("#editorSave"); await A.waitForTimeout(2500);
  assert.equal(count(), countBefore);
  assert.match(commits.at(-1), /^Modification de TEST AJOUT\n\n~ TEST AJOUT → TEST MODIF \(45\.5, 6\.5\)/);
  assert.ok(remote.includes('{"n": "TEST MODIF", "lat": 45.5, "lon": 6.5, "up": "UP Alpes", "geh": "GEH Ecrins Vercors", "note": "Tête de GU"}'));
  assert.ok(!remote.includes("TEST AJOUT"));
  const newId = "TEST MODIF|45.5|6.5";
  assert.deepEqual(await A.evaluate(() => JSON.parse(localStorage.getItem("favs"))), [newId]);
  assert.equal(await A.isVisible("#editor"), false);
  await A.fill("#q", "test modif"); await A.waitForTimeout(200);
  assert.equal(await A.textContent(".row .tag.note"), "Tête de GU");
  ok("modifier : balayage → « Modifier », écran rempli, envoi (commit « Modification de »), favori conservé");
  await A.click("#toastAction"); await A.waitForTimeout(2500);
  assert.ok(remote.includes('{"n": "TEST AJOUT", "lat": 45.5, "lon": 6.5, "up": "UP Alpes", "geh": "GEH Ecrins Vercors"}'));
  assert.ok(!remote.includes("TEST MODIF"));
  assert.deepEqual(await A.evaluate(() => JSON.parse(localStorage.getItem("favs"))), [oldId]);
  await A.fill("#q", "test ajout"); await A.waitForTimeout(200);
  await A.click(".row"); await A.waitForTimeout(300);
  await A.click("#edit"); await A.waitForTimeout(400);
  assert.equal(await A.textContent("#editorTitle"), "Modifier la centrale");
  await A.click("#editorSave"); await A.waitForTimeout(300);
  assert.equal(await A.textContent("#toastMsg"), "Aucune modification");
  await A.fill("#q", "");
  ok("modifier : « Annuler » revient en arrière ; « Modifier » dans la fiche ; rien de changé → rien d'envoyé");

  // Récents : balayage vers la gauche
  const { page: C } = await phone();
  const ids = await C.evaluate(() => {
    const ids = plants.slice(0, 3).map((p) => p.id);
    localStorage.setItem("recents", JSON.stringify(ids));
    return ids;
  });
  await C.reload(); await C.waitForSelector(".swipe.recent");
  const recentIds = () => C.$$eval(".swipe.recent", (r) => r.map((x) => x.dataset.id));
  const stored = (k) => C.evaluate((k) => JSON.parse(localStorage.getItem(k) || "[]"), k);
  async function swipe(sel, dx) {
    const b = await C.locator(sel).boundingBox();
    const x = b.x + b.width - 30, y = b.y + b.height / 2;
    await C.mouse.move(x, y); await C.mouse.down();
    for (let i = 1; i <= 12; i++) await C.mouse.move(x + (dx * i) / 12, y);
    await C.mouse.up(); await C.waitForTimeout(600);
  }
  assert.deepEqual(await recentIds(), ids);
  await swipe(`.swipe.recent[data-id="${ids[0]}"]`, -110);
  assert.equal(await C.isVisible(`.swipe.recent[data-id="${ids[0]}"] .swipe-del`), true);
  assert.equal(await C.textContent(`.swipe.recent[data-id="${ids[0]}"] .swipe-del`), "Effacer");
  assert.equal(await C.isVisible("#sheet"), false);
  await C.click(`.swipe.recent[data-id="${ids[0]}"] .swipe-fav`); await C.waitForTimeout(500);
  assert.deepEqual(await stored("favs"), [ids[0]]);
  assert.equal(await C.textContent("#favCount"), "1");
  assert.deepEqual(await recentIds(), ids);
  ok("récents : balayage à moitié → boutons Favori / Effacer, Favori ajoute aux favoris");
  await swipe(`.swipe.recent[data-id="${ids[0]}"]`, -330);
  assert.deepEqual(await recentIds(), ids.slice(1));
  assert.deepEqual(await stored("recents"), ids.slice(1));
  assert.deepEqual(await stored("favs"), [ids[0]]);
  assert.equal((await C.$$(`.row[data-id="${ids[0]}"] .row-star`)).length, 1);
  ok("récents : balayage à fond → retirée des récents, reste dans les favoris");
  await C.click("#toastAction"); await C.waitForTimeout(300);
  assert.deepEqual(await recentIds(), ids);
  await swipe(`.swipe.recent[data-id="${ids[1]}"]`, -110);
  await C.click(`.swipe.recent[data-id="${ids[1]}"] .swipe-del`); await C.waitForTimeout(600);
  assert.deepEqual(await recentIds(), [ids[0], ids[2]]);
  await C.click(`.swipe.recent[data-id="${ids[2]}"] .row`); await C.waitForTimeout(300);
  assert.equal(await C.isVisible("#sheet"), true);
  ok("récents : annulation, bouton Effacer, simple toucher ouvre toujours la fiche");
  await C.click("#close"); await C.waitForTimeout(200);
  const azId = await C.evaluate(() => plants[1].id);
  await swipe(`.swipe:not(.recent)[data-id="${azId}"]`, -110);
  assert.equal(await C.isVisible(`.swipe:not(.recent)[data-id="${azId}"] .swipe-fav`), true);
  assert.equal(await C.$$eval(`.swipe:not(.recent)[data-id="${azId}"] .swipe-actions button`, (b) => b.length), 1);   // ni Modifier (pas de code), ni Effacer
  await C.click(`.swipe:not(.recent)[data-id="${azId}"] .swipe-fav`); await C.waitForTimeout(500);
  assert.ok((await stored("favs")).includes(azId));
  await swipe(`.swipe:not(.recent)[data-id="${azId}"]`, -330);
  assert.equal(await C.isVisible(`.swipe:not(.recent)[data-id="${azId}"] .row`), true);
  assert.equal(await C.isVisible("#sheet"), false);
  await C.click("#q"); await C.waitForTimeout(400);   // referme la ligne
  ok("A–Z : toute ligne se balaie (Favori) ; balayer à fond ne supprime rien");
  await C.fill("#q", "test ajout"); await C.waitForTimeout(200);
  await C.click(".row"); await C.waitForTimeout(300);
  assert.equal(await C.textContent("#sheetGroup"), "UP Alpes · GEH Ecrins Vercors");
  assert.equal(await C.isVisible("#edit"), false);

  // Autour de moi : liste avec icônes, puis carte
  await C.click("#close"); await C.waitForTimeout(200);
  await C.fill("#q", ""); await C.waitForTimeout(200);
  await C.click('[data-mode="near"]'); await C.waitForTimeout(500);
  assert.equal(await C.isVisible("#views"), true);
  assert.equal((await C.$$(".row.with-icon .pi")).length > 10, true);
  await C.click('[data-view="map"]'); await C.waitForSelector("#nmap .mk"); await C.waitForTimeout(500);
  const markers = () => C.$$eval("#nmap .mk", (m) => m.length);
  const total = await C.evaluate(() => plants.length);
  assert.equal(await markers(), total);
  assert.equal(await C.isVisible("#list .row"), false);
  assert.equal(await C.isVisible(".me"), true);
  ok("carte « Autour de moi » : toutes les centrales et la position affichées");
  await C.fill("#q", "cnpe"); await C.waitForTimeout(300);
  assert.equal(await markers(), await C.evaluate(() => plants.filter((p) => p.n.startsWith("CNPE")).length));
  await C.click("#nmap .mk"); await C.waitForTimeout(600);
  assert.equal(await C.isVisible("#sheet"), true);
  assert.match(await C.textContent("#sheetName"), /^CNPE /);
  assert.equal(await C.isVisible("#sheetGroup"), false);   // pas de groupe dans la liste de test
  assert.equal(await C.isVisible("#sheetMap"), true);
  assert.equal(await C.isVisible("#smap .mk .pi"), true);
  await C.click("#close"); await C.waitForTimeout(200);
  await C.fill("#q", "test ajout"); await C.waitForTimeout(300);
  await C.click("#nmap .mk"); await C.waitForTimeout(600);
  assert.equal(await C.textContent("#sheetGroup"), "UP Alpes · GEH Ecrins Vercors");
  assert.equal(await C.isVisible("#sheetMap"), true);
  await C.click("#close"); await C.waitForTimeout(200);
  ok("carte : la recherche filtre les centrales, toucher une centrale ouvre sa fiche avec la petite carte et son UP · GEH");
  await C.fill("#q", ""); await C.waitForTimeout(300);
  await C.click("#nmLegend"); await C.waitForTimeout(300);
  const before = await markers();
  await C.uncheck('#legendBody input[data-up="UP Alpes"]'); await C.waitForTimeout(300);
  assert.equal(await markers(), before - 1);   // TEST AJOUT est la seule centrale de l'UP Alpes
  await C.check('#legendBody input[data-up="UP Alpes"]'); await C.waitForTimeout(300);
  assert.equal(await markers(), before);
  await C.click("#legendClose");
  await C.reload(); await C.waitForSelector(".row");
  await C.click('[data-mode="near"]'); await C.waitForSelector("#nmap .mk");
  assert.equal(await C.getAttribute('[data-view="map"]', "aria-pressed"), "true");
  ok("légende : masquer / réafficher une UP ; le choix Carte est mémorisé");

  // Nouveautés : présentées une seule fois après une mise à jour, puis dans les Réglages
  // Sans code d'édition (C), les fiches `editors` ne sont pas présentées au lancement
  const newsCount = (v, all = false) => C.evaluate(([v, all]) => NEWS.filter((e) => cmpVersion(e.v, v) > 0)
    .reduce((n, e) => n + (e.items || []).filter((it) => all || !it.editors).length, 0), [v, all]);
  assert.equal(await C.isVisible("#news"), false);
  await C.evaluate(() => localStorage.setItem("newsSeen", JSON.stringify("1.7.2")));
  await C.reload(); await C.waitForSelector("#news[open]");
  assert.equal(await C.textContent("#newsKicker"), "Nouveau · version 1.8.0");
  const pages = await newsCount("1.7.2");
  assert.equal(await C.$$eval("#newsDots span", (d) => d.length), pages);
  for (let i = 1; i < pages; i++) { assert.equal(await C.textContent("#newsNext"), "Suivant"); await C.click("#newsNext"); }
  assert.equal(await C.textContent("#newsNext"), "Compris");
  assert.equal(await C.isVisible("#newsWhere"), true);
  await C.click("#newsNext"); await C.waitForTimeout(200);
  assert.equal(await C.isVisible("#news"), false);
  assert.equal(await C.evaluate(() => JSON.parse(localStorage.getItem("newsSeen")) === APP_VERSION), true);
  await C.reload(); await C.waitForSelector(".row"); await C.waitForTimeout(500);
  assert.equal(await C.isVisible("#news"), false);
  ok("nouveautés : présentées après une mise à jour, une seule fois");
  await C.evaluate(() => localStorage.removeItem("newsSeen"));
  await C.reload(); await C.waitForSelector("#news[open]");
  assert.equal(await C.textContent("#newsKicker"), "Nouveau · version 1.7.0");
  assert.equal(await C.$$eval("#newsDots span", (d) => d.length), await newsCount("1.6.0"));
  await C.click("#newsSkip"); await C.waitForTimeout(200);
  assert.equal(await C.isVisible("#news"), false);
  ok("nouveautés : utilisateur d'une version sans cet écran → depuis la 1.7, « Passer » ferme");
  await C.click("#openSettings"); await C.click("#setNews"); await C.waitForTimeout(300);
  assert.equal(await C.$$eval(".nw-item", (b) => b.length), await newsCount("0", true));
  assert.equal(await C.$$eval(".nw", (b) => b.length), await C.evaluate(() => NEWS.length));
  assert.equal(await C.$$eval(".nw-fix", (b) => b.length), await C.evaluate(() => NEWS.reduce((n, e) => n + (e.fixes || []).length, 0)));
  assert.equal(await C.$$eval(".nw-fix .chev", (b) => b.length), 0);
  assert.equal(await C.isVisible('.nw-item:has-text("codes Google")'), true);
  await C.click('.nw-item:has-text("Balayer une centrale récente")'); await C.waitForTimeout(300);
  assert.equal(await C.textContent("#newsTitle"), "Balayer une centrale récente");
  assert.equal(await C.textContent("#newsKicker"), "version 1.7.0");
  await C.click("#newsNext"); await C.waitForTimeout(200);
  assert.equal(await C.isVisible("#news"), false);
  assert.equal(await C.isVisible("#newsAll"), true);
  await C.click("#newsAllClose"); await C.click("#setClose");
  ok("réglages → « Nouveautés de chaque version » : toutes les versions, corrections sans flèche, toucher une fonction ouvre l'explication");

  // Code d'édition saisi plus tard : fiches d'édition présentées une fois, à la première validation
  await C.click("#openSettings");
  await C.fill("#setToken", "good"); await C.click("#setTokenGo"); await C.waitForSelector("#news[open]");
  assert.equal(await C.textContent("#newsTitle"), "Les codes Google compris à l'ajout");
  assert.equal(await C.$$eval("#newsDots span", (d) => d.length), await newsCount("0", true) - await newsCount("0"));
  await C.click("#newsNext"); await C.waitForTimeout(200);
  assert.equal(await C.textContent("#newsTitle"), "Modifier une centrale");
  await C.click("#newsNext"); await C.waitForTimeout(200);
  await C.click("#setEditDisable"); await C.waitForTimeout(200);
  await C.fill("#setToken", "good"); await C.click("#setTokenGo"); await C.waitForTimeout(600);
  assert.equal(await C.isVisible("#news"), false);
  await C.click("#setClose");
  await C.reload(); await C.waitForSelector(".row"); await C.waitForTimeout(500);
  assert.equal(await C.isVisible("#news"), false);
  ok("code saisi plus tard : fiches d'édition présentées à la première validation, une seule fois");

  // Fichier de favoris : création (Android : téléchargement), mise à jour, rechargement après réinstallation
  const { ctx: ctxD, page: D } = await phone("Pixel 7");
  assert.equal(await D.isVisible("#favFile"), true);
  let [dl] = await Promise.all([D.waitForEvent("download"), D.click("#favFileCreate")]);
  assert.equal(dl.suggestedFilename(), "NavigationCentrales-favoris.json");
  assert.deepEqual(JSON.parse(readFileSync(await dl.path(), "utf8")).favoris, []);
  assert.equal(await D.isVisible("#favFile"), false);
  assert.equal(await D.isVisible("#favBackup"), false);
  await D.reload(); await D.waitForSelector(".row"); await D.waitForTimeout(500);
  assert.equal(await D.isVisible("#favFile"), false);
  ok("favoris : « Non, créer le fichier » le télécharge, la question n'est plus posée");
  const favIds = await D.evaluate(() => plants.slice(0, 2).map((p) => p.id));
  for (const id of favIds) {
    await D.click(`.row[data-id="${id}"]`); await D.waitForTimeout(300);
    await D.click("#sheetStar"); await D.waitForTimeout(200);
    assert.equal(await D.textContent("#toastAction"), "Enregistrer");
    await D.click("#close"); await D.waitForTimeout(200);
  }
  assert.equal(await D.isVisible("#favBackup"), true);
  [dl] = await Promise.all([D.waitForEvent("download"), D.click("#favBackupGo")]);
  const favFile = readFileSync(await dl.path());
  const fileIds = JSON.parse(favFile.toString("utf8")).favoris.map((f) => `${f.n}|${f.lat}|${f.lon}`);
  assert.deepEqual(fileIds, favIds);
  assert.equal(await D.isVisible("#favBackup"), false);
  ok("favoris : après un ajout, bandeau « n'est plus à jour » ; « Enregistrer » télécharge le fichier à jour");
  await ctxD.close();

  const { page: E } = await phone("Pixel 7");
  assert.equal(await E.isVisible("#favFile"), true);
  let [chooser] = await Promise.all([E.waitForEvent("filechooser"), E.click("#favFileLoad")]);
  await chooser.setFiles({ name: "NavigationCentrales-favoris.json", mimeType: "application/json", buffer: favFile });
  await E.waitForTimeout(300);
  assert.equal(await E.isVisible("#favFile"), false);
  assert.equal(await E.textContent("#favCount"), "2");
  assert.deepEqual(await E.evaluate(() => JSON.parse(localStorage.getItem("favs"))), favIds);
  assert.equal(await E.isVisible("#favBackup"), false);
  await E.click('[data-mode="fav"]'); await E.waitForTimeout(200);
  assert.equal((await E.$$(".row")).length, 2);
  await E.reload(); await E.waitForSelector(".row"); await E.waitForTimeout(500);
  assert.equal(await E.isVisible("#favFile"), false);
  ok("favoris : réinstallation → « Oui, charger mon fichier » retrouve les favoris");
  await E.click("#openSettings");
  assert.match(await E.textContent("#setFavInfo"), /^2 favoris\. Fichier à jour/);
  [chooser] = await Promise.all([E.waitForEvent("filechooser"), E.click("#setFavLoad")]);
  await chooser.setFiles({ name: "autre.json", mimeType: "application/json", buffer: Buffer.from("pas du json") });
  await E.waitForTimeout(300);
  assert.equal(await E.textContent("#toastMsg"), "Ce fichier ne contient pas de favoris");
  assert.equal(await E.textContent("#favCount"), "2");
  await E.click("#setClose");
  ok("réglages → Favoris : état du fichier ; un fichier invalide est refusé sans rien changer");

  // Fichier de favoris relié (Chrome / Edge sur ordinateur, Chrome ≥ 132 sur Android) : choisi une
  // fois, puis réécrit sur place. Sélecteurs du navigateur remplacés par un faux fichier en mémoire ;
  // broken : le fichier choisi refuse l'écriture (retour au téléchargement).
  async function linked(device, { broken = false } = {}) {
    const ctx = await browser.newContext({ ...(device ? devices[device] : {}), locale: "fr-FR" });
    await ctx.route(/api\.github\.com|raw\.githubusercontent\.com/, github);
    await ctx.addInitScript((broken) => {
      window.fakeFile = { text: null, writes: 0 };
      const h = {
        name: "NavigationCentrales-favoris.json",
        queryPermission: async () => "granted",
        requestPermission: async () => "granted",
        getFile: async () => new File([window.fakeFile.text || ""], h.name),
        createWritable: async () => {
          if (broken) throw new DOMException("refusé", "NotAllowedError");
          return { write: async (t) => { window.fakeFile.text = t; window.fakeFile.writes++; }, close: async () => {} };
        },
      };
      window.showSaveFilePicker = async () => h;
      window.showOpenFilePicker = async () => [h];
    }, broken);
    const page = await ctx.newPage();
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(e.message));
    await page.goto(URL_APP); await page.waitForSelector(".row"); await page.waitForTimeout(800);
    if (await page.isVisible("#news")) { await page.click("#newsSkip"); await page.waitForTimeout(300); }
    return { ctx, page };
  }
  const linkedErrors = [];
  for (const device of [null, "Pixel 7"]) {
    const label = device ? "Android" : "ordinateur";
    const { ctx, page: F } = await linked(device);
    F.on("download", () => F.errors.push("téléchargement inattendu"));
    const fid = await F.evaluate(() => plants[0].id);
    assert.equal(await F.isVisible("#favFile"), true);
    await F.click("#favFileCreate"); await F.waitForTimeout(300);
    assert.deepEqual(JSON.parse(await F.evaluate(() => fakeFile.text)).favoris, []);
    await F.click(`.row[data-id="${fid}"]`); await F.waitForTimeout(300);
    // Ordinateur : nouvel onglet ; Android : inchangé (le lien ouvre l'appli Waze / Maps)
    assert.equal(await F.getAttribute("#goWaze", "target"), device ? null : "_blank");
    assert.equal(await F.getAttribute("#goGmaps", "target"), device ? null : "_blank");
    await F.click("#sheetStar"); await F.waitForTimeout(300);
    assert.equal(await F.textContent("#toastMsg"), "Ajoutée aux favoris, fichier à jour");
    await F.click("#close"); await F.waitForTimeout(200);
    let fileF = JSON.parse(await F.evaluate(() => fakeFile.text));
    assert.deepEqual(fileF.favoris.map((f) => `${f.n}|${f.lat}|${f.lon}`), [fid]);
    assert.equal(await F.isVisible("#favBackup"), false);
    await F.click(`.row[data-id="${fid}"]`); await F.waitForTimeout(300);
    await F.click("#sheetStar"); await F.waitForTimeout(300);
    await F.click("#close"); await F.waitForTimeout(200);
    fileF = JSON.parse(await F.evaluate(() => fakeFile.text));
    assert.deepEqual(fileF.favoris, []);
    assert.equal(await F.evaluate(() => fakeFile.writes), 3);
    linkedErrors.push(...F.errors);
    await ctx.close();
    ok(`${label} : ${device ? "" : "navigation dans un nouvel onglet ; "}fichier de favoris choisi une fois, puis réécrit à chaque favori ajouté ou retiré (sans téléchargement)`);
  }
  {
    const { ctx, page: G } = await linked("Pixel 7", { broken: true });
    const [dl] = await Promise.all([G.waitForEvent("download"), G.click("#favFileCreate")]);
    assert.equal(dl.suggestedFilename(), "NavigationCentrales-favoris.json");
    assert.equal(await G.isVisible("#favBackup"), false);
    linkedErrors.push(...G.errors);
    await ctx.close();
    ok("Android : fichier choisi mais impossible à modifier → téléchargement, comme avant");
  }

  const errors = [...A.errors, ...B.errors, ...C.errors, ...D.errors, ...E.errors, ...linkedErrors];
  assert.deepEqual(errors, []);
  ok("aucune erreur JavaScript");
  console.log("\nTous les tests passent.");
} finally {
  await browser.close();
  server.kill();
}
