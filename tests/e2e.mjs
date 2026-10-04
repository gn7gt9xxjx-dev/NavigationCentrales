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
let remote = readFileSync(join(root, "data/centrales.json"), "utf8");
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
async function phone(device = "iPhone 15 Pro") {
  const ctx = await browser.newContext({ ...devices[device], locale: "fr-FR", geolocation: { latitude: 45.2, longitude: 5.9 }, permissions: ["geolocation"] });
  await ctx.route(/api\.github\.com|raw\.githubusercontent\.com/, github);
  await ctx.route(/tile\.openstreetmap|arcgisonline|nominatim/, (r) => r.fulfill({ status: 204 }));
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(URL_APP);
  await page.waitForSelector(".row");
  await page.waitForTimeout(800);
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
  ok("lecteur : liste à jour, pas de bouton +");
  await A.fill("#q", "st lau"); await A.waitForTimeout(200);
  assert.deepEqual(await names(A), ["CNPE St Laurent"]);
  ok("recherche « st lau » → CNPE St Laurent");

  // Hors ligne au relancement
  await A.evaluate(() => navigator.serviceWorker.ready);
  await ctxA.setOffline(true);
  await A.reload(); await A.waitForSelector(".row");
  assert.equal((await A.$$(".row")).length > 500, true);
  await ctxA.setOffline(false);
  ok("relance sans réseau : liste disponible");

  // Code d'édition
  await A.click("#openSettings");
  assert.match(await A.textContent("#setVersion"), /^Version \d+\.\d+\.\d+ \(cache \d{4}-\d{2}-\d{2}\.\d+\)$/);
  ok("réglages : numéro de version et de cache affichés");
  await A.fill("#setToken", "bad"); await A.click("#setTokenGo"); await A.waitForTimeout(300);
  assert.match(await A.$eval("#setTokenMsg", (e) => e.textContent), /pas valide/);
  await A.fill("#setToken", "good"); await A.click("#setTokenGo"); await A.waitForTimeout(500);
  await A.click("#setClose");
  assert.equal(await A.isVisible("#add"), true);
  ok("code refusé puis accepté, bouton + visible");

  // Ajout synchronisé
  await A.click("#add"); await A.waitForTimeout(300);
  await A.fill("#fName", "TEST AJOUT"); await A.fill("#fCoords", "45.5, 6.5"); await A.click("#editorSave");
  await A.waitForTimeout(2500);
  assert.equal(count(), initial + 1);
  assert.match(commits.at(-1), /^Ajout de TEST AJOUT/);
  ok("ajout envoyé au dépôt (commit)");

  // Autre téléphone
  const { page: B } = await phone("Pixel 7");
  await B.fill("#q", "test ajout"); await B.waitForTimeout(200);
  assert.deepEqual(await names(B), ["TEST AJOUT"]);
  await B.click(".row"); await B.waitForTimeout(300);
  assert.equal(await B.isVisible("#goPlans"), false);
  ok("autre téléphone (Android) : voit l'ajout, pas de bouton Plans");

  // Suppression + annulation
  await A.fill("#q", "test ajout"); await A.waitForTimeout(200);
  await A.click(".row"); await A.waitForTimeout(300);
  await A.click("#remove"); await A.click("#confirmOk"); await A.waitForTimeout(2200);
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

  const errors = [...A.errors, ...B.errors];
  assert.deepEqual(errors, []);
  ok("aucune erreur JavaScript");
  console.log("\nTous les tests passent.");
} finally {
  await browser.close();
  server.kill();
}
